// Crafted symbol names (D-31): copies of a committed fixture whose 14-byte symbol name
// "_IO_stdin_used" is replaced, byte for byte, by a name a target could use to confuse a reader of
// llvm-nm's output (a newline, CR LF, a tab, spaces that mimic fields, control bytes, a line that
// looks like a record of a guessed path, bytes that are not UTF-8). The copies are derived in a
// temporary directory at test and oracle time, never committed; each derived file's SHA-256 is
// pinned here, so a changed source or a changed derivation fails loudly. The committed fixtures are
// only read.
// The answer key is the construction itself (the bytes written), confirmed by llvm-readobj in
// scripts/oracle.ts (bench/oracle/names.json).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NAME_SOURCE = "hello-x86_64-linux-gnu.2.28-g";
export const NAME_SLOT = "_IO_stdin_used";
/** The source holds the slot twice (the symbol string table and a debug string); both are replaced. */
const MAX_SLOTS = 16;

export interface NameCase {
  id: string;
  /** The 14 bytes written in place of the slot, as hex. */
  hex: string;
  /** SHA-256 of the derived file. */
  sha256: string;
}

const hexOf = (latin1: string) => Buffer.from(latin1, "latin1").toString("hex");

export const NAME_CASES: NameCase[] = [
  {
    id: "newline",
    hex: hexOf("a T 1 1\nevil_x"),
    sha256: "1a075142f3c51bbd899276c0b0b4b42074ecc2f36b2b4788c88446cc927706f4",
  },
  {
    id: "crlf",
    hex: hexOf("crlf\r\nname_xxx"),
    sha256: "f74c520ec880e79806ebef2e2a97094ae407b6bbf8357defdf226f0b162a374e",
  },
  {
    id: "tab",
    hex: hexOf("tab\tname_xxxxx"),
    sha256: "13847fa1803ae2e4a0b39621354e783c6eb5de88852f9fadb029cfd434c24d8a",
  },
  {
    id: "fields",
    hex: hexOf("x T 10 T 20 30"),
    sha256: "12ba9b29fcf9ed6f4c786541aa3daf8f9a6fcef8a7e206567039f70c8095b902",
  },
  {
    id: "control",
    hex: hexOf("ctl\x01name\x7fxxxxx"),
    sha256: "93a6353b574e2f5f2edb3cdc9a1c8e69f7f8e5cb15f927406ddd0266be2dcdca",
  },
  {
    id: "guessed-prefix",
    hex: hexOf("q\n/gg: z T 2 0"),
    sha256: "f114f8cf397f66372aa1cc08b6d1383b27b7e0136584ec8539d7e6fce78878b2",
  },
  {
    id: "not-utf8",
    hex: hexOf("bad\xffname_xxxxx"),
    sha256: "060d312cc4c180dfef8249906612a59ae4411b33cbae009d55f23d30af1bf078",
  },
];

/** The derived bytes for one case (the source with every slot replaced). */
export function deriveName(c: NameCase, binDir: string): Buffer {
  const b = readFileSync(join(binDir, NAME_SOURCE));
  const from = Buffer.from(`\0${NAME_SLOT}\0`, "latin1");
  const to = Buffer.concat([Buffer.from([0]), Buffer.from(c.hex, "hex"), Buffer.from([0])]);
  if (from.length !== to.length) throw new Error(`${c.id}: the name must be ${NAME_SLOT.length} bytes`);
  let n = 0;
  for (let i = b.indexOf(from); i >= 0 && n < MAX_SLOTS; i = b.indexOf(from, i + 1), n++) to.copy(b, i);
  if (n === 0) throw new Error(`${NAME_SOURCE} has no ${NAME_SLOT}`);
  return b;
}

/** Write every case into `dir` and check each against its pinned digest. */
export function deriveNameFixtures(
  dir: string,
  binDir: string,
): { case: NameCase; path: string; name: Buffer; sha256: string }[] {
  return NAME_CASES.map((c) => {
    const b = deriveName(c, binDir);
    const sha256 = createHash("sha256").update(b).digest("hex");
    if (sha256 !== c.sha256) throw new Error(`${c.id}: derived ${sha256}, pinned ${c.sha256}`);
    const path = join(dir, `name-${c.id}.elf`);
    writeFileSync(path, b);
    return { case: c, path, name: Buffer.from(c.hex, "hex"), sha256 };
  });
}

if (import.meta.main) {
  // print each case's digest (for pinning after a deliberate change of a case)
  const bin = join(import.meta.dirname, "..", "fixtures", "bin");
  for (const c of NAME_CASES) console.log(c.id, createHash("sha256").update(deriveName(c, bin)).digest("hex"));
}
