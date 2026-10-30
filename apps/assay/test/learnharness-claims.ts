// Claims about LearnHarness 0.4.0 (dc4c398), shared by the verifier test and the full-stack
// demo: each fact as its source states it, beside a false twin a reviewer could plausibly assume.
import type { Json } from "@re4exa/core/evidence/jcs";

/** [claim text, predicate, params, verdict]: each fact as LearnHarness's source states it, and a
 * false twin that a reviewer could plausibly assume. */
export const CLAIMS: [string, string, Record<string, Json>, "verified" | "refuted"][] = [
  ["LearnHarness depends on Next.js", "pkg.has-dependency", { path: "learnharness", name: "next" }, "verified"],
  ["LearnHarness depends on lodash", "pkg.has-dependency", { path: "learnharness", name: "lodash" }, "refuted"],
  [
    "Electron is a development dependency",
    "pkg.has-dependency",
    { path: "learnharness", name: "electron", scope: "devDependencies" },
    "verified",
  ],
  [
    "Electron is a runtime dependency",
    "pkg.has-dependency",
    { path: "learnharness", name: "electron", scope: "dependencies" },
    "refuted",
  ],
  [
    "LearnHarness runs a postinstall script",
    "pkg.has-install-script",
    { path: "learnharness", hook: "postinstall" },
    "refuted",
  ],
  [
    "LearnHarness does not run a postinstall script",
    "pkg.has-install-script",
    { path: "learnharness", hook: "postinstall", negate: true },
    "verified",
  ],
  [
    "The main window isolates its renderer context",
    "file.contains",
    { path: "learnharness/electron/main.cjs", text: "contextIsolation: true" },
    "verified",
  ],
  [
    "The main window turns on Node integration",
    "file.contains",
    { path: "learnharness/electron/main.cjs", text: "nodeIntegration: true" },
    "refuted",
  ],
  [
    "The Electron main process loads electron",
    "js.imports",
    { path: "learnharness/electron/main.cjs", specifier: "electron" },
    "verified",
  ],
  [
    "The Electron main process loads axios",
    "js.imports",
    { path: "learnharness/electron/main.cjs", specifier: "axios" },
    "refuted",
  ],
  [
    "The root layout loads Google fonts through next/font",
    "js.imports",
    { path: "learnharness/app/layout.tsx", specifier: "next/font/google" },
    "verified",
  ],
  ["The root layout loads axios", "js.imports", { path: "learnharness/app/layout.tsx", specifier: "axios" }, "refuted"],
  [
    "Web search calls Tavily",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.tavily.com" },
    "verified",
  ],
  [
    "Web search calls Brave Search",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.search.brave.com" },
    "verified",
  ],
  [
    "Web search calls Bing's Web Search API",
    "endpoint.present",
    { path: "learnharness/src/server/search.ts", host: "api.bing.microsoft.com" },
    "refuted",
  ],
];
