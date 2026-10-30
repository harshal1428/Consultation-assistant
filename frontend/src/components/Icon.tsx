import type { SVGProps } from "react";

export type IconName =
  | "mic"
  | "micOff"
  | "stop"
  | "send"
  | "check"
  | "close"
  | "undo"
  | "resetView"
  | "eye"
  | "eyeOff"
  | "grid"
  | "heat"
  | "alertTriangle"
  | "alertCircle"
  | "info"
  | "history"
  | "newSession"
  | "activity"
  | "sliders"
  | "download"
  | "globe"
  | "shield"
  | "arrowRight"
  | "sparkle"
  | "folder"
  | "trash"
  | "edit"
  | "chevron"
  | "image"
  | "upload"
  | "compare"
  | "user";

const ICONS: Record<IconName, string> = {
  mic: "M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z|M19 10v2a7 7 0 0 1-14 0v-2|M12 19v4|M8 23h8",
  micOff:
    "M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6|M17 16.95A7 7 0 0 1 5 12v-2|M12 19v4|M8 23h8|M1 1l22 22",
  stop: "M6 6h12v12H6z",
  send: "M22 2L11 13|M22 2l-7 20-4-9-9-4 20-7z",
  check: "M20 6L9 17l-5-5",
  close: "M18 6L6 18|M6 6l12 12",
  undo: "M9 14L4 9l5-5|M4 9h10a6 6 0 0 1 0 12h-3",
  resetView: "M23 4v6h-6M1 20v-6h6|M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z|circle:12,12,3",
  eyeOff:
    "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24|M1 1l22 22",
  grid: "M3 3h7v7H3z|M14 3h7v7h-7z|M14 14h7v7h-7z|M3 14h7v7H3z",
  heat: "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  alertTriangle:
    "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01",
  alertCircle: "circle:12,12,10|M12 8v4|M12 16h.01",
  info: "circle:12,12,10|M12 16v-4|M12 8h.01",
  history: "M3 3v5h5|M3.05 13A9 9 0 1 0 6 5.3L3 8|M12 7v5l4 2",
  newSession:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6|M12 18v-6|M9 15h6",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3|M1 14h6|M9 8h6|M17 16h6",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
  globe:
    "circle:12,12,10|M2 12h20|M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  arrowRight: "M5 12h14|M12 5l7 7-7 7",
  sparkle: "M12 3v18M3 12h18|M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4",
  folder:
    "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z",
  trash:
    "M3 6h18|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2|M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6|M10 11v6|M14 11v6",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7|M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  chevron: "M6 9l6 6 6-6",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|circle:8.5,8.5,1.5|M21 15l-5-5L5 21",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12",
  compare: "M12 3v18|M8 7L4 11l4 4|M16 7l4 4-4 4",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2|circle:12,7,4",
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  title?: string;
}

type Primitive = { kind: "path"; d: string } | { kind: "circle"; cx: number; cy: number; r: number };

function parsePrimitive(token: string): Primitive {
  if (token.startsWith("circle:")) {
    const [cx, cy, r] = token.slice(7).split(",").map(Number);
    return { kind: "circle", cx, cy, r };
  }
  return { kind: "path", d: token };
}

export function Icon({ name, size = 18, title, ...rest }: IconProps) {
  const tokens = ICONS[name].split("|").map(parsePrimitive);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {tokens.map((t, i) =>
        t.kind === "circle" ? (
          <circle key={i} cx={t.cx} cy={t.cy} r={t.r} />
        ) : (
          <path key={i} d={t.d} />
        ),
      )}
    </svg>
  );
}
