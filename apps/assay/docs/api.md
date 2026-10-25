# Assay server API

The server listens on `127.0.0.1` only, on a random port unless `--port` is given. Every route except
`POST /api/pair` needs the session cookie `assay_session`, which is HttpOnly and SameSite=Strict.
Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are refused, which blocks
DNS rebinding. Requests whose `Origin` does not match are also refused. Types live in
[`src/server/api-types.ts`](../src/server/api-types.ts).

## Pairing

`assay serve` prints `http://127.0.0.1:<port>/#pair=<code>`. The code can be used once and expires
after 5 minutes. The page posts it to `POST /api/pair {code}`, and the server replies by setting the
session cookie (HMAC-signed, valid for 30 days).

## Routes

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/pair` | `{code}` | `{ok}` and the cookie |
| `POST /api/ws-ticket` | — | `{ticket}`, valid for 5 minutes, single use |
| `GET /api/state` | — | `AppState` |
| `GET /api/doctor` | — | `DoctorCheck[]` |
| `POST /api/cases` | `{title, workspace?, recipeId?, path?}` | `CaseSummary` |
| `GET /api/cases/:id` | — | `CaseDetail` |
| `PATCH /api/cases/:id` | `{title?, settings?}` | `CaseSummary` |
| `POST /api/cases/:id/messages` | `SendMessageRequest` | `202 {accepted: true}`; progress arrives over the WebSocket |
| `POST /api/cases/:id/estimate` | `SendMessageRequest` | `CostEstimate` |
| `POST /api/cases/:id/interrupt` | — | `{ok}` |
| `POST /api/cases/:id/fork` | `{atSeq}` | `CaseSummary` |
| `POST /api/cases/:id/sweep` | `{path}` | `SweepReport` |
| `POST /api/cases/:id/verify` | — | `ClaimView[]` (every `seen` claim re-run) |
| `POST /api/cases/:id/reassay` | `{path}` | `{added, removed, unchanged}` paired by FindingKey |
| `POST /api/cases/:id/second-opinion` | `{workerId, provider, accountId}` | `WorkerView` |
| `POST /api/cases/:id/workers` | `{task, provider, accountId, worktree?}` | `WorkerView` |
| `POST /api/workers/:id/release` | — | `{ok}` |
| `POST /api/approvals/:id` | `{decision: "approve" \| "deny", reason?}` | `ApprovalView` |
| `GET /api/accounts` | — | `AccountView[]` |
| `POST /api/accounts` | `{provider, label, home: "new" \| "default"}` | `AccountView` |
| `POST /api/accounts/:id/check` | — | `AccountView` |
| `POST /api/accounts/:id/login` | — | `{started}`; terminal output arrives as `login-output` pushes |
| `POST /api/accounts/:id/login-input` | `{data}` | `{ok}` (keystrokes for the login terminal) |
| `DELETE /api/accounts/:id` | — | `{ok}` (removes the registry entry; the provider's own files are not touched) |
| `GET /api/evidence/:observationId` | — | the full claim record |
| `GET /api/cases/:id/export?format=s2\|sarif\|cyclonedx\|md\|bundle` | — | a file download |
| `GET /api/usage?by=account_id\|provider\|case_id\|worker_id` | — | `UsageRow[]` |
| `GET /api/calibration` | — | `CalibrationView[]` |
| `GET /api/capabilities` | — | `capabilities.json` |

## WebSocket

Open `GET /api/ws?ticket=<ticket>`. The server pushes `ServerPush` messages as JSON text frames.
The client sends nothing except `{"type":"ping"}`, which keeps the connection alive.

## Errors

Every error body has the form `{error: {code, message, retryable, fix, detail}}`. The code comes
from `src/errors.ts`. The HTTP status is 400 for `bad_request`, 401 for `unauthorized`, 404 for
`not_found`, 409 for conflicts and 500 otherwise.
