// Learning Representation: graph_chart. The one type using an existing dependency (`recharts`, already used by
// AdminPage.tsx) instead of hand-rolled CSS/SVG. Palette and axis styling (CartesianGrid strokeDasharray "3 3" at 0.15
// opacity, 11px ticks) mirror AdminPage's charts so the same library has one visual language.
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GraphChartData } from '../types';

const SERIES_COLORS = ['#FF6B35', '#1E88E5', '#4E9F3D', '#8E44AD'];

/**
 * recharts wants one row per x value with one key per series, not the per-series point arrays the schema returns. Merges by
 * x; a series missing a point leaves that cell empty (a gap, not an error), since series needn't share x values.
 */
function mergeSeries(series: GraphChartData['series']): Record<string, string | number>[] {
  const byX = new Map<string, Record<string, string | number>>();
  for (const s of series) {
    for (const point of s.points) {
      const row = byX.get(point.x) ?? { x: point.x };
      row[s.name] = point.y;
      byX.set(point.x, row);
    }
  }
  return Array.from(byX.values());
}

export default function GraphChartView({ data }: { data: GraphChartData }) {
  const rows = mergeSeries(data.series);
  const showLegend = data.series.length > 1;

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
      <XAxis dataKey="x" tick={{ fontSize: 11 }} />
      <YAxis tick={{ fontSize: 11 }} allowDecimals />
      <Tooltip />
      {showLegend && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  return (
    <div className="lr-chart">
      <p className="lr-chart-caption">
        {data.xLabel} vs {data.yLabel}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        {data.chartType === 'bar' ? (
          <BarChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            {axes}
            {data.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            {axes}
            {data.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
