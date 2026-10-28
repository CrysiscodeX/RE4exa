// assay — command line. `assay serve` starts the workbench; the rest work on the store directly.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { caseClaims } from "@re4exa/core/evidence/store";
import { App, defaultHome, VERSION } from "./app/app.ts";
import { isAssayError } from "./errors.ts";
import { type Bundle, signingKey, verifyBundle } from "./export/export.ts";

const HELP = `assay ${VERSION} — chat with your signed-in agent clients, run sub-agents, check every claim

usage:
  assay serve [--port N] [--workspace DIR] [--home DIR] [--demo]   start the workbench (prints a pairing link)
  assay doctor                                                     check Node, clients, accounts, git, UI
  assay sweep <path> [--json]                                      model-free first pass on a file or folder
  assay probe <path> --probe <id> [--params JSON]                  run one probe; prints the evidence record
  assay probe --list                                               list probes
  assay verify --bundle <file> [--key <public.pem>]                check a signed bundle (exit 3: intact, signer unchecked)
  assay key                                                        print the public key that signs your bundles
  assay cases                                                      list cases: id, title, claims by verdict
  assay export <case-id> --format s2|sarif|cyclonedx|md|bundle [--out FILE]
  assay capabilities                                               machine-readable capability statement
  assay forget <case-id> | --all                                   delete cases from the store
  assay version

The store lives in --home or $ASSAY_HOME (default ~/.assay). Only one process can hold it.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const FLAGS: Record<string, { value: string[]; bool: string[] }> = {
  serve: { value: ["--port", "--workspace", "--home"], bool: ["--demo"] },
  doctor: { value: ["--workspace", "--home"], bool: [] },
  sweep: { value: ["--workspace", "--home"], bool: ["--json"] },
  probe: { value: ["--probe", "--params", "--workspace", "--home"], bool: ["--list"] },
  verify: { value: ["--bundle", "--key"], bool: [] },
  key: { value: ["--home"], bool: [] },
  cases: { value: ["--workspace", "--home"], bool: [] },
  export: { value: ["--format", "--out", "--workspace", "--home"], bool: [] },
  capabilities: { value: ["--workspace", "--home"], bool: [] },
  forget: { value: ["--workspace", "--home"], bool: ["--all"] },
};

/** Unknown options are an error, not silently ignored (docs/configuration.md). */
function checkFlags(cmd: string, args: string[]): string | null {
  const spec = FLAGS[cmd];
  if (!spec) return null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("--")) continue;
    if (spec.value.includes(a)) {
      if (args[i + 1] === undefined || args[i + 1]!.startsWith("--")) return `${a} needs a value`;
      i++;
    } else if (!spec.bool.includes(a)) return `unknown option ${a} for \`assay ${cmd}\``;
  }
  return null;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  const bad = cmd ? checkFlags(cmd, args) : null;
  if (bad) {
    console.error(`assay: ${bad}\n\n${HELP}`);
    return 2;
  }
  const home = flag(args, "--home") ?? defaultHome();
  const workspace = flag(args, "--workspace") ?? process.cwd();
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "version":
    case "--version":
      console.log(VERSION);
      return 0;
    case "serve": {
      process.env.ASSAY_LOG ??= "info";
      const app = new App({ home, workspace, demo: args.includes("--demo") });
      const port = flag(args, "--port");
      const server = await app.listen(port ? Number(port) : undefined);
      console.log(`Assay ${VERSION} on ${server.url}  (workspace ${app.workspace})`);
      console.log(`Open this link to pair your browser (valid 5 minutes, single use):\n  ${server.pairingUrl()}`);
      process.stdin.on("data", (d) => {
        if (String(d).trim() === "pair") console.log(`  ${server.pairingUrl()}`);
      });
      const stop = async () => {
        await app.close();
        process.exit(0);
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return await new Promise<number>(() => undefined);
    }
    case "doctor": {
      const app = new App({ home, workspace });
      const checks = await app.doctor();
      for (const c of checks)
        console.log(
          `${c.ok ? "ok  " : "FIX "} ${c.id.padEnd(22)} ${c.detail}${c.fix && !c.ok ? `\n     -> ${c.fix}` : ""}`,
        );
      await app.close();
      return checks.every((c) => c.ok || c.id.startsWith("provider:") || c.id.startsWith("account:")) ? 0 : 1;
    }
    case "sweep": {
      const path = args.find((a) => !a.startsWith("--")) ?? ".";
      const app = new App({ home, workspace });
      const report = await app.engine.sweep({ caseId: null, path });
      if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(
          `${report.subject}: ${report.evidence.length} evidence records, ${report.findings.length} findings in ${report.elapsedMs} ms`,
        );
        for (const f of report.findings.slice(0, 40)) console.log(`  [${f.class}] ${f.label}`);
        if (report.questions.length) console.log("open questions:");
        for (const q of report.questions) console.log(`  ? ${q}`);
        if (report.notExamined.length)
          console.log(`not examined: ${report.notExamined.length} (use --json for the list)`);
      }
      await app.close();
      return 0;
    }
    case "probe": {
      const app = new App({ home, workspace });
      if (args.includes("--list")) {
        for (const p of app.engine.list()) console.log(`${p.id.padEnd(20)} ${p.cost.padEnd(7)} ${p.summary}`);
      } else {
        const path = args.find(
          (a) => !a.startsWith("--") && a !== flag(args, "--probe") && a !== flag(args, "--params"),
        );
        const probeId = flag(args, "--probe");
        if (!path || !probeId) {
          console.error("usage: assay probe <path> --probe <id> [--params JSON]");
          await app.close();
          return 2;
        }
        const params = flag(args, "--params");
        const rec = await app.engine.run({
          caseId: null,
          probeId,
          path,
          params: params ? JSON.parse(params) : undefined,
        });
        console.log(JSON.stringify(rec, null, 2));
      }
      await app.close();
      return 0;
    }
    case "key": {
      // The public half of this store's bundle-signing key, to give to people who check your bundles.
      const { publicPem } = signingKey(resolve(home));
      process.stdout.write(publicPem);
      return 0;
    }
    case "verify": {
      const file = flag(args, "--bundle");
      if (!file) {
        console.error("usage: assay verify --bundle <file> [--key <public.pem>]");
        return 2;
      }
      const key = flag(args, "--key");
      const r = verifyBundle(
        JSON.parse(readFileSync(resolve(file), "utf8")) as Bundle,
        key ? readFileSync(resolve(key), "utf8") : undefined,
      );
      if (r.authenticated) {
        console.log(`bundle is authentic: ${r.records} evidence records, ${r.claims} claims, signed by ${r.signer}`);
        return 0;
      }
      console.log(
        `bundle is intact (${r.records} evidence records, ${r.claims} claims) but its signer is NOT authenticated:\n` +
          `  it is signed with the key it carries (fingerprint ${r.signer}), and anyone can re-sign an edited bundle.\n` +
          "  Ask the sender for their key (`assay key` prints it) and pass --key <public.pem>.",
      );
      return 3;
    }
    case "cases": {
      const app = new App({ home, workspace });
      for (const c of app.kernel.listCases()) {
        const n = { verified: 0, refuted: 0, unverifiable: 0, unchecked: 0 };
        for (const cl of caseClaims(app.kernel, c.id)) n[cl.verdict ?? "unchecked"]++;
        console.log(
          `${c.id}  ${c.title || "(untitled)"}  ${n.verified} ✔ verified, ${n.refuted} ✖ refuted, ${n.unverifiable} ? unverifiable, ${n.unchecked} · not checked`,
        );
      }
      await app.close();
      return 0;
    }
    case "export": {
      const caseId = args[0];
      const format = flag(args, "--format") ?? "md";
      if (!caseId) {
        console.error("usage: assay export <case-id> --format ...");
        return 2;
      }
      const app = new App({ home, workspace });
      const out = app.exportCase(caseId, format);
      const file = flag(args, "--out");
      if (file) writeFileSync(file, out.body);
      else process.stdout.write(out.body);
      await app.close();
      return 0;
    }
    case "capabilities": {
      const app = new App({ home, workspace });
      const { capabilityStatement } = await import("./mcp/capabilities.ts");
      console.log(JSON.stringify(capabilityStatement({ engine: app.engine, verifier: true }), null, 2));
      await app.close();
      return 0;
    }
    case "forget": {
      const app = new App({ home, workspace });
      const ids = args.includes("--all")
        ? app.kernel.listCases().map((c) => c.id)
        : args.filter((a) => !a.startsWith("--"));
      for (const id of ids) forget(app, id);
      console.log(`deleted ${ids.length} case(s). Evidence records shared with other cases are kept.`);
      await app.close();
      return 0;
    }
    default:
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

