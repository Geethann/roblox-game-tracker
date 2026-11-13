// Several games on one chart: one line each, in the game's colour slot.
import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPointTime, formatTick, timeTicks, valueScale } from "../lib/history.js";
import { formatPercent } from "../lib/format.js";

const HEIGHT = 360;

export default function CompareChart({ rows, games, slots, metric, mode, resolution, mainId }) {
  const first = rows[0].t;
  const last = rows[rows.length - 1].t;
  const { ticks, unit } = useMemo(() => timeTicks(first, last), [first, last]);
  const percent = mode === "percent";

  const scale = useMemo(() => {
    const values = rows.flatMap((row) => games.map((g) => row[g.universeId]));
    // % change goes above and below zero, so let the chart fit it; otherwise use the measure's own rules.
    return percent ? { domain: ["auto", "auto"] } : valueScale(metric, values);
  }, [rows, games, metric, percent]);

  const format = percent ? (v) => formatPercent(v, { signed: true }) : metric.format;
  const axis = percent ? (v) => formatPercent(v, { signed: true }) : metric.axis;
  // Draw the main game last, so its line sits on top where lines cross.
  const drawOrder = [...games].sort((a, b) => (a.universeId === mainId) - (b.universeId === mainId));

  return (
    <div className="history-chart compare-chart">
      <ResponsiveContainer width="100%" height={HEIGHT}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[first, last]} ticks={ticks}
                 tickFormatter={(t) => formatTick(t, unit)} tickLine={false} axisLine={false}
                 tickMargin={8} minTickGap={24} />
          <YAxis width={60} tickFormatter={axis} tickLine={false} axisLine={false}
                 domain={scale.domain} ticks={scale.ticks} />
          <Tooltip
            isAnimationActive={false}
            cursor={{ strokeWidth: 1 }}
            content={({ active, payload }) => active && payload?.length
              ? <CompareTooltip row={payload[0].payload} games={games} slots={slots}
                                format={format} resolution={resolution} />
              : null}
          />
          {drawOrder.map((game) => {
            const slot = slots.get(game.universeId);
            return (
              <Line key={game.universeId} dataKey={String(game.universeId)} name={game.name}
                    type="linear" strokeWidth={game.universeId === mainId ? 2.5 : 2}
                    className={`series-line series-${slot}`} dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, className: `series-dot series-${slot}` }}
                    isAnimationActive={false} connectNulls={false} />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Every game's value at the hovered time, biggest first. The value leads; the name follows. */
function CompareTooltip({ row, games, slots, format, resolution }) {
  const entries = games
    .map((g) => ({ game: g, value: row[g.universeId] }))
    .filter((e) => e.value != null)
    .sort((a, b) => b.value - a.value);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{formatPointTime(row.t, resolution)}</div>
      {entries.map(({ game, value }) => (
        <div key={game.universeId} className="compare-tooltip-row">
          <span className={`line-key series-bg-${slots.get(game.universeId)}`} aria-hidden="true" />
          <strong>{format(value)}</strong>
          <span className="compare-tooltip-name">{game.name}</span>
        </div>
      ))}
    </div>
  );
}
