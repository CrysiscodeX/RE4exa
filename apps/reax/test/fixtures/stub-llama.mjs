// A stand-in for llama-server: /health and an OpenAI-style /v1/chat/completions that calls
// reax_op once, then answers from the tool output. Prints the buffer sizes llama.cpp prints at
// load; STUB_KV_MIB sets the KV size so the memory cap can be tested. --list-devices prints
// STUB_DEVICES (default: none).
import http from "node:http";

if (process.argv.includes("--list-devices")) {
  // STUB_DEVICES: the device lines to print ("none" for a CPU-only machine).
  process.stdout.write(`Available devices:\n${process.env.STUB_DEVICES ?? "  (none)"}\n`);
  process.exit(0);
}
if (process.argv.includes("--version")) {
  process.stdout.write("version: 11923 (de5122d8) stub\n");
  process.exit(0);
}

const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
process.stderr.write(
  `load_tensors: Metal_Mapped model buffer size =  ${process.env.STUB_MODEL_MIB ?? "2400.00"} MiB\n`,
);
process.stderr.write(`llama_kv_cache: Metal KV buffer size =  ${process.env.STUB_KV_MIB ?? "600.00"} MiB\n`);
process.stderr.write(`llama_context: Metal compute buffer size =   ${process.env.STUB_COMPUTE_MIB ?? "300.00"} MiB\n`);
// STUB_MIB_PER_KTOK: resident memory a filled context really takes, per 1000 tokens of -c, so
// the context fitting in setup can be tested against real resident memory.
const ctx = Number(process.argv[process.argv.indexOf("-c") + 1] || 0);
const held = [];
// STUB_IGNORE_TERM=1: a server that does not exit on SIGTERM, so the SIGKILL fallback is tested.
if (process.env.STUB_IGNORE_TERM === "1") process.on("SIGTERM", () => {});
const reply = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
http
  .createServer((req, res) => {
    if (req.url === "/health") return reply(res, { status: "ok" });
    if (req.url === "/tokenize") {
      let t = "";
      req.on("data", (d) => (t += d));
      return req.on("end", () =>
        reply(res, {
          tokens: JSON.parse(t)
            .content.split(/\s+/)
            .filter(Boolean)
            .map((_, i) => i),
        }),
      );
    }
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      const body = JSON.parse(data);
      if (!body.tools) {
        // the context-filling request from setup: take the memory, answer briefly
        const mib = Number(process.env.STUB_MIB_PER_KTOK ?? 0) * (ctx / 1000);
        if (mib > 0) held.push(Buffer.alloc(Math.round(mib * 2 ** 20), 1));
        const words = body.messages
          .map((m) => m.content)
          .join(" ")
          .split(/\s+/)
          .filter(Boolean).length;
        return reply(res, {
          model: "stub-qwen3-4b",
          usage: { prompt_tokens: words, completion_tokens: 1 },
          choices: [{ message: { role: "assistant", content: "OK" } }],
        });
      }
      const tool = body.messages.filter((m) => m.role === "tool").at(-1);
      const usage = { prompt_tokens: 900, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 400 } };
      if (!tool) {
        const user = body.messages.find((m) => m.role === "user").content;
        const file = user.match(/([\w.-]+-(?:s|g)(?:\.\w+)?)\b/)[1];
        return reply(res, {
          model: "stub-qwen3-4b",
          usage,
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: "reax_op",
                      arguments: JSON.stringify({ operation: "inventory.native", path: file }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      const file = tool.content.match(/([\w.-]+): ([\w-]+)\s*\n- /);
      const arch = tool.content.match(/- (\w+) (\d+)-bit/);
      const claims = [
        { predicate: "file.format", subject: file[1], value: file[2], label: "observed" },
        { predicate: "native.arch", subject: file[1], value: arch[1], label: "observed" },
      ];
      reply(res, {
        model: "stub-qwen3-4b",
        usage,
        choices: [
          { message: { role: "assistant", content: `Checked.\n\`\`\`claims\n${JSON.stringify(claims)}\n\`\`\`` } },
        ],
      });
    });
  })
  .listen(port, "127.0.0.1");
