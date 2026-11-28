export function StepChartLoader() {
  return (
    <div className="watchlist-loading-chart" aria-hidden="true">
      <svg className="watchlist-loading-trend" viewBox="0 0 126 64" focusable="false">
        <path
          className="watchlist-loading-guide"
          d="M12 52 36 36 49 44 73 24 86 34 112 10 M100 10 H112 V22"
        />
        <path
          className="watchlist-loading-line"
          d="M12 52 36 36 49 44 73 24 86 34 112 10"
          pathLength="100"
        />
        <path className="watchlist-loading-arrow" d="M100 10 H112 V22" />
      </svg>
    </div>
  );
}
