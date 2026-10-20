"""End-to-end tests for rex (stdlib unittest). Run: python3 -m unittest discover -s tests"""

import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rex import epistemics, probes  # noqa: E402
from rex.store import RexError, Store  # noqa: E402

ELF = Path("/bin/true")


def rex(*args, store, env=None, input=None):
    proc = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, sys.argv.pop(1)); from rex.cli import main; sys.exit(main())", str(ROOT), "--store", store, *args],
                          capture_output=True, text=True, env={**os.environ, **(env or {})}, input=input, timeout=120)
    return proc.returncode, (json.loads(proc.stdout) if proc.stdout.strip() else None)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.store_path = str(self.tmp / "rex.db")
        self.store = Store(self.store_path)
        pkg = self.tmp / "pkg"
        (pkg / "dist").mkdir(parents=True)
        (pkg / "package.json").write_text(json.dumps({"name": "demo", "version": "1.0.0", "bin": {"demo": "dist/cli.js"}, "imports": {"#w": "./dist/w.js"}}))
        (pkg / "dist" / "cli.js").write_text('import { spawn } from "node:child_process";\nconst w = import.meta.resolve("#w");\n'
                                              'spawn(process.execPath, [new URL("../bridge/b.py", import.meta.url).pathname]);\n'
                                              'const addon = require("./build/Release/addon.node");\n/abc/.exec("x");\n')
        (pkg / "dist" / "w.js").write_text("export const ok = process.env.DEMO_FLAG;\n")
        self.pkg = pkg
        self.zip = self.tmp / "pkg.zip"
        with zipfile.ZipFile(self.zip, "w") as z:
            for f in pkg.rglob("*"):
                if f.is_file():
                    z.write(f, "package/" + f.relative_to(pkg).as_posix())
        self.tgz = self.tmp / "pkg.tgz"
        with tarfile.open(self.tgz, "w:gz") as t:
            t.add(pkg, arcname="package")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class Probes(Fixture):
    def test_identify_routes_formats(self):
        got = {p.name: probes.identify(self.store, p)["evidence"]["result"]["format"] for p in (self.zip, self.tgz, self.pkg)}
        self.assertEqual(got, {"pkg.zip": "zip", "pkg.tgz": "npm-tarball", "pkg": "npm-package-dir"})

    def test_inventory_is_identical_across_containers(self):
        digests = []
        for target in (self.pkg, self.zip, self.tgz):
            inv = probes.inventory(self.store, target)["evidence"]["result"]
            digests.append(sorted((e["path"].removeprefix("package/"), e["sha256"]) for e in inv["entries"]))
            self.assertEqual(inv["package_json"]["bin"], {"demo": "dist/cli.js"})
        self.assertEqual(digests[0], digests[1])
        self.assertEqual(digests[1], digests[2])

    def test_evidence_is_content_addressed_and_steps_are_idempotent(self):
        a = probes.inventory(self.store, self.tgz)
        b = probes.inventory(self.store, self.tgz)
        self.assertFalse(a["reused"])
        self.assertTrue(b["reused"])
        self.assertEqual(a["evidence"]["id"], b["evidence"]["id"])
        other = Store(self.tmp / "other.db")
        self.assertEqual(probes.inventory(other, self.tgz)["evidence"]["id"], a["evidence"]["id"])

    def test_js_refs_finds_resolves_assets_spawns_and_addons(self):
        refs = probes.js_refs(self.store, self.pkg)["evidence"]["result"]["refs"]
        self.assertIn("#w", refs["import_meta_resolve"]["distinct"])
        self.assertIn("../bridge/b.py", refs["url_relative_asset"]["distinct"])
        self.assertEqual(refs["child_process_call"]["distinct"], {"spawn": 1})  # /abc/.exec is not a child process
        self.assertIn("./build/Release/addon.node", refs["native_addon_ref"]["distinct"])
        self.assertIn("DEMO_FLAG", refs["env_var"]["distinct"])

    @unittest.skipUnless(ELF.exists(), "needs an ELF binary")
    def test_native_elf_matches_readelf(self):
        r = probes.native(self.store, ELF)["evidence"]["result"]
        self.assertEqual(r["format"], "elf")
        if shutil.which("readelf"):
            out = subprocess.run(["readelf", "-d", str(ELF)], capture_output=True, text=True).stdout
            needed = [l.split("[")[1].rstrip("]") for l in out.splitlines() if "(NEEDED)" in l]
            self.assertEqual(r["needed"], needed)

    def test_find_slices_and_reports_truncation(self):
        r = probes.find(self.store, self.pkg, "import.meta", context=10, limit=1)["evidence"]["result"]
        self.assertEqual(len(r["hits"]), 1)
        self.assertTrue(r["truncated"])

    def test_unsupported_target_explains_the_fix(self):
        with self.assertRaises(RexError) as cm:
            probes.native(self.store, self.zip)
        self.assertEqual(cm.exception.code, "unsupported_target")
        self.assertIn("identify", cm.exception.fix)


