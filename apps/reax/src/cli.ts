// The reax command line, on the operation registry. Until the daemon and MCP server exist (WP-3)
// this is how agents and people call operations.
//   reax op --list
//   reax describe <operation>
//   reax op <operation> [--json '{"path":"..."}'] [--workspace dir] [--format text|json]
import { isCoreError } from "@re4exa/core/errors";
import { envelope } from "@re4exa/core/policy/taint";
import { OPERATIONS, operation, runOperation } from "./ops/registry.ts";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  const out = (s: string) => process.stdout.write(`${s}\n`);
  try {
    if (cmd === "op" && rest[0] === "--list") {
      for (const o of OPERATIONS) out(`${o.name}\t${o.summary}`);
      return 0;
    }
    if (cmd === "describe" && rest[0]) {
      const o = operation(rest[0]);
      out(
        JSON.stringify(
          {
            name: o.name,
            tool: o.tool,
            summary: o.summary,
            input: o.input,
            effect: o.effect,
            examples: o.examples.map((e) => e.args),
          },
          null,
          1,
        ),
      );
      return 0;
    }
    if (cmd === "op" && rest[0]) {
      const args = JSON.parse(flag(rest, "--json") ?? "{}") as unknown;
      const workspace = flag(rest, "--workspace") ?? process.cwd();
      const r = await runOperation(rest[0], args, { workspace });
      const op = operation(rest[0]);
      if (flag(rest, "--format") === "json")
        out(JSON.stringify({ operation: r.operation, coverage: r.coverage, limitations: r.limitations, data: r.data }));
      else {
        out(op.untrusted ? envelope(r.text, r.operation).text : r.text);
        out(`coverage: ${r.coverage}${r.limitations.length ? `; limitations: ${r.limitations.join("; ")}` : ""}`);
      }
      return 0;
    }
    process.stderr.write(
      "usage: reax op --list | reax describe <operation> | reax op <operation> --json '{...}' [--workspace dir] [--format json]\n",
    );
    return 2;
  } catch (e) {
    if (isCoreError(e)) {
      process.stderr.write(`${e.message} [${e.code}]${e.detail ? ` ${JSON.stringify(e.detail)}` : ""}\n`);
      return 1;
    }
    process.stderr.write(`${(e as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
