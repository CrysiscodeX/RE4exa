// assay — command line. `assay serve` starts the workbench; the rest work on the store directly.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { App, defaultHome, VERSION } from "./app/app.ts";
import { isAssayError } from "./errors.ts";
import { type Bundle, verifyBundle } from "./export/export.ts";

const HELP = `assay ${VERSION} — chat with your signed-in agent clients, run sub-agents, check every claim

usage:
  assay serve [--port N] [--workspace DIR] [--home DIR] [--demo]   start the workbench (prints a pairing link)
  assay doctor                                                     check Node, clients, accounts, git, UI
  assay sweep <path> [--json]                                      model-free first pass on a file or folder
  assay probe <path> --probe <id> [--params JSON]                  run one probe; prints the evidence record
  assay probe --list                                               list probes
  assay verify --bundle <file> [--key <public.pem>]                check a signed evidence bundle
  assay export <case-id> --format s2|sarif|cyclonedx|md|bundle [--out FILE]
  assay capabilities                                               machine-readable capability statement
  assay forget <case-id> | --all                                   delete cases from the store
  assay version

The store lives in --home or $ASSAY_HOME (default ~/.assay). Only one process can hold it.`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
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
      console.log(`bundle verifies: ${r.records} evidence records, ${r.claims} claims, signer ${r.signer}`);
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

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    if (isAssayError(e)) {
      const j = e.toJSON();
      console.error(`assay: ${j.message} [${j.code}]\n  -> ${j.fix}`);
    } else console.error(`assay: ${(e as Error)?.stack ?? e}`);
    process.exit(1);
  },
);
