"""End-to-end tests for dissect on a small multi-language fixture repository."""

import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dissect.cli import main  # noqa: E402
from dissect.extract import mini_yaml  # noqa: E402

# TypeScript/JavaScript facts need the Babel helper (npm ci --prefix tools/dissect/helpers);
# without it those files fall back to file-level facts and the JS assertions are skipped.
JS = bool(shutil.which("node")) and (ROOT / "helpers" / "node_modules" / "@babel" / "parser").exists()

FILES = {
    "package.json": json.dumps({"name": "fx", "bin": {"fx": "src/cli.ts"}, "scripts": {"test": "node --test"}, "dependencies": {"zod": "4.0.0"}}),
    "src/cli.ts": textwrap.dedent("""\
        import { z } from "zod";
        import { helper } from "./util";
        /** Start the worker loop. */
        export async function startWorker(): Promise<void> {
          const status = "running";
          process.on("SIGTERM", () => shutdown());
          setInterval(() => helper(process.env.FX_TOKEN), 1000);
        }
        export function shutdown() {}
        export const Config = z.object({ name: z.string() });
        """),
    "src/util.ts": "export function helper(x?: string) { return x; }\n",
    "py/app.py": textwrap.dedent('''\
        import os, signal
        from dataclasses import dataclass

        @dataclass
        class Job:
            """A queued job."""
            state: str = "pending"

        def checkpoint(job):
            """Persist a checkpoint."""
            return os.environ.get("APP_DB")

        def retry(job):
            return checkpoint(job)

        signal.signal(signal.SIGINT, lambda *a: None)
        '''),
    "go/main.go": textwrap.dedent("""\
        package main

        import ("os"; "time")

        // Run polls forever.
        func Run() { _ = os.Getenv("GO_FLAG"); time.NewTicker(time.Second); go func() {}() }

        func main() { Run() }
        """),
    "skills/fx/SKILL.md": "---\nname: fx\ndescription: Use fx to checkpoint jobs.\n---\n# fx\n\nIt is 38% faster than the baseline.\n",
    ".github/workflows/ci.yml": "name: ci\non:\n  push:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  test:\n    runs-on: ubuntu-latest\n",
    "README.md": "# Fixture\n\n## Usage\n",
}


class DissectTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.repo = cls.tmp / "fx"
        for rel, text in FILES.items():
            p = cls.repo / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        go_bin = ROOT / ".bin" / "go_extract"
        if not go_bin.exists() and shutil.which("go"):
            subprocess.run(["go", "build", "-o", str(go_bin), "go_extract.go"], cwd=ROOT / "helpers", check=True, capture_output=True)
        cls.db = str(cls.tmp / "d.db")
        cls.dx(["scan", f"{cls.repo}=fx"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def dx(cls, args):
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = main(["--db", cls.db, *args])
        return code, json.loads(buf.getvalue())

    def q(self, sql):
        return self.dx(["query", sql])[1]["rows"]

    def test_symbols_from_every_language(self):
        names = {r["qualname"] for r in self.q("select qualname from node where kind='symbol'")}
        self.assertTrue({"Job", "checkpoint", "retry"} <= names)
        if JS:
            self.assertTrue({"startWorker", "shutdown", "helper"} <= names)
        if (ROOT / ".bin" / "go_extract").exists():
            self.assertIn("Run", names)

    def test_entrypoints_and_triggers(self):
        ep = {(r["sub"], r["name"]) for r in self.q("select sub, name from node where kind='entrypoint'")}
        self.assertTrue({("bin", "fx"), ("npm-script", "test"), ("skill", "fx"), ("ci-workflow", "ci")} <= ep)
        trig = {(r["sub"], r["name"]) for r in self.q("select sub, name from node where kind='trigger'")}
        self.assertTrue({("env", "APP_DB"), ("signal", "SIGINT"), ("ci-event", "push"), ("cron", "0 3 * * *")} <= trig)
        if JS:
            self.assertTrue({("env", "FX_TOKEN"), ("signal", "SIGTERM")} <= trig)

    def test_calls_imports_states_lifecycles_schemas_claims(self):
        calls = self.q("select a.name src, b.name dst from edge e join node a on a.id=e.src join node b on b.id=e.dst where e.kind='calls'")
        self.assertIn({"src": "retry", "dst": "checkpoint"}, calls)
        states = {r["name"] for r in self.q("select name from node where kind='state'")}
        phases = {r["name"] for r in self.q("select name from node where kind='lifecycle'")}
        schemas = {r["name"] for r in self.q("select name from node where kind='schema'")}
        self.assertTrue("pending" in states and {"checkpoint", "retry"} <= phases and "Job" in schemas)
        if JS:
            self.assertIn({"src": "startWorker", "dst": "helper"}, calls)
            imports = self.q("select b.path from edge e join node a on a.id=e.src join node b on b.id=e.dst where e.kind='imports' and a.path='src/cli.ts' and b.kind='file'")
            self.assertEqual(imports, [{"path": "src/util.ts"}])
            self.assertTrue("running" in states and {"start", "shutdown"} <= phases and "Config" in schemas)
        self.assertEqual(len(self.q("select id from node where kind='claim'")), 1)

    def test_search_node_path_matrix(self):
        rows = self.dx(["search", "checkpoint", "--kind", "symbol"])[1]["rows"]
        self.assertEqual(rows[0]["name"], "checkpoint")
        node = self.dx(["node", "phase:checkpoint"])[1]
        self.assertTrue(node["in"])
        if JS:
            self.assertEqual(self.dx(["node", "fx:startWorker"])[1]["node"]["path"], "src/cli.ts")  # repo:qualname
        self.assertEqual(self.dx(["node", "skill:fx"])[1]["node"]["sub"], "skill")              # qualname containing ':' 
        path = self.dx(["path", "retry", "APP_DB"])[1]
        self.assertTrue(path["found"])
        matrix = self.dx(["matrix"])[1]
        self.assertIn("durable-execution", {r["concept"] for r in matrix["rows"]})

    def test_yaml_fallback_reads_front_matter_and_workflows(self):
        wf = mini_yaml(FILES[".github/workflows/ci.yml"])
        self.assertEqual(wf["name"], "ci")
        self.assertEqual(wf["on"]["schedule"], [{"cron": "0 3 * * *"}])
        self.assertEqual(list(wf["jobs"]), ["test"])
        fm = mini_yaml("name: fx\ndescription: >\n  Use fx to\n  checkpoint jobs.\ntags: [a, 'b']\n")
        self.assertEqual(fm, {"name": "fx", "description": "Use fx to checkpoint jobs.", "tags": ["a", "b"]})

    def test_query_is_read_only(self):
        code, out = self.dx(["query", "delete from node"])
        self.assertEqual((code, out["error"]), (1, "read_only"))

    def test_output_budget_truncates_with_next_offset(self):
        code, out = self.dx(["--max-bytes", "400", "list", "file", "--limit", "50"])  # files exist with or without the parser helpers
        self.assertTrue(out.get("truncated"))
        self.assertIsNotNone(out.get("next_offset"))

    def test_mcp_roundtrip(self):
        msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "dissect_search", "arguments": {"query": "checkpoint"}}}]
        proc = subprocess.run([sys.executable, str(ROOT / "run.py"), "--db", self.db, "mcp"], input="\n".join(map(json.dumps, msgs)) + "\n",
                              capture_output=True, text=True, timeout=60)
        replies = {r["id"]: r["result"] for r in map(json.loads, proc.stdout.splitlines())}
        self.assertEqual(len(replies[2]["tools"]), 8)
        self.assertTrue(all(t["annotations"]["readOnlyHint"] for t in replies[2]["tools"]))
        self.assertGreater(len(json.loads(replies[3]["content"][0]["text"])["rows"]), 0)


if __name__ == "__main__":
    unittest.main()