class Epistemics(Fixture):
    def test_answers_need_evidence_and_cannot_overclaim(self):
        q = epistemics.add_question(self.store, "Which files does the package ship?")
        with self.assertRaises(RexError) as cm:
            epistemics.answer(self.store, q["id"], status="answered", text="x", confidence="observed", evidence_ids=[])
        self.assertEqual(cm.exception.code, "no_evidence")
        ev = self.store.put(operation="note", tool="test", params={}, result={"n": 1}, confidence="inferred", authority="analyst-inference", limitations=[])
        with self.assertRaises(RexError) as cm:
            epistemics.answer(self.store, q["id"], status="answered", text="x", confidence="observed", evidence_ids=[ev["id"]])
        self.assertEqual(cm.exception.code, "confidence_exceeds_evidence")
        with self.assertRaises(RexError) as cm:
            epistemics.answer(self.store, q["id"], status="answered", text="x", confidence="inferred", evidence_ids=[ev["id"]])
        self.assertEqual(cm.exception.code, "below_required_confidence")
        partial = epistemics.answer(self.store, q["id"], status="partial", text="x", confidence="inferred", evidence_ids=[ev["id"]])
        inv = probes.inventory(self.store, self.tgz)["evidence"]
        final = epistemics.answer(self.store, q["id"], status="answered", text="3 files", confidence="observed", evidence_ids=[inv["id"]])
        self.assertEqual(final["revision"], 2)
        self.assertEqual(final["previous_digest"], partial["digest"])

    def test_coverage_separates_unaccounted(self):
        q1 = epistemics.add_question(self.store, "A?")
        epistemics.add_question(self.store, "B?")
        epistemics.answer(self.store, q1["id"], status="unknown", text=None, confidence=None, evidence_ids=[])
        cov = epistemics.coverage(self.store)
        self.assertEqual((cov["unknown"], cov["unaccounted"], cov["complete"]), (1, 1, False))
        self.assertTrue(any("never addressed" in c for c in cov["caveats"]))

    def test_calibration_flags_classes_that_should_abstain(self):
        obs = probes.inventory(self.store, self.tgz)["evidence"]["id"]
        inf = self.store.put(operation="note", tool="t", params={}, result={}, confidence="inferred", authority="analyst-inference", limitations=[])["id"]
        for i in range(12):
            q = epistemics.add_question(self.store, f"obs {i}", "inferred")
            epistemics.answer(self.store, q["id"], status="answered", text="y", confidence="observed", evidence_ids=[obs])
            epistemics.adjudicate(self.store, q["id"], "correct")
            q = epistemics.add_question(self.store, f"inf {i}", "inferred")
            epistemics.answer(self.store, q["id"], status="answered", text="y", confidence="inferred", evidence_ids=[inf])
            epistemics.adjudicate(self.store, q["id"], "correct" if i % 2 else "incorrect")
        cal = epistemics.calibrate(self.store, target_error=0.1)
        self.assertEqual(cal["classes"]["observed"]["precision"], 1.0)
        self.assertEqual(cal["classes"]["inferred"]["precision"], 0.5)
        self.assertTrue(cal["classes"]["inferred"]["abstain"])
        self.assertTrue(cal["ordering_holds"])
        self.assertEqual(epistemics.wilson(0, 0), (0.0, 1.0))