function forget(app: App, caseId: string): void {
  const k = app.kernel;
  k.tx(() => {
    for (const t of ["case_events", "case_evidence", "claims", "unknowns", "approvals"])
      k.run(`DELETE FROM ${t} WHERE case_id=?`, caseId);
    k.run("DELETE FROM usage WHERE case_id=?", caseId);
    k.run("DELETE FROM mailbox WHERE case_id=?", caseId);
    k.run("DELETE FROM checkpoints WHERE task_id IN (SELECT id FROM tasks WHERE case_id=?)", caseId);
    k.run("DELETE FROM intents WHERE task_id IN (SELECT id FROM tasks WHERE case_id=?)", caseId);
    k.run("DELETE FROM attempts WHERE task_id IN (SELECT id FROM tasks WHERE case_id=?)", caseId);
    k.run("DELETE FROM tasks WHERE case_id=?", caseId);
    k.run("DELETE FROM cases WHERE id=?", caseId);
    k.run("DELETE FROM evidence WHERE observation_id NOT IN (SELECT observation_id FROM case_evidence)");
  });
}

// Exit only after stdout has drained: process.exit on a pipe drops whatever is still buffered (64 KiB).
const exitAfterFlush = (code: number) => process.stdout.write("", () => process.exit(code));

main(process.argv.slice(2)).then(
  (code) => exitAfterFlush(code),
  (e) => {
    if (isAssayError(e)) {
      const j = e.toJSON();
      console.error(`assay: ${j.message} [${j.code}]\n  -> ${j.fix}`);
    } else console.error(`assay: ${(e as Error)?.stack ?? e}`);
    process.exit(1);
  },
);
