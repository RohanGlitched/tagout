/** The mark: a small lockout tag in danger red, grommet and chamfered corners, tilted as it hangs. */
export default function Mark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size * 1.25} viewBox="0 0 24 30" aria-hidden="true">
      <g transform="rotate(-8 12 6)">
        <path d="M6.5 2h11L22 6.5V28H2V6.5z" fill="#c8102e" />
        <rect x="2" y="12" width="20" height="5.2" fill="#fff" />
        <circle cx="12" cy="7" r="2.3" fill="#e9ecef" stroke="#fff" strokeWidth="1.2" />
      </g>
    </svg>
  );
}