class Durability(Fixture):
    def test_export_import_roundtrip_rejects_tampering(self):
        ev = probes.inventory(self.store, self.tgz)["evidence"]
        epistemics.add_question(self.store, "Q?")
        bundle = self.tmp / "b.jsonl"
        self.store.export(bundle)
        lines = bundle.read_text().splitlines()
        tampered = [l.replace('"count":', '"count_":', 1) if '"evidence"' in l else l for l in lines]
        (self.tmp / "t.jsonl").write_text("\n".join(tampered) + "\n")
        fresh = Store(self.tmp / "fresh.db")
        self.assertEqual(fresh.import_(bundle)["evidence"], 1)
        self.assertEqual(fresh.get(ev["id"])["result"], ev["result"])
        self.assertEqual(Store(self.tmp / "fresh2.db").import_(self.tmp / "t.jsonl")["rejected"], 1)

    def test_import_never_takes_sql_names_or_unchecked_answers_from_the_file(self):
        ev = probes.inventory(self.store, self.tgz)["evidence"]
        q = epistemics.add_question(self.store, "Does it ship a lockfile?", "inferred")
        epistemics.answer(self.store, q["id"], status="answered", text="no", confidence="inferred", evidence_ids=[ev["id"]])
        bundle = self.tmp / "b.jsonl"
        self.store.export(bundle)
        good = bundle.read_text().splitlines()
        ans = json.loads(next(l for l in good if l.startswith('{"answer"')))["answer"]
        forged = dict(ans, confidence="observed")  # claims more than the cited evidence, with a stale digest
        hostile = good + [json.dumps({"evidence; drop table evidence; --": {"x": 1}}), json.dumps({"question": {"id": "q_x", "text": "t", "bogus) values (1); --": 1}}),
                          json.dumps({"answer": forged}), json.dumps({"adjudication": {"question_id": "q_missing", "revision": 1, "outcome": "correct", "created_at": 0}})]
        (self.tmp / "h.jsonl").write_text("\n".join(hostile) + "\n")
        fresh = Store(self.tmp / "fresh3.db")
        counts = fresh.import_(self.tmp / "h.jsonl")
        self.assertEqual((counts["evidence"], counts["question"], counts["answer"], counts["rejected"]), (1, 1, 1, 4))
        self.assertEqual(fresh.con.execute("select count(*) from evidence").fetchone()[0], 1)
        self.assertEqual(fresh.con.execute("select confidence from answer").fetchone()[0], "inferred")

    def test_plan_resumes_after_crash_without_repeating_steps(self):
        plan = self.tmp / "plan.json"
        plan.write_text(json.dumps({"steps": [{"op": "identify", "path": str(self.tgz)}, {"op": "inventory", "path": str(self.tgz)},
                                              {"op": "js-refs", "path": str(self.pkg)}, {"op": "inventory", "path": str(self.zip)}],
                                    "questions": [{"text": "What does the package run?"}]}))
        code, _ = rex("run", str(plan), store=self.store_path, env={"REX_CRASH_AFTER": "2"})
        self.assertEqual(code, -9)  # killed after step 2
        code, out = rex("run", str(plan), store=self.store_path)
        self.assertEqual(code, 0)
        self.assertEqual((out["reused"], out["executed"]), (2, 2))
        self.assertEqual(out["coverage"]["unaccounted"], 1)


class Interfaces(Fixture):
    def test_cli_errors_are_json_with_fix(self):
        code, out = rex("native", str(self.zip), store=self.store_path)
        self.assertEqual(code, 2)
        self.assertEqual(out["error"]["code"], "unsupported_target")

    def test_mcp_roundtrip(self):
        msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "rex_probe", "arguments": {"path": str(self.tgz), "op": "inventory"}}},
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "rex_probe", "arguments": {"path": str(self.zip), "op": "native"}}}]
        proc = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, sys.argv.pop(1)); from rex.cli import main; sys.exit(main())", str(ROOT), "--store", self.store_path, "mcp"],
                              input="\n".join(json.dumps(m) for m in msgs) + "\n", capture_output=True, text=True, timeout=60)
        replies = {r["id"]: r["result"] for r in map(json.loads, proc.stdout.splitlines())}
        tools = replies[2]["tools"]
        self.assertEqual(len(tools), 10)
        self.assertLess(len(json.dumps(tools)), 12000)  # the whole catalog fits easily in context
        self.assertFalse(replies[3]["isError"])
        self.assertEqual(json.loads(replies[3]["content"][0]["text"])["evidence"]["operation"], "inventory")
        self.assertTrue(replies[4]["isError"])


if __name__ == "__main__":
    unittest.main()
