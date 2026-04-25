interface PlaceraLogoProps {
  className?: string;
  showText?: boolean;
}

export function PlaceraLogo({ className = "w-10 h-10", showText = true }: PlaceraLogoProps) {
  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 120 120"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>

          <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>

          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* Background geometric pattern */}
        <circle cx="60" cy="60" r="54" fill="url(#mainGradient)" opacity="0.08" />
        <circle cx="60" cy="60" r="45" fill="url(#mainGradient)" opacity="0.05" />

        {/* Main hexagonal badge */}
        <path
          d="M 60 15 L 85 30 L 85 60 L 60 75 L 35 60 L 35 30 Z"
          fill="url(#mainGradient)"
          opacity="0.15"
        />

        {/* Modern P letterform with neural network nodes */}
        <path
          d="M 42 35 L 42 85"
          stroke="url(#mainGradient)"
          strokeWidth="7"
          strokeLinecap="round"
          filter="url(#glow)"
        />

        <path
          d="M 42 35 L 68 35 C 78 35 83 40 83 50 C 83 60 78 65 68 65 L 42 65"
          stroke="url(#mainGradient)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          filter="url(#glow)"
        />

        {/* Neural network connections */}
        <line x1="50" y1="45" x2="62" y2="50" stroke="url(#accentGradient)" strokeWidth="2" opacity="0.4" />
        <line x1="50" y1="55" x2="62" y2="50" stroke="url(#accentGradient)" strokeWidth="2" opacity="0.4" />
        <line x1="62" y1="50" x2="72" y2="50" stroke="url(#accentGradient)" strokeWidth="2" opacity="0.4" />

        {/* AI neural nodes */}
        <circle cx="50" cy="45" r="3.5" fill="#3b82f6" filter="url(#glow)" />
        <circle cx="50" cy="55" r="3.5" fill="#6366f1" filter="url(#glow)" />
        <circle cx="62" cy="50" r="4" fill="#8b5cf6" filter="url(#glow)" />
        <circle cx="72" cy="50" r="3.5" fill="#06b6d4" filter="url(#glow)" />

        {/* Voice/Interview waveform */}
        <path
          d="M 38 75 L 42 72 L 46 78 L 50 70 L 54 76 L 58 71 L 62 77 L 66 73 L 70 75"
          stroke="url(#accentGradient)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.7"
          filter="url(#glow)"
        />

        {/* Accent dots for tech feel */}
        <circle cx="30" cy="40" r="1.5" fill="#3b82f6" opacity="0.6" />
        <circle cx="88" cy="65" r="1.5" fill="#8b5cf6" opacity="0.6" />
        <circle cx="35" cy="75" r="1.5" fill="#06b6d4" opacity="0.6" />

        {/* Subtle shine effect */}
        <ellipse cx="50" cy="40" rx="8" ry="15" fill="url(#shimmer)" opacity="0.3" />
      </svg>

      {showText && (
        <div className="flex flex-col">
          <span className="text-2xl font-bold bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 bg-clip-text text-transparent tracking-tight">
            Placera
          </span>
          <span className="text-[10px] tracking-widest text-slate-500 -mt-1">AI INTERVIEWS</span>
        </div>
      )}
    </div>
  );
}
