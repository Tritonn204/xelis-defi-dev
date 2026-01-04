import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi';

export function DashboardView() {
  const { apiFetch, loading } = useApi();
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    apiFetch('/api/dashboard/metrics').then(setMetrics);
  }, [apiFetch]);

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      {loading && <p>Loading...</p>}
      {metrics && (
        <div className="metrics-grid">
          <MetricCard title="Swaps Today" value={metrics.swaps_today.toLocaleString()} />
          <MetricCard title="Volume Today" value={`$${metrics.volume_today.toFixed(2)}`} />
          <MetricCard title="Active Pairs" value={metrics.active_pairs_today} />
          <MetricCard title="Total Swaps" value={metrics.total_swaps.toLocaleString()} />
          <MetricCard title="Total Pairs" value={metrics.total_pairs} />
          <MetricCard title="Total Assets" value={metrics.total_assets} />
          <MetricCard title="DB Size" value={metrics.db_size} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="metric-card">
      <h3>{title}</h3>
      <p className="metric-value">{value}</p>
    </div>
  );
}