// Layered Grand Canyon hero in a modern national-park-poster style.
// Pure SVG: no image assets to load, crisp at every size.
export default function CanyonHero({ compact = false, title, subtitle }) {
  return (
    <header className={`hero ${compact ? 'hero-compact' : ''}`}>
      <svg
        className="hero-art"
        viewBox="0 0 1200 420"
        preserveAspectRatio="xMidYMax slice"
        role="img"
        aria-label="Stylized illustration of the Grand Canyon at dawn"
      >
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FBEBCB" />
            <stop offset="0.55" stopColor="#F5C083" />
            <stop offset="1" stopColor="#EC9760" />
          </linearGradient>
        </defs>

        {/* Sky and sun */}
        <rect width="1200" height="420" fill="url(#sky)" />
        <circle cx="880" cy="128" r="78" fill="#FDF3DE" opacity="0.35" />
        <circle cx="880" cy="128" r="46" fill="#FCEFD4" />

        {/* Birds */}
        <path d="M128 120 q10 -9 20 0 q10 -9 20 0" stroke="#7C3A26" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.55" />
        <path d="M186 148 q8 -7 16 0 q8 -7 16 0" stroke="#7C3A26" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.4" />

        {/* Canyon strata, back to front */}
        <path
          d="M0 216 L70 216 L96 184 L142 184 L164 210 L250 210 L282 174 L352 174 L376 206 L512 206 L540 172 L598 172 L622 200 L756 200 L796 162 L864 162 L896 194 L1006 194 L1038 168 L1102 168 L1126 198 L1200 198 L1200 420 L0 420 Z"
          fill="#DCA476"
        />
        <path
          d="M0 262 L54 262 L82 232 L140 232 L166 258 L246 258 L272 226 L330 226 L358 256 L470 256 L502 222 L568 222 L590 252 L700 252 L734 218 L806 218 L836 250 L940 250 L974 224 L1042 224 L1068 254 L1200 254 L1200 420 L0 420 Z"
          fill="#C57E51"
        />
        <path
          d="M0 306 L86 306 L114 276 L178 276 L204 302 L300 302 L332 268 L404 268 L430 300 L540 300 L574 266 L642 266 L668 298 L788 298 L818 270 L892 270 L920 300 L1030 300 L1062 274 L1128 274 L1152 302 L1200 302 L1200 420 L0 420 Z"
          fill="#A55B37"
        />
        <path
          d="M0 348 L64 348 L94 320 L166 320 L194 346 L296 346 L326 316 L402 316 L428 344 L556 344 L590 312 L666 312 L692 342 L820 342 L852 314 L930 314 L958 344 L1074 344 L1104 320 L1168 320 L1188 344 L1200 344 L1200 420 L0 420 Z"
          fill="#83422A"
        />
        <path
          d="M0 388 L110 388 L142 364 L232 364 L262 386 L400 386 L436 360 L530 360 L558 386 L706 386 L740 362 L838 362 L866 386 L1004 386 L1038 364 L1130 364 L1156 386 L1200 386 L1200 420 L0 420 Z"
          fill="#5F2E1D"
        />

        {/* River glint */}
        <path
          d="M310 402 q90 10 190 4 q120 -7 230 2 q110 8 210 0"
          stroke="#E8B87F"
          strokeWidth="4"
          fill="none"
          opacity="0.5"
          strokeLinecap="round"
        />
      </svg>

      <div className="hero-text">
        <span className="hero-kicker">Rim · to · Rim · to · Rim</span>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </header>
  )
}
