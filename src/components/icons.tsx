/** Inline icons (currentColor, 16px, rounded 1.5px strokes). No icon library in this project. */
import type { ReactNode } from "react";

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const HistoryIcon = () => (
  <Svg>
    <path d="M6 4v16" />
    <circle cx="6" cy="7" r="2.2" fill="currentColor" />
    <circle cx="6" cy="17" r="2.2" fill="none" />
    <path d="M11 7h9M11 12h6M11 17h9" />
  </Svg>
);
export const LayersIcon = () => (
  <Svg>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5 12 4Z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </Svg>
);
export const HelpIcon = () => (
  <Svg>
    <rect x="3.5" y="3.5" width="17" height="17" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.8" />
    <path d="M12 16.6v.4" />
  </Svg>
);
export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" strokeLinejoin="round" />
  </Svg>
);
export const PauseIcon = () => (
  <Svg>
    <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth="3" strokeLinecap="butt" />
  </Svg>
);
export const ResetIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
  </Svg>
);
export const CloseIcon = () => (
  <Svg size={16}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const CheckIcon = () => (
  <Svg size={16}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const ArrowRightIcon = () => (
  <Svg size={16}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Svg>
);
export const ChevronLeftIcon = () => (
  <Svg size={16}>
    <path d="m14.5 6-6 6 6 6" />
  </Svg>
);
export const ChevronRightIcon = () => (
  <Svg size={16}>
    <path d="m9.5 6 6 6-6 6" />
  </Svg>
);
export const ArrowUpIcon = () => (
  <Svg size={16}>
    <path d="M12 19V5M6 11l6-6 6 6" strokeWidth="2" />
  </Svg>
);
export const ChevronDownIcon = () => (
  <Svg size={14}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);
export const ClockIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const EditIcon = () => (
  <Svg size={16}>
    <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg size={16}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const StopIcon = () => (
  <Svg size={14}>
    <rect x="6" y="6" width="12" height="12" fill="currentColor" />
  </Svg>
);
export const UndergroundIcon = () => (
  <Svg>
    <path d="M3 9h18" />
    <path d="M6 20v-5a6 6 0 0 1 12 0v5" strokeDasharray="2.5 2.5" />
  </Svg>
);
