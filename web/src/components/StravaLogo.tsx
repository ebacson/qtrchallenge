/** Biểu tượng Strava (chevron), màu theo `currentColor` */
export function StravaMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"
      />
    </svg>
  )
}

/** Ô vuông cam có biểu tượng Strava */
export function StravaBadge({ size = 32 }: { size?: number }) {
  return (
    <span className="strava-badge" style={{ width: size, height: size }} aria-hidden="true">
      <StravaMark size={Math.round(size * 0.6)} />
    </span>
  )
}
