// The built-in probes: pure TypeScript, no external tools, every read and loop bounded.

import type { AssayProbe } from "../util.ts";
import { archiveList } from "./archive.ts";
import { fileContains, fileHash, fileStrings } from "./bytes.ts";
import { elfInfo } from "./elf.ts";
import { fileIdentify } from "./identify.ts";
import { codeObfuscation, jsEndpoints, jsImports } from "./js.ts";
import { machoInfo } from "./macho.ts";
import { peInfo } from "./pe.ts";
import { dirInventory, pkgManifest, pkgNativeAddons } from "./pkg.ts";
import { wasmInfo } from "./wasm.ts";

export const BUILTIN_PROBES: AssayProbe[] = [
  fileIdentify,
  fileHash,
  fileStrings,
  fileContains,
  dirInventory,
  archiveList,
  pkgManifest,
  pkgNativeAddons,
  jsImports,
  jsEndpoints,
  elfInfo,
  peInfo,
  machoInfo,
  wasmInfo,
  codeObfuscation,
];
