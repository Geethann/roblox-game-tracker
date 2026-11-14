// The history chart card: pick what to plot, see it over time with update
// markers, hover for exact values, or switch to a table / download a CSV.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLine, Download, Table2 } from "lucide-react";
import {
  METRICS, downloadFile, eventsByPoint, formatEventTime, formatPointTime, formatTick, notEnoughHint, slugify,
  timeTicks, toCsv, valueScale,
} from "../lib/history.js";
import { formatDate, formatDateTime, formatNumber } from "../lib/format.js";
import { Skeleton } from "./Feedback.jsx";

const CHART_HEIGHT = 320;

export default function HistoryPanel({
  game, points, resolution, events, metricKey, onMetricChange,
  rangeKey, historyStartsLate, loading, updating, highlightedEvent,
}) {
  const [view, setView] = useState("chart"); // "chart" or "table"
  const metric = METRICS[metricKey];

  // What the chart plots: one { t, value } per reading, plus the full reading for the hover box.
  const data = useMemo(
    () => points.map((point) => ({ t: point.t, value: metric.value(point), point })),
    [points, metric],
  );
  const hasEnough = data.filter((d) => d.value != null).length >= 2;

  function downloadCsv() {
    downloadFile(`${slugify(game.name)}-${rangeKey}.csv`, toCsv(points, resolution));
  }

  return (
    <section className="card history" aria-labelledby="history-title">
      <div className="history-head">
        <h2 id="history-title">{resolution ? metric.title(resolution) : "History"}</h2>
        <div className="segmented" role="group" aria-label="What to show">
          {Object.entries(METRICS).map(([key, m]) => (
            <button key={key} type="button" aria-pressed={key === metricKey} onClick={() => onMetricChange(key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {historyStartsLate && (
        <p className="muted small history-note">
          History for this game starts {formatDate(game.trackedSince)}, when the tracker began recording it,
          so this shows everything recorded so far. Longer ranges fill in as more history builds up.
        </p>
      )}

      <div className={`history-body${updating ? " is-updating" : ""}`}>
        {loading ? (
          <Skeleton height={CHART_HEIGHT} radius={8} />
        ) : !hasEnough ? (
          <div className="history-empty" style={{ minHeight: CHART_HEIGHT }}>
            <ChartLine size={28} aria-hidden="true" />
            <p>Not enough readings for a chart yet.</p>
            <p className="muted small">{notEnoughHint(resolution)}</p>
          </div>
        ) : view === "chart" ? (
          <Chart data={data} metric={metric} resolution={resolution} events={events}
                 highlightedEvent={highlightedEvent} />
        ) : (
          <HistoryTable data={data} metric={metric} resolution={resolution} />
        )}
      </div>

      <div className="history-foot">
        {events.length > 0 && view === "chart" && hasEnough && (
          <span className="muted small marker-key">
            <span className="marker-swatch" aria-hidden="true" /> Update or title change
          </span>
        )}
        <span className="history-actions">
          <button type="button" className="button button-small" disabled={!hasEnough}
                  onClick={() => setView(view === "chart" ? "table" : "chart")}>
            {view === "chart" ? <><Table2 size={15} aria-hidden="true" /> Table</> : <><ChartLine size={15} aria-hidden="true" /> Chart</>}
          </button>
          <button type="button" className="button button-small" disabled={points.length === 0} onClick={downloadCsv}>
            <Download size={15} aria-hidden="true" /> CSV
          </button>
        </span>
      </div>
    </section>
  );
}

function Chart({ data, metric, resolution, events, highlightedEvent }) {
  const first = data[0].t;
  const step = resolution === "day" ? 86_400 : 3_600;
  const visibleEvents = events.filter((e) => e.t >= first && e.t <= data[data.length - 1].t + step);
  // An update published after the latest reading (e.g. 14:34 when the last
  // reading was 14:00) stretches the time axis a little, so its marker still shows.
  const last = Math.max(data[data.length - 1].t, ...visibleEvents.map((e) => e.t));
  const { ticks, unit } = useMemo(() => timeTicks(first, last), [first, last]);
  const scale = useMemo(() => valueScale(metric, data.map((d) => d.value)), [metric, data]);
  const eventsAt = useMemo(
    () => eventsByPoint(events, data.map((d) => d.t), resolution),
    [events, data, resolution],
  );
  // The update marker being pointed at (or tapped / focused), and where it is.
  const [marker, setMarker] = useState(null); // { event, x, y, flip }
  const boxRef = useRef(null);

  const showMarker = (event, x, y) => setMarker({ event, x, y });

  return (
    <div className="history-chart" ref={boxRef}
         onPointerDown={(e) => !e.target.closest(".event-marker") && setMarker(null)}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[first, last]} ticks={ticks}
                 tickFormatter={(t) => formatTick(t, unit)} tickLine={false} axisLine={false}
                 tickMargin={8} minTickGap={24} />
          <YAxis width={56} tickFormatter={metric.axis} tickLine={false} axisLine={false}
                 domain={scale.domain} ticks={scale.ticks} />
          <Tooltip
            // While an update marker is being pointed at, its own label shows instead.
            active={marker ? false : undefined}
            isAnimationActive={false}
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => active && payload?.length
              ? <ChartTooltip row={payload[0].payload} metric={metric} resolution={resolution}
                              events={eventsAt.get(payload[0].payload.t) ?? []} />
              : null}
          />
          <Area type="linear" dataKey="value" stroke="currentColor" strokeWidth={2}
                fill="currentColor" fillOpacity={metric.fromZero ? 0.1 : 0}
                isAnimationActive={false} connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2 }} />
          {/* Drawn above the chart line, so each marker can be pointed at directly. */}
          {visibleEvents.map((event) => {
            const isOn = event.t === highlightedEvent || marker?.event === event;
            return (
              <ReferenceLine key={`${event.kind}-${event.t}`} x={event.t} ifOverflow="discard" zIndex={1300}
                             className={`event-line${isOn ? " is-highlighted" : ""}`}
                             shape={(line) => (
                               <EventMarker {...line} event={event}
                                            onShow={showMarker} onHide={() => setMarker(null)} />
                             )} />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
      {marker && <EventLabel {...marker} boxRef={boxRef} />}
    </div>
  );
}

/**
 * One update marker: the thin line, a small flag at the top, and an invisible
 * wider strip so it's easy to point at. Pointing at it, tapping it, or reaching
 * it with the keyboard (Tab) shows what happened.
 */
function EventMarker({ x1, y1, x2, y2, event, onShow, onHide }) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const top = Math.min(y1, y2);       // the chart may draw the line bottom-to-top
  const height = Math.abs(y2 - y1);
  const show = () => onShow(event, x1, top);
  return (
    <g className="event-marker" tabIndex={0} role="button" aria-label={describeEvent(event)}
       onPointerEnter={show} onFocus={show} onBlur={onHide} onClick={show}
       // On a touchscreen the finger "leaves" as soon as it lifts; the label stays until you tap elsewhere.
       onPointerLeave={(e) => e.pointerType !== "touch" && onHide()}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <rect className="event-hit" x={x1 - 7} y={top - 14} width={14} height={height + 14} />
      <circle className="event-flag" cx={x1} cy={top - 7} r={5} />
    </g>
  );
}

/**
 * The label next to a marker: what happened, and exactly when. It sits to the
 * right of the marker, or to the left if there's no room, and never hangs off
 * the chart (it measures itself before it's shown).
 */
function EventLabel({ event, x, y, boxRef }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(null);
  useLayoutEffect(() => {
    const width = ref.current.offsetWidth;
    const room = boxRef.current.clientWidth;
    const GAP = 10;
    let place = x + GAP;                                   // right of the marker
    if (place + width > room) place = x - GAP - width;     // no room: left of it
    setLeft(Math.max(0, Math.min(place, room - width)));   // still too wide: keep it inside
  }, [x, event, boxRef]);
  return (
    <div ref={ref} className="chart-tooltip event-label" role="status"
         style={{ left: left ?? x, top: y, visibility: left == null ? "hidden" : "visible" }}>
      <div className="chart-tooltip-event-title">
        {event.kind === "update" ? "Update published" : `Renamed to "${event.detail}"`}
      </div>
      <div className="chart-tooltip-time">{formatDateTime(event.t)}</div>
    </div>
  );
}

const describeEvent = (e) =>
  `${e.kind === "update" ? "Update published" : `Renamed to ${e.detail}`}, ${formatDateTime(e.t)}`;

/** The box that follows the pointer: the value first (biggest), then when, then any updates near it. */
function ChartTooltip({ row, metric, resolution, events }) {
  const { point } = row;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-value">
        <span className="line-key" aria-hidden="true" />
        {metric.format(row.value)}
      </div>
      {metric === METRICS.players && point.peak != null && (
        <div className="chart-tooltip-extra">Peak (hourly): {formatNumber(point.peak)}</div>
      )}
      <div className="chart-tooltip-time">{formatPointTime(row.t, resolution, point.partial)}</div>
      {events.map((e) => (
        <div key={`${e.kind}-${e.t}`} className="chart-tooltip-event">
          {e.kind === "update" ? "Update published" : `Renamed to "${e.detail}"`}
          <span className="chart-tooltip-event-time"> · {formatEventTime(e.t)}</span>
        </div>
      ))}
    </div>
  );
}

/** The same numbers as the chart, as a table: readable without hovering, and by screen readers. */
function HistoryTable({ data, metric, resolution }) {
  const showPeak = metric === METRICS.players && resolution === "day";
  const rows = [...data].reverse(); // newest first
  return (
    <div className="history-table-wrap" style={{ maxHeight: CHART_HEIGHT }}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">{resolution === "day" ? "Day" : "Time"}</th>
            <th scope="col" className="num">{metric.label}{showPeak ? " (avg)" : ""}</th>
            {showPeak && <th scope="col" className="num">Peak (hourly)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.t}>
              <td>{formatPointTime(row.t, resolution, row.point.partial)}</td>
              <td className="num">{metric.format(row.value)}</td>
              {showPeak && <td className="num">{formatNumber(row.point.peak)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
