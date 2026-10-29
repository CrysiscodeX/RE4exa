// The composer's hint says why Send is off. Found in a visual run of the demo: while the demo
// account was still being checked at start-up, the hint said it was signed out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { composerHint } from "../ui/src/hint.ts";

const acct = (status: "signed-in" | "signed-out" | "unknown" | "checking", checkedAt: number | null = 1) => ({
  status,
  checkedAt,
});
const hint = (accounts: ReturnType<typeof acct>[], account: ReturnType<typeof acct> | undefined, selected = true) =>
  composerHint({ providerName: "Claude", accounts, account, selected });

test("composer hint: an account still being checked reads as checking, not signed out", () => {
  const checking = /Checking the account's sign-in/;
  assert.match(hint([acct("checking")], acct("checking"))!, checking);
  assert.match(hint([acct("unknown", null)], acct("unknown", null))!, checking, "not checked yet");
  assert.match(hint([acct("checking")], undefined, false)!, checking, "none picked, one still checking");
});

test("composer hint: signed in, signed out, a failed check and no account each say their own thing", () => {
  assert.equal(hint([acct("signed-in")], acct("signed-in")), null);
  assert.match(hint([acct("signed-out")], acct("signed-out"))!, /is signed out/);
  assert.match(hint([acct("unknown")], acct("unknown"))!, /could not check/);
  assert.match(hint([], undefined)!, /No Claude account yet/);
  assert.match(hint([acct("signed-out")], undefined, false)!, /is signed out/, "none picked, none checking");
});
