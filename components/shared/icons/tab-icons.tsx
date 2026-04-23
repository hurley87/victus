export function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 7H3c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 12H3V9h18v10zM3 5h15V3H3c-1.1 0-2 .9-2 2v1c.55-.61 1.33-1 2.22-1H3zm15 9a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0z" />
    </svg>
  );
}

export function TradeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Crossed swords */}
      <path d="M6.5 17.5l-1-1L14 8h2V6l3-3 1 1-1 1 1 1-3 3h-2l-8.5 8.5zM14.5 17.5l1-1L7 8H5V6L2 3 1 4l1 1-1 1 3 3h2l8.5 8.5zM12 11.5l1 1-1 1-1-1 1-1z" />
    </svg>
  );
}

export function StandingsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* Trophy/podium */}
      <path d="M19 5h-2V3H7v2H5C3.9 5 3 5.9 3 7v1c0 2.6 1.9 4.7 4.4 5 .6 1.4 1.7 2.6 3.1 3.2V18H8v2h8v-2h-2.5v-1.8c1.4-.6 2.5-1.8 3.1-3.2C19.1 12.7 21 10.6 21 8V7c0-1.1-.9-2-2-2zm-14 3V7h2v3.9C5.8 10.5 5 9.3 5 8zm14 0c0 1.3-.8 2.5-2 2.9V7h2v1z" />
    </svg>
  );
}
