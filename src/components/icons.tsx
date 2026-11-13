/** Inline icons (20 px, currentColor). No icon library in this project. */
import type { ReactNode } from "react";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const SearchIcon = () => (
  <Svg>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const HistoryIcon = () => (
  <Svg>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5v4h4" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const LayersIcon = () => (
  <Svg>
    <path d="m12 3.5 8.5 4.5L12 12.5 3.5 8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth="2.6" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
);
export const MinusIcon = () => (
  <Svg>
    <path d="M5.5 12h13" />
  </Svg>
);
export const HomeIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg size={16}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
