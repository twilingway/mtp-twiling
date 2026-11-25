export function ChevronIcon({
  direction = "down",
  className = ""
}: {
  direction?: "down" | "right" | "left";
  className?: string;
}) {
  return (
    <svg
      className={`drawing-chevron ${className}`.trim()}
      data-direction={direction}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={
          direction === "right"
            ? "m6 4 4 4-4 4"
            : direction === "left"
              ? "m10 4-4 4 4 4"
              : "m4 6 4 4 4-4"
        }
      />
    </svg>
  );
}
