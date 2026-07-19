import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import { api, ApiError } from '../api';
import { usePreferences } from '../hooks/usePreferences';
import type { Analytics } from '../types';

const PIE_COLORS = ['#FF6B35', '#F7931E', '#4E9F3D', '#1E88E5', '#8E44AD', '#00897B', '#D81B60', '#6D4C41'];

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi-card">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

export default function AdminPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<Analytics>('/admin/analytics');
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main">
        <h1 className="admin-title">Usage dashboard</h1>
        <AdminTabs />

        {loading && <div className="response-loading"><div className="spinner" /><p>Loading analytics…</p></div>}
        {error && <p className="auth-error">{error}</p>}

        {data && (
          <>
            <section className="kpi-grid">
              <Kpi label="Total questions" value={data.totals.queries} />
              <Kpi label="Teachers" value={data.totals.teachers} />
              <Kpi label="Active (30 days)" value={data.totals.activeTeachers} />
              <Kpi label="Feedback received" value={data.totals.feedback} />
              <Kpi label="Helpful rating" value={data.totals.helpfulRatio != null ? `${data.totals.helpfulRatio}%` : '—'} />
            </section>

            <section className="chart-grid">
              <div className="chart-card">
                <h2>Questions over time</h2>
                {data.byDay.length === 0 ? <p className="chart-empty">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart data={data.byDay} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#FF6B35" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#FF6B35" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="count" stroke="#FF6B35" fill="url(#area)" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="chart-card">
                <h2>By subject</h2>
                {data.bySubject.length === 0 ? <p className="chart-empty">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.bySubject} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={50} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#1E88E5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="chart-card">
                <h2>By focus area</h2>
                {data.byIssueType.length === 0 ? <p className="chart-empty">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data.byIssueType} layout="vertical" margin={{ top: 8, right: 8, left: 40, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={120} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#4E9F3D" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="chart-card">
                <h2>By language</h2>
                {data.byLanguage.length === 0 ? <p className="chart-empty">No data yet.</p> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={data.byLanguage} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={90} label>
                        {data.byLanguage.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            <section className="chart-card">
              <h2>Top questions</h2>
              {data.topQuestions.length === 0 ? <p className="chart-empty">No data yet.</p> : (
                <ol className="top-questions">
                  {data.topQuestions.map((q, i) => (
                    <li key={i}>
                      <span className="tq-text">{q.question}</span>
                      <span className="tq-count">{q.count}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
