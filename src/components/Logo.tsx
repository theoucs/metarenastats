export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-gradient)" />
      <circle cx="16" cy="10.5" r="3.2" fill="white" />
      <circle cx="9.5" cy="21" r="3.2" fill="white" />
      <circle cx="22.5" cy="21" r="3.2" fill="white" />
    </svg>
  );
}
