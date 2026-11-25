export function VisibilityIcon({ hidden = false }: { hidden?: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {hidden && <path d="M3 21 21 3" strokeWidth="1.7" />}
    </svg>
  );
}

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <rect x="5" y="10" width="14" height="11" rx="2" />
      {locked ? <path d="M8 10V6a4 4 0 0 1 8 0v4" /> : <path d="M8 10V6a4 4 0 0 1 8 0" />}
      <path d="M12 14v3" />
    </svg>
  );
}
export function DeleteIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden="true"
    >
      <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </svg>
  );
}
