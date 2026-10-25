// Inline SVG icons drawn for Assay (16×16 grid, stroked with currentColor). Decorative by default.

import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  cases: (
    <>
      <path d="M6 1.5h4M7 1.5v4.2L2.6 12.8A1.1 1.1 0 0 0 3.5 14.5h9a1.1 1.1 0 0 0 .9-1.7L9 5.7V1.5" />
      <path d="M4.3 10h7.4" />
    </>
  ),
  accounts: (
    <>
      <circle cx="8" cy="5.5" r="2.8" />
      <path d="M2.5 14.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
    </>
  ),
  usage: (
    <>
      <path d="M2 14.5h12" />
      <path d="M4 12V8.5M8 12V3.5M12 12V6.5" />
    </>
  ),
  calibration: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
    </>
  ),
  settings: (
    <>
      <path d="M2 4h7M12 4h2M2 8h2M7 8h7M2 12h8M13 12h1" />
      <circle cx="10.5" cy="4" r="1.5" />
      <circle cx="5.5" cy="8" r="1.5" />
      <circle cx="11.5" cy="12" r="1.5" />
    </>
  ),
  doctor: <path d="M1 8.5h3l1.5-4 2.5 8 2-6 1.2 2H15" />,
  fork: (
    <>
      <circle cx="4.5" cy="3" r="1.5" />
      <circle cx="11.5" cy="3" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
      <path d="M4.5 4.5v1A2.5 2.5 0 0 0 7 8h2a2.5 2.5 0 0 0 2.5-2.5v-1M8 8v3.5" />
    </>
  ),
  shieldOk: (
    <>
      <path d="M8 1.5 13.5 3.5v4c0 3.2-2.3 5.8-5.5 7-3.2-1.2-5.5-3.8-5.5-7v-4z" />
      <path d="m5.5 8 1.8 1.8L10.8 6.3" />
    </>
  ),
  shieldBad: (
    <>
      <path d="M8 1.5 13.5 3.5v4c0 3.2-2.3 5.8-5.5 7-3.2-1.2-5.5-3.8-5.5-7v-4z" />
      <path d="M8 5v3.5M8 10.8v.2" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 4 4" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  chevronDown: <path d="m4 6 4 4 4-4" />,
  chevronRight: <path d="m6 4 4 4-4 4" />,
  send: <path d="M2 8 14 2l-3 12-3-5zM8 9l6-7" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  copy: (
    <>
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </>
  ),
  panel: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
    </>
  ),
  command: (
    <path d="M5.5 5.5h5v5h-5zM5.5 5.5V4a1.5 1.5 0 1 0-1.5 1.5zM10.5 5.5H12A1.5 1.5 0 1 0 10.5 4zM10.5 10.5V12a1.5 1.5 0 1 0 1.5-1.5zM5.5 10.5H4A1.5 1.5 0 1 0 5.5 12z" />
  ),
  edit: <path d="m10.5 2.5 3 3L6 13H3v-3zM9 4l3 3" />,
  terminal: (
    <>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="m4.5 6 2 2-2 2M8.5 10.5h3" />
    </>
  ),
  verify: <path d="m3 8.5 3 3 7-7" />,
  sweep: <path d="M2 13.5h12M3.5 13.5l2-8h5l2 8M7 5.5V2h2v3.5" />,
  reassay: (
    <>
      <path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1" />
      <path d="M13.5 2v3.5H10" />
    </>
  ),
  download: <path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />,
  worker: (
    <>
      <rect x="3" y="5" width="10" height="8" rx="2" />
      <path d="M8 2v3M6 9h.01M10 9h.01" />
    </>
  ),
  claude: <path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" />,
  codex: <path d="M8 1.5 13.6 4.75v6.5L8 14.5l-5.6-3.25v-6.5zM8 8l5.6-3.25M8 8v6.5M8 8 2.4 4.75" />,
  acp: (
    <>
      <path d="M5 1.5v4M11 1.5v4M3.5 5.5h9v2.5a4.5 4.5 0 0 1-9 0z" />
      <path d="M8 12.5v2" />
    </>
  ),
  fake: <path d="M5.5 1.5h5M6.5 1.5v5l-4 7h11l-4-7v-5" />,
  warning: (
    <>
      <path d="M8 1.8 14.8 13.8H1.2z" />
      <path d="M8 6v3.5M8 11.6v.2" />
    </>
  ),
  check: <path d="m3 8.5 3 3 7-7" />,
  cross: <path d="m4 4 8 8M12 4l-8 8" />,
  question: (
    <>
      <path d="M5.8 6a2.3 2.3 0 1 1 3.4 2c-.8.4-1.2.9-1.2 1.7v.3" />
      <path d="M8 12.4v.2" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number; label?: string; className?: string }): ReactNode {
  const size = props.size ?? 16;
  const common = {
    className: props.className ? `icon ${props.className}` : "icon",
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    focusable: "false" as const,
  };
  if (props.label)
    return (
      <svg {...common} role="img" aria-label={props.label}>
        <title>{props.label}</title>
        {PATHS[props.name]}
      </svg>
    );
  return (
    <svg {...common} aria-hidden="true">
      {PATHS[props.name]}
    </svg>
  );
}

export function ProviderIcon(props: { provider: string; size?: number }): ReactNode {
  const name = (["claude", "codex", "acp", "fake"].includes(props.provider) ? props.provider : "acp") as IconName;
  return <Icon name={name} size={props.size ?? 14} className={`prov prov-${name}`} />;
}
