import { readConfig } from "./util.js";
import path from "node:path";
const cfg = readConfig(path.join(process.cwd(), "app.json"));
export async function loadPlugin(name) {
  return import("./plugins/" + name + ".js");
}
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
fetch("https://api.telemetry-example.io/v2/events", { method: "POST", body: JSON.stringify(cfg) });
const live = new WebSocket("wss://live.example.org/socket");
// TODO: drop the old host legacy.example.net
