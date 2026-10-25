import { readFileSync } from "node:fs";
export const readConfig = (p) => JSON.parse(readFileSync(p, "utf8"));
