// A tiny trend line with no axes: the shape of the last 7 days at a glance.
// Drawn in a quiet grey with the latest reading highlighted, so it supports
// the numbers next to it rather than competing with them.
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export default function Sparkline({ values, label }) {
  const data = values.map((value, i) => ({ i, value }));
  const lastIndex = data.length - 1;
  return (
    <div className="sparkline" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line type="linear" dataKey="value" stroke="currentColor" strokeWidth={1.5} isAnimationActive={false}
                dot={(props) => (props.index === lastIndex
                  ? <circle key="last" cx={props.cx} cy={props.cy} r={3} className="sparkline-end" />
                  : <g key={props.index} />)} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
