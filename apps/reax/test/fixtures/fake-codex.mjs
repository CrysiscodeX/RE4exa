// A stand-in for `codex exec --json`: records its arguments, runs the real `reax` command found
// on PATH (the harness's shim), and prints Codex-style JSON events. FAKE_SIGNED_OUT=1 prints the
// not-signed-in message Codex prints and exits 1.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_FILE) appendFileSync(process.env.FAKE_ARGS_FILE, `${JSON.stringify(args)}\n`);
if (process.env.FAKE_SIGNED_OUT === "1") {
  process.stderr.write("Error: Not logged in. Run `codex login` to sign in.\n");
  process.exit(1);
}
// `codex exec -` reads the prompt from stdin, which is how the harness sends it.
const prompt = args.at(-1) === "-" ? readFileSync(0, "utf8") : args.at(-1);

/** Run `reax` as an agent's shell would: the POSIX shim, or on Windows the reax.cmd on PATH. */
function reax(argv) {
  if (process.platform !== "win32") return execFileSync("reax", argv, { encoding: "utf8" });
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  const dir = process.env[key].split(delimiter).find((d) => existsSync(join(d, "reax.cmd")));
  const [, node, script] = readFileSync(join(dir, "reax.cmd"), "utf8").match(/^@"([^"]+)" "([^"]+)" %\*/);
  return execFileSync(node, [script, ...argv], { encoding: "utf8" });
}
const ev = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
ev({ type: "thread.started", thread_id: "t1" });
ev({ type: "turn.started" });
if (/Review another agent's answer/.test(prompt)) {
  ev({
    type: "item.completed",
    item: { type: "agent_message", text: '```review\n{"wrong": [], "missing": ["native.bits"], "ok": false}\n```' },
  });
} else {
  const file = prompt.match(/([\w.-]+-(?:s|g)(?:\.\w+)?)\b/)[1];
  const out = reax(["op", "identify.file", "--json", JSON.stringify({ path: file }), "--format", "json"]);
  ev({
    type: "item.completed",
    item: { type: "command_execution", command: "reax op identify.file", aggregated_output: out },
  });
  const format = JSON.parse(out).data.format;
  ev({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: `\`\`\`claims\n${JSON.stringify([{ predicate: "file.format", subject: file, value: format, label: "observed" }])}\n\`\`\``,
    },
  });
}
ev({ type: "turn.completed", usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 90 } });
