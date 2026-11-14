// The history chart card: pick what to plot, see it over time with update
// markers, hover for exact values, or switch to a table / download a CSV.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLine, Download, Table2 } from "lucide-react";
import {
  METRICS, downloadFile, eventMarkers, eventsByPoint, formatEventTime, formatPointTime, formatTick, notEnoughHint,
  slugify, timeTicks, toCsv, valueScale,
} from "../lib/history.js";
import { formatDate, formatDateTime, formatNumber } from "../lib/format.js";
import { Skeleton } from "./Feedback.jsx";

const CHART_HEIGHT = 320;
const Y_AXIS_WIDTH = 56;
// Room on the right for the last date label (e.g. "14 Nov"), which is centred on the plot's edge.
const MARGIN = { top: 18, right: 24, bottom: 0, left: 0 };
const FLAG_SPACING = 20; // update flags are 14px wide; keep their centres at least this far apart

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
  const last = data[data.length - 1].t;
  const { ticks, unit } = useMemo(
    () => timeTicks(first, last, 7, resolution === "day" ? "day" : "hour"),
    [first, last, resolution],
  );
  const scale = useMemo(() => valueScale(metric, data.map((d) => d.value)), [metric, data]);
  // The chart's width on screen, so update flags can be kept from touching.
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(boxRef.current);
    return () => observer.disconnect();
  }, []);
  // Markers only within the chart's own span; any closer than FLAG_SPACING
  // pixels share one (the plot is the chart minus the axis and margins).
  const plotWidth = Math.max(100, width - Y_AXIS_WIDTH - MARGIN.right);
  const markers = useMemo(
    () => eventMarkers(events, first, last, resolution, ((last - first) * FLAG_SPACING) / plotWidth),
    [events, first, last, resolution, plotWidth],
  );
  // The same updates, attached to the nearest reading, for the normal hover box.
  const eventsAt = useMemo(
    () => eventsByPoint(markers.flatMap((m) => m.events), data.map((d) => d.t), resolution),
    [markers, data, resolution],
  );
  // The marker being pointed at (or tapped / focused), and where it is on screen.
  const [shown, setShown] = useState(null); // { marker, x, y }
  const showMarker = (marker, x, y) => setShown({ marker, x, y });

  return (
    <div className="history-chart" ref={boxRef}
         onPointerDown={(e) => !e.target.closest(".event-marker") && setShown(null)}>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[first, last]} ticks={ticks}
                 tickFormatter={(t) => formatTick(t, unit)} tickLine={false} axisLine={false}
                 tickMargin={8} minTickGap={24} />
          <YAxis width={Y_AXIS_WIDTH} tickFormatter={metric.axis} tickLine={false} axisLine={false}
                 domain={scale.domain} ticks={scale.ticks} />
          <Tooltip
            // While an update marker is being pointed at, its own label shows instead.
            active={shown ? false : undefined}
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
          {markers.map((marker) => {
            const isOn = shown?.marker.t === marker.t || marker.events.some((e) => e.t === highlightedEvent);
            return (
              <ReferenceLine key={marker.t} x={marker.t} ifOverflow="discard" zIndex={1300}
                             className={`event-line${isOn ? " is-highlighted" : ""}`}
                             shape={(line) => (
                               <EventMarker {...line} marker={marker}
                                            onShow={showMarker} onHide={() => setShown(null)} />
                             )} />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
      {shown && <EventLabel {...shown} boxRef={boxRef} />}
    </div>
  );
}

/**
 * One update marker: the thin line, a small flag at the top, and an invisible
 * wider strip so it's easy to point at. Pointing at it, tapping it, or reaching
 * it with the keyboard (Tab) shows what happened. A flag covering several
 * updates shows how many.
 */
function EventMarker({ x1, y1, x2, y2, marker, onShow, onHide }) {
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const top = Math.min(y1, y2);       // the chart may draw the line bottom-to-top
  const height = Math.abs(y2 - y1);
  const show = () => onShow(marker, x1, top);
  const many = marker.events.length > 1;
  return (
    <g className="event-marker" tabIndex={0} role="button" aria-label={describeMarker(marker)}
       onPointerEnter={show} onFocus={show} onBlur={onHide} onClick={show}
       // On a touchscreen the finger "leaves" as soon as it lifts; the label stays until you tap elsewhere.
       onPointerLeave={(e) => e.pointerType !== "touch" && onHide()}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <rect className="event-hit" x={x1 - 7} y={top - 16} width={14} height={height + 16} />
      <circle className="event-flag" cx={x1} cy={top - 8} r={many ? 7 : 5} />
      {many && (
        <text className="event-count" x={x1} y={top - 8} dy="0.35em" textAnchor="middle">
          {marker.events.length > 9 ? "9+" : marker.events.length}
        </text>
      )}
    </g>
  );
}

const MAX_LABEL_LINES = 6;

/**
 * The label next to a marker: what happened and when (a short list if the
 * marker covers several updates). It sits to the right of the marker, or to the
 * left if there's no room, and never hangs off the chart: it measures itself
 * before it's shown.
 */
function EventLabel({ marker, x, y, boxRef }) {
  const ref = useRef(null);
  const [left, setLeft] = useState(null);
  useLayoutEffect(() => {
    const width = ref.current.offsetWidth;
    const room = boxRef.current.clientWidth;
    const GAP = 12;
    let place = x + GAP;                                   // right of the marker
    if (place + width > room) place = x - GAP - width;     // no room: left of it
    setLeft(Math.max(0, Math.min(place, room - width)));   // still too wide: keep it inside
  }, [x, marker, boxRef]);

  const { events } = marker;
  const single = events.length === 1;
  const firstDay = formatDate(events[0].t);
  const lastDay = formatDate(events[events.length - 1].t);
  const sameDay = firstDay === lastDay;
  return (
    <div ref={ref} className="chart-tooltip event-label" role="status"
         style={{ left: left ?? x, top: y, visibility: left == null ? "hidden" : "visible" }}>
      <div className="chart-tooltip-event-title">{single ? eventText(events[0]) : countText(events)}</div>
      <div className="chart-tooltip-time">
        {single ? formatDateTime(events[0].t) : sameDay ? firstDay : `${firstDay} – ${lastDay}`}
      </div>
      {!single && (
        <ul className="event-label-list">
          {events.slice(0, MAX_LABEL_LINES).map((e) => (
            <li key={`${e.kind}-${e.t}`}>
              {eventText(e)}
              <span className="chart-tooltip-event-time"> · {sameDay ? formatEventTime(e.t) : formatDateTime(e.t)}</span>
            </li>
          ))}
          {events.length > MAX_LABEL_LINES && (
            <li className="chart-tooltip-event-time">and {events.length - MAX_LABEL_LINES} more (listed under Updates)</li>
          )}
        </ul>
      )}
    </div>
  );
}

const eventText = (e) => (e.kind === "update" ? "Update published" : `Renamed to "${e.detail}"`);

/** "3 updates", "1 update, 1 rename" */
function countText(events) {
  const updates = events.filter((e) => e.kind === "update").length;
  const renames = events.length - updates;
  return [
    updates > 0 && `${updates} update${updates === 1 ? "" : "s"}`,
    renames > 0 && `${renames} rename${renames === 1 ? "" : "s"}`,
  ].filter(Boolean).join(", ");
}

/** What a screen reader says for a marker. */
const describeMarker = (marker) => (marker.events.length === 1
  ? `${eventText(marker.events[0])}, ${formatDateTime(marker.events[0].t)}`
  : `${countText(marker.events)}: ` + marker.events.map((e) => `${eventText(e)}, ${formatDateTime(e.t)}`).join("; "));

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
