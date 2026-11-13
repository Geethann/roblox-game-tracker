// Shared pieces for "loading", "something went wrong" and "good to know" states.
import { Info, RefreshCw, TriangleAlert } from "lucide-react";

/** A grey placeholder shape shown while content loads. */
export function Skeleton({ width = "100%", height = 16, radius = 6 }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** A friendly error message with a "Try again" button. */
export function ErrorState({ error, onRetry }) {
  return (
    <div className="card error-state" role="alert">
      <TriangleAlert size={20} />
      <p>{error?.message ?? "Something went wrong."}</p>
      {onRetry && (
        <button type="button" className="button" onClick={() => onRetry()}>
          <RefreshCw size={16} /> Try again
        </button>
      )}
    </div>
  );
}

/** A highlighted note, e.g. "we only just started tracking this game". */
export function Notice({ children }) {
  return (
    <div className="notice" role="status">
      <Info size={18} />
      <p>{children}</p>
    </div>
  );
}
