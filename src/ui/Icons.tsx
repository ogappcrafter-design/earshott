const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const I = ({ d, size = 24 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...P}><path d={d} /></svg>
);
export const IconEar = (p: { size?: number }) => <I {...p} d="M7 10a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.6 1.5M10 10a2 2 0 0 1 4 0c0 1.2-1 1.7-1.6 2.4" />;
export const IconSliders = (p: { size?: number }) => <I {...p} d="M5 4v6m0 4v6M12 4v2m0 4v10M19 4v10m0 4v2M3 12h4M10 8h4M17 16h4" />;
export const IconVoice = (p: { size?: number }) => <I {...p} d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />;
export const IconArchive = (p: { size?: number }) => <I {...p} d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7zM3 4h18v3H3zM9 11h6" />;
export const IconGear = (p: { size?: number }) => <I {...p} d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" />;
export const IconPlay = (p: { size?: number }) => <I {...p} d="M7 5l12 7-12 7z" />;
export const IconPause = (p: { size?: number }) => <I {...p} d="M8 5v14M16 5v14" />;
export const IconShare = (p: { size?: number }) => <I {...p} d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />;
export const IconSave = (p: { size?: number }) => <I {...p} d="M12 4v11m-5-5 5 5 5-5M5 20h14" />;
export const IconTrash = (p: { size?: number }) => <I {...p} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />;
export const IconBack = (p: { size?: number }) => <I {...p} d="M15 5l-7 7 7 7" />;
export const IconBookmark = (p: { size?: number }) => <I {...p} d="M6 3h12v18l-6-4-6 4z" />;
export const IconText = (p: { size?: number }) => <I {...p} d="M4 6h16M4 11h16M4 16h10" />;
export const IconSearch = (p: { size?: number }) => <I {...p} d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />;
export const IconPlus = (p: { size?: number }) => <I {...p} d="M12 5v14M5 12h14" />;
export const IconCheck = (p: { size?: number }) => <I {...p} d="M5 12l5 5 9-10" />;
export const IconHeadphones = (p: { size?: number }) => <I {...p} d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z" />;
