// A stand-in for `claude -p --output-format stream-json`: plans, reviews (asking for one
// revision the first time it reviews in a cell) or answers, in Claude Code's stream-json shape.
// The prompt arrives on stdin. FAKE_SIGNED_OUT=1 fails like a signed-out CLI; FAKE_SLEEP_MS delays
// the answer.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_FILE) appendFileSync(process.env.FAKE_ARGS_FILE, `${JSON.stringify(args)}\n`);
if (args.includes("--help")) {
  process.stdout.write(
    process.env.FAKE_NO_EFFORT
      ? "Usage: claude [options]\n"
      : "Usage: claude [options]\n  --effort <level>  reasoning effort\n",
  );
  process.exit(0);
}
if (process.env.FAKE_SIGNED_OUT === "1") {
  process.stdout.write(
    `${JSON.stringify({ type: "result", is_error: true, result: "Invalid API key · Please run /login" })}\n`,
  );
  process.exit(1);
}
// `claude -p` with no prompt argument reads it from stdin, which is how the harness sends it.
const prompt = readFileSync(0, "utf8");
const model = args[args.indexOf("--model") + 1];
const ev = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const finish = (text, cost) => {
  ev({ type: "system", subtype: "init", model });
  ev({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Bash" },
        { type: "text", text: "..." },
      ],
    },
  });
  ev({
    type: "result",
    result: text,
    num_turns: 2,
    total_cost_usd: cost,
    usage: { input_tokens: 300, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100, output_tokens: 150 },
    modelUsage: { [model]: {} },
  });
};
const answer = () => {
  if (/orchestrating a small local model/.test(prompt))
    return finish("1. Run inventory.native on the file.\n2. Report format and architecture.", 0.01);
  if (/"decision"/.test(prompt))
    return finish(
      /Codex's review:[\s\S]*"missing": \["native\.bits"\]/.test(prompt)
        ? '```decision\n{"decision": "revise", "corrections": ["Also report native.bits"]}\n```'
        : '```decision\n{"decision": "accept", "corrections": []}\n```',
      0.02,
    );
  const file = prompt.match(/([\w.-]+-(?:s|g)(?:\.\w+)?)\b/)[1];
  return finish(
    `\`\`\`claims\n${JSON.stringify([{ predicate: "file.format", subject: file, value: "elf", label: "observed" }])}\n\`\`\``,
    0.03,
  );
};
if (process.env.FAKE_SLEEP_MS) setTimeout(answer, Number(process.env.FAKE_SLEEP_MS));
else answer();
