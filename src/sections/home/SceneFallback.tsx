/** Static illustration shown when WebGL is unavailable or the 3D context is lost. */
export function SceneFallback() {
  return (
    <div className="scene-fallback">
      <svg viewBox="0 0 960 520" role="img" aria-label="Illustration: an electric car connected by cable to a charging post, with an electric scooter charging beside it">
        <defs>
          <linearGradient id="sf-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sage)" stopOpacity=".35" />
            <stop offset="1" stopColor="var(--sage)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sf-energy" x1="0" x2="1">
            <stop offset="0" stopColor="#8EB69B" stopOpacity="0" />
            <stop offset=".5" stopColor="#DAF1DE" />
            <stop offset="1" stopColor="#8EB69B" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 250 L140 170 L240 220 L380 140 L520 210 L640 160 L800 220 L960 170 V300 H0Z" fill="var(--sage)" opacity=".18" />
        <rect x="0" y="300" width="960" height="220" fill="url(#sf-floor)" />
        {/* car */}
        <path d="M120 380 q6-52 70-66 l96-46 q62-26 170-18 l70 40 q66 8 86 52 l6 38 Z" fill="var(--surface-solid)" stroke="var(--moss)" strokeWidth="3" />
        <path d="M300 268 l60-26 q60-12 120-2 l50 30 Z" fill="var(--pine)" />
        <path d="M150 362 q120 8 300 -10 l170 -4" fill="none" stroke="var(--moss)" strokeWidth="10" opacity=".7" />
        <circle cx="220" cy="384" r="40" fill="var(--forest)" />
        <circle cx="220" cy="384" r="18" fill="#b8c5be" />
        <circle cx="540" cy="384" r="40" fill="var(--forest)" />
        <circle cx="540" cy="384" r="18" fill="#b8c5be" />
        <rect x="586" y="300" width="18" height="16" rx="4" fill="var(--forest)" />
        {/* charger */}
        <rect x="690" y="150" width="70" height="250" rx="18" fill="var(--surface-solid)" stroke="var(--line-strong)" strokeWidth="2" />
        <rect x="700" y="168" width="50" height="160" rx="8" fill="var(--pine)" />
        <path d="M728 205 l-12 20 h9 l-4 15 14-21 h-9 l3-14Z" fill="#DAF1DE" />
        <rect x="680" y="398" width="90" height="10" rx="4" fill="var(--moss)" />
        <path d="M692 230 C 640 260, 650 400, 620 395 S 600 320, 598 312" fill="none" stroke="var(--forest)" strokeWidth="7" strokeLinecap="round" />
        <path d="M692 230 C 640 260, 650 400, 620 395 S 600 320, 598 312" fill="none" stroke="url(#sf-energy)" strokeWidth="3" strokeLinecap="round" />
        {/* scooter */}
        <path d="M800 392 q0-44 38-58 l34-4 -8-62 h22 l12 74 q30 10 32 50 Z" fill="var(--surface-solid)" stroke="var(--moss)" strokeWidth="3" />
        <rect x="818" y="322" width="56" height="12" rx="6" fill="var(--spruce)" />
        <circle cx="822" cy="398" r="22" fill="var(--forest)" />
        <circle cx="912" cy="398" r="22" fill="var(--forest)" />
        <path d="M760 340 C 790 380, 800 400, 838 360" fill="none" stroke="var(--forest)" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <p className="scene-fallback-note">Illustration shown because 3D graphics are unavailable on this device.</p>
    </div>
  );
}
