export function StepChartLoader() {
  return (
    <div className="watchlist-loading-chart" aria-hidden="true">
      <div className="watchlist-loading-track">
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            style={{ left: `${(index - 2) * 18}px`, bottom: `${(index - 1) * 8}px` }}
          />
        ))}
      </div>
    </div>
  );
}
