import { useId } from 'react';

/** Brass-engraved word art. Used for the app title and every screen header (no plain-text headers). */
export function WordArt({ text, size = 34, align = 'start', animate = false, label }: {
  text: string; size?: number; align?: 'start' | 'middle'; animate?: boolean; label?: string;
}) {
  const id = useId().replace(/:/g, '');
  const width = Math.ceil(text.length * size * 0.62 + size * 0.6);
  const height = Math.ceil(size * 1.35);
  const x = align === 'middle' ? width / 2 : size * 0.1;
  return (
    <svg className={`wordart${animate ? ' wordart--animate' : ''}`} viewBox={`0 0 ${width} ${height}`}
      width={width} height={height} role="img" aria-label={label ?? text}
      style={{ maxWidth: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9FC0C2" />
          <stop offset="0.42" stopColor="#5E8C8F" />
          <stop offset="0.58" stopColor="#A8742A" />
          <stop offset="1" stopColor="#7FA8AA" />
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#A9B3B8" stopOpacity="0" />
          <stop offset="0.5" stopColor="#A9B3B8" stopOpacity="0.85" />
          <stop offset="1" stopColor="#A9B3B8" stopOpacity="0" />
        </linearGradient>
        <filter id={`f${id}`} x="-10%" y="-20%" width="120%" height="150%">
          <feDropShadow dx="0" dy={size * 0.06} stdDeviation={size * 0.05} floodColor="#07040B" floodOpacity="0.8" />
          <feDropShadow dx="0" dy="0" stdDeviation={size * 0.18} floodColor="#5E8C8F" floodOpacity="0.25" />
        </filter>
        <clipPath id={`c${id}`}>
          <text x={x} y={size * 1.02} textAnchor={align} className="wordart__text" style={{ fontSize: size }}>{text}</text>
        </clipPath>
      </defs>
      <g filter={`url(#f${id})`}>
        <text x={x} y={size * 1.02} textAnchor={align} className="wordart__text"
          style={{ fontSize: size }} fill={`url(#g${id})`} stroke="#3A2410" strokeWidth={size * 0.035} paintOrder="stroke" >
          {text}
        </text>
      </g>
      <g clipPath={`url(#c${id})`}>
        <rect className="wordart__shine" x={-width} y="0" width={width * 0.5} height={height} fill={`url(#s${id})`} opacity="0.55" />
        <rect x="0" y={size * 0.55} width={width} height={size * 0.04} fill="#B8CACB" opacity="0.35" />
      </g>
    </svg>
  );
}
