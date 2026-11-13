// A list of the game's updates and title changes in the chosen range.
// Clicking one highlights its marker on the chart.
import { useState } from "react";
import { PencilLine, Rocket } from "lucide-react";
import { formatDateTime, timeAgo } from "../lib/format.js";

const SHOW_AT_FIRST = 6;

export default function EventTimeline({ events, highlighted, onHighlight, now }) {
  const [showAll, setShowAll] = useState(false);
  const newestFirst = [...events].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, SHOW_AT_FIRST);

  return (
    <section className="card timeline" aria-labelledby="timeline-title">
      <h2 id="timeline-title">Updates</h2>
      <p className="muted small">When the developer published, or renamed the game, in this range.</p>
      {events.length === 0 ? (
        <p className="empty">No updates or title changes in this range.</p>
      ) : (
        <ol className="timeline-list">
          {shown.map((event) => {
            const isOn = event.t === highlighted;
            const Icon = event.kind === "update" ? Rocket : PencilLine;
            return (
              <li key={`${event.kind}-${event.t}`}>
                <button type="button" className={`timeline-item${isOn ? " is-highlighted" : ""}`}
                        aria-pressed={isOn} onClick={() => onHighlight(isOn ? null : event.t)}>
                  <span className="timeline-icon" aria-hidden="true"><Icon size={15} /></span>
                  <span className="timeline-text">
                    <span>{event.kind === "update" ? "Update published" : `Renamed to "${event.detail}"`}</span>
                    <span className="muted small" title={formatDateTime(event.t)}>
                      {formatDateTime(event.t)} · {timeAgo(event.t, now)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {newestFirst.length > SHOW_AT_FIRST && (
        <button type="button" className="link-button" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${newestFirst.length}`}
        </button>
      )}
    </section>
  );
}
