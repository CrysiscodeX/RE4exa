import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { DETECTOR_VERSION, redact, redactString } from "../src/policy/redact.ts";
import { lcg } from "./helpers.ts";

// Secrets are generated at run time from a seed, so the repository holds no secret-shaped literal.
const rand = lcg(20261025);
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0234567";
const B64 = `${ALNUM}+/`;
function gen(n: number, alphabet = ALNUM): string {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return s;
}
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

function corpus(): { line: string; secret: string; kind: string }[] {
  const out: { line: string; secret: string; kind: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const pemBody = Array.from({ length: 6 }, () => gen(64, B64)).join("\n");
    const kinds = ["RSA ", "EC ", "OPENSSH ", ""];
    const k = kinds[i % kinds.length]!;
    const pem = `-----BEGIN ${k}PRIVATE KEY-----\n${pemBody}\n-----END ${k}PRIVATE KEY-----`;
    out.push({ line: `const key = \`${pem}\`;`, secret: pemBody, kind: "pem-private-key" });

    const akid = `AKIA${gen(16, UPPER)}`;
    out.push({ line: `aws_access_key_id = ${akid}`, secret: akid, kind: "aws-access-key-id" });
    const sak = gen(40, B64);
    out.push({ line: `aws_secret_access_key = ${sak}`, secret: sak, kind: "aws-secret-access-key" });
    out.push({
      line: `{"AccessKeyId": "${akid}", "SecretAccessKey": "${sak}"}`,
      secret: sak,
      kind: "aws-secret-access-key",
    });

    const ghp = `ghp_${gen(36)}`;
    out.push({ line: `git clone https://${ghp}@github.com/o/r.git`, secret: ghp, kind: "github-token" });
    const gho = `gho_${gen(36)}`;
    out.push({ line: `GH_TOKEN=${gho}`, secret: gho, kind: "github-token" });
    const pat = `github_pat_${gen(22)}_${gen(59)}`;
    out.push({ line: `"token": "${pat}"`, secret: pat, kind: "github-token" });

    const slack = `xoxb-${gen(12, "0123456789")}-${gen(12, "0123456789")}-${gen(24)}`;
    out.push({ line: `slack_bot = '${slack}'`, secret: slack, kind: "slack-token" });
    const hook = `https://hooks.slack.com/services/T${gen(8, UPPER)}/B${gen(8, UPPER)}/${gen(24)}`;
    out.push({ line: `webhook: ${hook}`, secret: hook, kind: "slack-webhook" });

    const stripe = `sk_live_${gen(24)}`;
    out.push({ line: `Stripe.apiKey = "${stripe}";`, secret: stripe, kind: "stripe-key" });

    const gkey = `AIza${gen(35, `${ALNUM}_-`)}`;
    out.push({
      line: `<script src="https://maps.example/js?key=${gkey}"></script>`,
      secret: gkey,
      kind: "google-api-key",
    });

    const jwt = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: gen(10), iat: 1700000000 + i })}.${gen(43, `${ALNUM}_-`)}`;
    out.push({ line: `Authorization: Bearer ${jwt}`, secret: jwt, kind: "jwt" });

    const ant = `sk-ant-api03-${gen(93, `${ALNUM}_-`)}AA`;
    out.push({ line: `ANTHROPIC_API_KEY=${ant}`, secret: ant, kind: "anthropic-key" });
    const oai = `sk-proj-${gen(48, `${ALNUM}_-`)}`;
    out.push({ line: `client = OpenAI(api_key="${oai}")`, secret: oai, kind: "openai-key" });
    const oaiLegacy = `sk-${gen(20)}T3BlbkFJ${gen(20)}`;
    out.push({ line: `openai.api_key = '${oaiLegacy}'`, secret: oaiLegacy, kind: "openai-key" });

    const pw = `${gen(6)}!${gen(5, "0123456789")}#${gen(5)}`;
    out.push({ line: `password = "${pw}"`, secret: pw, kind: "generic-secret" });
    const tok = gen(32);
    out.push({ line: `API_KEY=${tok}${i}`, secret: `${tok}${i}`, kind: "generic-secret" });
    const cs = gen(28, `${ALNUM}-_`);
    out.push({ line: `  client_secret: '${cs}9'`, secret: `${cs}9`, kind: "generic-secret" });
  }
  return out;
}

