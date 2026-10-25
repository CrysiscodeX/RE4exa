// The 48 px left rail. Arrow keys move between items (roving tabindex); tooltips show on hover and focus.

import { type ReactNode, useRef } from "react";
import { useData } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { cx, rovingIndex } from "./util.ts";
import { goPage, type Page, useView } from "./view.ts";

const ITEMS: { page: Page; icon: IconName; label: string }[] = [
  { page: "cases", icon: "cases", label: "Cases" },
  { page: "accounts", icon: "accounts", label: "Accounts" },
  { page: "usage", icon: "usage", label: "Usage" },
  { page: "calibration", icon: "calibration", label: "Calibration" },
  { page: "settings", icon: "settings", label: "Settings" },
  { page: "doctor", icon: "doctor", label: "Doctor" },
];

export function Rail(): ReactNode {
  const page = useView((s) => s.page);
  const signedOut = useData((s) => s.app?.accounts.filter((a) => a.status === "signed-out").length ?? 0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.max(
    0,
    ITEMS.findIndex((i) => i.page === page),
  );
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-brand" aria-hidden="true" title="Assay">
        <Icon name="shieldOk" size={18} />
      </div>
      <ul className="rail-list">
        {ITEMS.map((it, i) => (
          <li key={it.page} className={cx(it.page === "settings" && "rail-push")}>
            <button
              type="button"
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={cx("rail-btn", page === it.page && "active")}
              aria-label={it.page === "accounts" && signedOut > 0 ? `${it.label}, ${signedOut} signed out` : it.label}
              aria-current={page === it.page ? "page" : undefined}
              data-tip={it.label}
              tabIndex={i === active ? 0 : -1}
              onClick={() => goPage(it.page)}
              onKeyDown={(e) => {
                const n = rovingIndex(e.key, i, ITEMS.length, "vertical");
                if (n === null) return;
                e.preventDefault();
                refs.current[n]?.focus();
              }}
            >
              <Icon name={it.icon} size={18} />
              {it.page === "accounts" && signedOut > 0 ? (
                <span className="rail-badge" aria-hidden="true">
                  {signedOut}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
