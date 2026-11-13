/**
 * The WhatIf ATL lockup: a small route glyph (two built stops, then a dashed "what if" leg to an unbuilt
 * stop in the accent color), lowercase "whatif" in Space Grotesk, and a thin "/atl" in mono.
 */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 26 15 17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path className="mark-dash" d="M15 17 23.5 8.5" stroke="currentColor" strokeWidth="3" strokeDasharray="2.4 3" />
      <circle cx="6" cy="26" r="3.4" fill="currentColor" />
      <circle cx="15" cy="17" r="3.4" fill="currentColor" />
      <circle cx="25" cy="7" r="4" fill="none" stroke="var(--accent)" strokeWidth="2.6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="WhatIf ATL">
      <Mark />
      <span className="wordmark-word" aria-hidden="true">
        whatif
      </span>
      <span className="wordmark-city" aria-hidden="true">
        /atl
      </span>
    </span>
  );
}