const BENIGN = [
  'import { readFileSync } from "node:fs";',
  "const password = process.env.DB_PASSWORD;",
  'const token = req.headers["authorization"];',
  "function getSecret(name) { return vault.read(name); }",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a benign placeholder the detector must not flag
  'const apiKey = "${API_KEY}";',
  'password = "changeme"',
  'secret: "<your-secret-here>"',
  "TOKEN=",
  'export const SECRET_HEADER = "x-assay-secret";',
  "const tokenizer = new Tokenizer({ lowercase: true });",
  "if (token.length === 0) throw new Error('missing token');",
  'const sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";',
  'const uuid = "123e4567-e89b-12d3-a456-426614174000";',
  "const digest = createHash('sha256').update(data).digest('hex');",
  "for (let i = 0; i < items.length; i++) total += items[i].price;",
  "SELECT id, name FROM users WHERE id = ? AND deleted_at IS NULL;",
  "  - run: npm ci && npm test",
  "FROM node:22-alpine",
  "RUN apt-get update && apt-get install -y curl",
  "# The access token is refreshed every hour by the auth service.",
  'const url = "https://example.com/api/v1/items?page=2&limit=50";',
  'const base64Logo = "iVBORw0KGgo";',
  "const ghPrefix = 'ghp_'; // prefix used by personal tokens",
  "const re = /sk_live_[A-Za-z0-9]+/;",
  'console.log("Signing in with password reset link");',
  "let secretCount = 0;",
  "user.passwordHash = await bcrypt.hash(input, 12);",
  "const AKIA_PREFIX = 'AKIA';",
  "key: value",
  "version: 2.1",
  '"description": "A small library for parsing tokens in source code",',
  '"scripts": { "build": "tsc -p .", "test": "node --test" },',
  "export function verifyToken(token: string): boolean {",
  "const jwtHeader = { alg: 'HS256', typ: 'JWT' };",
  '<a href="/docs/api-keys">Manage API keys</a>',
  "token = tokens.next()",
  "api_key = settings.API_KEY",
  "PASSWORD_MIN_LENGTH=12",
  'const color = "#1f2937";',
  "const matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];",
  "while (queue.length) visit(queue.shift());",
  "throw new AssayError('unauthorized', { why: 'missing bearer token' });",
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "commit 9c92b90a1d1e3f2c0b6e8b4f8a5c3d2e1f0a9b8c",
  "-----BEGIN PUBLIC KEY-----",
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIC user@host",
  "const timeoutMs = 30_000;",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "secret_santa = assign(names)",
  "const tokens = text.split(/\\s+/);",
  "password: ********",
  "export type TokenKind = 'word' | 'number';",
  "const placeholder = 'sk-...';",
  '<input type="password" name="password" autocomplete="current-password">',
];

test("DETECTOR_VERSION is exported", () => {
  assert.match(DETECTOR_VERSION, /^assay\.redact\/\d+$/);
});

test("seeded corpus: no secret survives, each is replaced with kind and fingerprint", (t) => {
  const c = corpus();
  t.diagnostic(`redaction seeded=${c.length}`);
  assert.ok(c.length >= 100);
  let kindsMatched = 0;
  for (const { line, secret, kind } of c) {
    const r = redactString(line, "/x");
    assert.ok(!r.text.includes(secret), `secret survived (${kind}): ${r.text}`);
    assert.ok(r.redactions.length >= 1, line);
    const fp = createHash("sha256").update(secret).digest("hex").slice(0, 16);
    const hit = r.redactions.find((x) => x.fingerprint === fp);
    if (hit && hit.kind === kind) kindsMatched++;
    for (const x of r.redactions) {
      assert.match(x.fingerprint, /^[0-9a-f]{16}$/);
      assert.ok(r.text.includes(`[redacted:${x.kind}:${x.fingerprint.slice(0, 8)}]`));
      assert.equal(x.pointer, "/x");
    }
  }
  // The pem body is fingerprinted as part of the whole block, so not every row matches by fingerprint.
  assert.ok(kindsMatched >= c.length * 0.8, `kinds matched ${kindsMatched}/${c.length}`);
});

test("benign corpus: at most 2 false hits in >= 50 ordinary lines", (t) => {
  assert.ok(BENIGN.length >= 50);
  const hits = BENIGN.filter((l) => redactString(l).redactions.length > 0);
  t.diagnostic(`redaction benign=${BENIGN.length} false-hits=${hits.length}`);
  assert.ok(hits.length <= 2, `false hits: ${JSON.stringify(hits)}`);
});

test("redact walks JSON, reports pointers, never stores the value, keeps the input intact", () => {
  const ghp = `ghp_${gen(36)}`;
  const pw = `Zq${gen(10)}7!`;
  const input = {
    a: [1, "plain", `token ${ghp} here`],
    "we/ird~key": { password: pw },
    n: null,
    ok: true,
  };
  const before = JSON.stringify(input);
  const r = redact(input);
  assert.equal(JSON.stringify(input), before);
  const out = JSON.stringify(r.value);
  assert.ok(!out.includes(ghp) && !out.includes(pw));
  assert.deepEqual(r.redactions.map((x) => x.pointer).sort(), ["/a/2", "/we~1ird~0key/password"]);
  assert.ok(!JSON.stringify(r.redactions).includes(ghp));
  assert.deepEqual((r.value as { a: unknown[] }).a.slice(0, 2), [1, "plain"]);
});

test("same secret, same fingerprint; different secret, different fingerprint", () => {
  const s1 = `sk_live_${gen(24)}`;
  const s2 = `sk_live_${gen(24)}`;
  const a = redactString(`x ${s1}`).redactions[0]!;
  const b = redactString(`y ${s1} z`).redactions[0]!;
  const c = redactString(s2).redactions[0]!;
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test("an unterminated private key block is still redacted to the end", () => {
  const body = gen(200, B64);
  const r = redactString(`-----BEGIN RSA PRIVATE KEY-----\n${body}`);
  assert.ok(!r.text.includes(body));
});
