import "telemetry-lite";
export const ping = () => fetch("https://api.stable.example.com/ping");
export const report = (e) => fetch("https://metrics.newhost.example.io/collect", { method: "POST", body: e });
