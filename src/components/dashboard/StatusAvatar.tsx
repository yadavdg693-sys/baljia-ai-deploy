// StatusAvatar — Polsia reference robot head avatar.
// Source: polsia/baljia-frontend/src/components/dashboard-shell.tsx:253-284.
// `live` variant adds a blue node (signal) and a green node (OK) on the right.

interface StatusAvatarProps {
  live?: boolean;
}

export function StatusAvatar({ live = false }: StatusAvatarProps) {
  return (
    <div className={`status-avatar ${live ? 'status-avatar--live' : ''}`}>
      <svg aria-hidden="true" viewBox="0 0 72 72">
        <rect
          fill="none"
          height="44"
          stroke="currentColor"
          strokeWidth="1.5"
          width="44"
          x="8"
          y="10"
        />
        <circle cx="28" cy="24" fill="none" r="3" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="42" cy="24" fill="none" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path d="M32 34 L36 39 L40 34" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M28 46 C30 43, 34 48, 36 46 C38 44, 41 48, 44 46"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        {live ? (
          <>
            <circle cx="61" cy="17" fill="#73c7ff" r="4" />
            <circle cx="58" cy="45" fill="#71d386" r="3" />
          </>
        ) : null}
      </svg>
    </div>
  );
}
