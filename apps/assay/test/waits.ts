// Shared waits for tests that drive a running Assay (the browser end-to-end test, the demo path
// test, walk-through scripts). They wait on the app's state through its API, never on how the page
// looks, and fail with the last state they saw instead of carrying on with a stale one.
import type { AccountView, AppState, CaseDetail } from "../src/server/api-types.ts";

/** Calls Assay's HTTP API: from Node with the pairing cookie, or inside the page with fetch. */
export type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;

const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Assay checks each account when it starts; until that ends, the account cannot be used. */
export async function waitSignedIn(api: Api, provider: string, timeoutMs = 15_000): Promise<AccountView> {
  const end = Date.now() + timeoutMs;
  let seen: AccountView[] = [];
  while (Date.now() < end) {
    seen = (await api<AppState>("GET", "/api/state")).accounts.filter((a) => a.provider === provider);
    const ok = seen.find((a) => a.status === "signed-in");
    if (ok) return ok;
    await pause(100);
  }
  throw new Error(`no ${provider} account signed in after ${timeoutMs} ms: ${JSON.stringify(seen)}`);
}

/** Waits until `done` holds and the case's agent is no longer at work (claims are checked after the turn). */
export async function waitCase(
  api: Api,
  caseId: string,
  done: (d: CaseDetail) => boolean,
  timeoutMs = 30_000,
): Promise<CaseDetail> {
  const end = Date.now() + timeoutMs;
  let d: CaseDetail | null = null;
  while (Date.now() < end) {
    d = await api<CaseDetail>("GET", `/api/cases/${caseId}`);
    if (done(d) && !["working", "starting"].includes(d.summary.activity)) return d;
    await pause(50);
  }
  throw new Error(
    `case ${caseId} did not settle after ${timeoutMs} ms: activity ${d?.summary.activity}, ${d?.timeline.length} entries, claims ${JSON.stringify(d?.claims.map((c) => c.verdict))}`,
  );
}
