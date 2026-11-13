// The history chart card: pick what to plot, see it over time with update
// markers, hover for exact values, or switch to a table / download a CSV.
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLine, Download, Table2 } from "lucide-react";
import {
  METRICS, downloadFile, formatPointTime, formatTick, slugify, timeTicks, toCsv, valueScale,
} from "../lib/history.js";
import { formatDate, formatNumber } from "../lib/format.js";
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
          History for this game starts {formatDate(game.trackedSince)}, when the tracker began recording it.
        </p>
      )}

      <div className={`history-body${updating ? " is-updating" : ""}`}>
        {loading ? (
          <Skeleton height={CHART_HEIGHT} radius={8} />
        ) : !hasEnough ? (
          <div className="history-empty" style={{ minHeight: CHART_HEIGHT }}>
            <ChartLine size={28} aria-hidden="true" />
            <p>Not enough readings for a chart yet.</p>
            <p className="muted small">A new reading is added every hour. Check back soon, or pick a longer range.</p>
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
  const { ticks, unit } = useMemo(() => timeTicks(first, last), [first, last]);
  const step = resolution === "day" ? 86_400 : 3_600;
  const visibleEvents = events.filter((e) => e.t >= first && e.t <= last + step);
  const scale = useMemo(() => valueScale(metric, data.map((d) => d.value)), [metric, data]);

  return (
    <div className="history-chart">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[first, last]} ticks={ticks}
                 tickFormatter={(t) => formatTick(t, unit)} tickLine={false} axisLine={false}
                 tickMargin={8} minTickGap={24} />
          <YAxis width={56} tickFormatter={metric.axis} tickLine={false} axisLine={false}
                 domain={scale.domain} ticks={scale.ticks} />
          {visibleEvents.map((event) => (
            <ReferenceLine key={`${event.kind}-${event.t}`} x={event.t} ifOverflow="discard"
                           className={`event-line${event.t === highlightedEvent ? " is-highlighted" : ""}`} />
          ))}
          <Tooltip
            isAnimationActive={false}
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => active && payload?.length
              ? <ChartTooltip row={payload[0].payload} metric={metric} resolution={resolution}
                              events={events} step={step} />
              : null}
          />
          <Area type="linear" dataKey="value" stroke="currentColor" strokeWidth={2}
                fill="currentColor" fillOpacity={metric.fromZero ? 0.1 : 0}
                isAnimationActive={false} connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The box that follows the pointer: the value first (biggest), then when, then any events. */
function ChartTooltip({ row, metric, resolution, events, step }) {
  const { point } = row;
  const nearby = events.filter((e) => e.t >= row.t && e.t < row.t + step);
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
      {nearby.map((e) => (
        <div key={`${e.kind}-${e.t}`} className="chart-tooltip-event">
          {e.kind === "update" ? "Update published" : `Renamed to "${e.detail}"`}
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
