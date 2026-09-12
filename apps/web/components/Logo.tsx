export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="url(#formdrop-logo-gradient)" />
      <path
        d="M16 7c3.2 4.2 6 8.1 6 11 0 3.31-2.69 6-6 6s-6-2.69-6-6c0-2.9 2.8-6.8 6-11Z"
        fill="#fff"
        opacity="0.96"
      />
      <path
        d="M12.6 17.9l2.2 2.2 4.6-4.6"
        stroke="#5B4CFB"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="formdrop-logo-gradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#7C6DFF" />
          <stop offset="1" stopColor="#4A3BEA" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark({ withTagline = true }: { withTagline?: boolean }) {
  return (
    <div className="brand">
      <LogoMark />
      <div className="brand-text">
        <span className="brand-name">FormDrop</span>
        {withTagline && <span className="brand-tagline">Real answers. Instant payouts.</span>}
      </div>
    </div>
  );
}
