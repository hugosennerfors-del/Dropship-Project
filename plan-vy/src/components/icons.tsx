/** Enkla streckikoner. Inga emojis någonstans i appen. */
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const IconOverview = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
);
export const IconProducts = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
);
export const IconResearch = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
);
export const IconAlerts = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 0 0-6-6z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
);
export const IconInsights = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 3v1M4.9 6.3l.7.7M3 13.5h1M20 13.5h1M18.4 7l.7-.7" /><path d="M9 17.5a5 5 0 1 1 6 0c-.6.5-.9 1-1 1.8h-4c-.1-.8-.4-1.3-1-1.8z" /><path d="M10 21h4" /></svg>
);
export const IconChevron = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="m9 6 6 6-6 6" /></svg>
);
export const IconArrowUp = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
);
export const IconArrowDown = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 5v14M18 13l-6 6-6-6" /></svg>
);
export const IconWarning = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
);
export const IconCritical = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.5h.01" /></svg>
);
export const IconExternal = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
);
export const IconMenu = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const IconRefresh = (p: React.SVGProps<SVGSVGElement>) => (
  <svg {...base} {...p}><path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 5v6h-6" /></svg>
);
