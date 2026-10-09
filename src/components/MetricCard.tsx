interface MetricCardProps { label: string; value: string; delta?: number; hint?: string }

export function MetricCard({ label, value, delta, hint }: MetricCardProps) {
  const deltaTone = delta === 0 ? 'is-neutral' : delta && delta > 0 ? 'is-positive' : 'is-negative'
  const deltaSymbol = delta === 0 ? '—' : delta && delta > 0 ? '↑' : '↓'
  return <article className="metric-card">
    <div className="metric-card__label">{label}</div>
    <div className="metric-card__value">{value}</div>
    {delta !== undefined && <span className={`metric-card__delta ${deltaTone}`}>{deltaSymbol} {Math.abs(delta).toFixed(1)}%</span>}
    {hint && <small>{hint}</small>}
  </article>
}
