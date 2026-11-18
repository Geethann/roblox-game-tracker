// The history chart card: pick what to plot, see it over time with update
// markers, hover for exact values, or switch to a table / download a CSV.
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLine, Download, Table2 } from "lucide-react";
import {
  METRICS, downloadFile, eventsByPoint, formatEventTime, formatPointTime, formatTick, notEnoughHint, slugify,
  isolated, timeTicks, toCsv, valueScale, withGaps,
} from "../lib/history.js";
import { formatDate, formatNumber } from "../lib/format.js";
import { Skeleton } from "./Feedback.jsx";

const CHART_HEIGHT = 320;
const Y_AXIS_WIDTH = 56;
// Room on the right for the last date label (e.g. "14 Nov"), which is centred on the plot's edge.
const MARGIN = { top: 18, right: 24, bottom: 0, left: 0 };

export default function HistoryPanel({
  game, points, resolution, events, metricKey, onMetricChange,
  rangeKey, historyStartsLate, loading, updating, highlightedEvent,
}) {
  const [view, setView] = useState("chart"); // "chart" or "table"
  const metric = METRICS[metricKey];

  // What the chart plots: one { t, value } per reading, plus the full reading for the hover box.
  // After a long gap (no readings for over 3 hours or days) an empty "gap" row breaks the line.
  const data = useMemo(
    () => withGaps(points, resolution).map((point) => (point.gap
      ? { t: point.t, value: null, point: null, gap: true }
      : { t: point.t, value: metric.value(point), point })),
    [points, metric, resolution],
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
            <span className="marker-swatch" aria-hidden="true" /> Update or title change (point at it for details)
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
  // Each update belongs to a reading. That reading gets a small marker along the
  // bottom of the chart, and hovering it (like any point) lists the updates.
  const eventsAt = useMemo(
    () => eventsByPoint(events, data.filter((d) => !d.gap).map((d) => d.t), resolution),
    [events, data, resolution],
  );
  // The reading whose update was picked in the Updates list, shown with a line.
  const highlightedAt = [...eventsAt].find(([, list]) => list.some((e) => e.t === highlightedEvent))?.[0];

  return (
    <div className="history-chart">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[first, last]} ticks={ticks}
                 tickFormatter={(t) => formatTick(t, unit)} tickLine={false} axisLine={false}
                 tickMargin={8} minTickGap={24} />
          <YAxis width={Y_AXIS_WIDTH} tickFormatter={metric.axis} tickLine={false} axisLine={false}
                 domain={scale.domain} ticks={scale.ticks} />
          {highlightedAt != null && (
            <ReferenceLine x={highlightedAt} className="event-highlight" ifOverflow="discard" />
          )}
          <Tooltip
            isAnimationActive={false}
            filterNull={false} // still show the box (and its updates) where a reading has no value
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => active && payload?.length && !payload[0].payload.gap
              ? <ChartTooltip row={payload[0].payload} metric={metric} resolution={resolution}
                              events={eventsAt.get(payload[0].payload.t) ?? []} />
              : null}
          />
          <Area type="linear" dataKey="value" stroke="currentColor" strokeWidth={2}
                fill="currentColor" fillOpacity={metric.fromZero ? 0.1 : 0}
                isAnimationActive={false} connectNulls={false}
                // A reading with no neighbour on either side (e.g. a lone day between gaps)
                // has no line to sit on, so it's drawn as a dot instead of disappearing.
                dot={({ cx, cy, index }) => (isolated(data, index, (d) => d.value)
                  ? <circle key={index} className="lone-dot" cx={cx} cy={cy} r={3.5} />
                  : <g key={index} />)}
                activeDot={{ r: 4, strokeWidth: 2 }} />
          {[...eventsAt.keys()].map((t) => (
            <ReferenceDot key={t} x={t} y={scale.domain[0]} ifOverflow="visible"
                          shape={({ cx, cy }) => (
                            <circle className={`event-dot${t === highlightedAt ? " is-highlighted" : ""}`}
                                    cx={cx} cy={cy - 6} r={4} />
                          )} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const MAX_TOOLTIP_EVENTS = 4;

/** The box that follows the pointer: the value first (biggest), then when, then any updates near it. */
function ChartTooltip({ row, metric, resolution, events }) {
  const { point } = row;
  return (
    <div className="chart-tooltip">
      {row.value == null ? (
        // e.g. visits gained in the first hour: there's no earlier reading to compare with.
        <div className="chart-tooltip-extra">No figure for this reading</div>
      ) : (
        <div className="chart-tooltip-value">
          <span className="line-key" aria-hidden="true" />
          {metric.format(row.value)}
        </div>
      )}
      {metric === METRICS.players && point.peak != null && (
        <div className="chart-tooltip-extra">Peak (hourly): {formatNumber(point.peak)}</div>
      )}
      <div className="chart-tooltip-time">{formatPointTime(row.t, resolution, point.partial)}</div>
      {metric.gained && point.gainedOver > 1 && (
        <div className="chart-tooltip-extra">
          Average over {point.gainedOver} {resolution === "day" ? "days" : "hours"} (a reading was missed)
        </div>
      )}
      {events.slice(0, MAX_TOOLTIP_EVENTS).map((e) => (
        <div key={`${e.kind}-${e.t}`} className="chart-tooltip-event">
          {e.kind === "update" ? "Update published" : `Renamed to "${e.detail}"`}
          <span className="chart-tooltip-event-time"> · {formatEventTime(e.t)}</span>
        </div>
      ))}
      {events.length > MAX_TOOLTIP_EVENTS && (
        <div className="chart-tooltip-extra">and {events.length - MAX_TOOLTIP_EVENTS} more (see Updates below)</div>
      )}
    </div>
  );
}

/** The same numbers as the chart, as a table: readable without hovering, and by screen readers. */
function HistoryTable({ data, metric, resolution }) {
  const showPeak = metric === METRICS.players && resolution === "day";
  const rows = data.filter((row) => !row.gap).reverse(); // newest first
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
