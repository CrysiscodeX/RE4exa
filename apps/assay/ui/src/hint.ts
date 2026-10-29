// The line under the composer that says why Send is off. An account still being checked is not
// signed out: Assay checks each account when it starts, and Send turns on when that check ends.

interface AccountLike {
  status: "signed-in" | "signed-out" | "unknown" | "checking";
  checkedAt: number | null;
}

const pending = (a: AccountLike) => a.status === "checking" || (a.status === "unknown" && a.checkedAt === null);

/** `account` is the one Send would use; `selected` is whether the person picked one explicitly. */
export function composerHint(o: {
  providerName: string;
  accounts: AccountLike[];
  account: AccountLike | undefined;
  selected: boolean;
}): string | null {
  const { account, accounts } = o;
  if (account?.status === "signed-in") return null;
  if (accounts.length === 0) return `No ${o.providerName} account yet. Add one under Accounts in the left rail.`;
  if (account ? pending(account) : !o.selected && accounts.some(pending))
    return "Checking the account's sign-in… Send turns on when it is signed in.";
  if (account?.status === "unknown")
    return "Assay could not check this account's sign-in. Check it again from Accounts in the left rail.";
  return "The selected account is signed out. Sign in from Accounts in the left rail.";
}
