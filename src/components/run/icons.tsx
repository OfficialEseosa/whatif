/** Place-kind icons for the run panel (currentColor, 1.5 stroke like src/components/icons.tsx). */
import type { ReactNode } from "react";
import type { GazetteerKind } from "@/lib/contract";

const I = ({ children, size = 16, w = 1.6 }: { children: ReactNode; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** Small glyph for a gazetteer kind (12 px). */
export function KindIcon({ kind }: { kind: GazetteerKind | undefined }) {
  const p = { size: 14, w: 1.5 };
  switch (kind) {
    case "landmark":
      return (
        <I {...p}>
          <path d="m8 1.75 1.9 3.9 4.3.6-3.1 3 .75 4.25L8 11.5l-3.85 2 .75-4.25-3.1-3 4.3-.6z" />
        </I>
      );
    case "neighborhood":
      return (
        <I {...p}>
          <path d="M2.25 7.25 8 2.25l5.75 5v6.5H2.25z" />
          <path d="M6.5 13.75v-3.5h3v3.5" />
        </I>
      );
    case "marta_station":
      return (
        <I {...p}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5 10.75V5.5L8 9l3-3.5v5.25" />
        </I>
      );
    case "streetcar_stop":
      return (
        <I {...p}>
          <rect x="3.25" y="3.5" width="9.5" height="8" rx="2" />
          <path d="M3.25 7.5h9.5M5 14l1.25-2.5M11 14l-1.25-2.5M6 1.75h4" />
        </I>
      );
    case "employment":
      return (
        <I {...p}>
          <rect x="2" y="5" width="12" height="8.5" rx="1.5" />
          <path d="M5.75 5V3.25h4.5V5" />
        </I>
      );
    case "corridor_point":
      return (
        <I {...p}>
          <path d="M1.75 8h12.5" />
          <path d="M8 4.75 11.25 8 8 11.25 4.75 8z" fill="currentColor" />
        </I>
      );
    default:
      return (
        <I {...p}>
          <circle cx="8" cy="8" r="3" />
        </I>
      );
  }
}
