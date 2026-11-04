import { useId } from 'react';

export interface TrendPoint { date: string; count: number }

export function TrendSparkline({ points, label }: { points: TrendPoint[]; label: string }) {
  const id = useId().replace(/:/g, '');
  const values = points.map((point) => point.count);
  const max = Math.max(1, ...values);
  const coordinates = values.map((value, index) => {
    const x = values.length > 1 ? 4 + index * (112 / (values.length - 1)) : 60;
    const y = 36 - (value / max) * 27;
    return [x, y] as const;
  });
  const line = coordinates.map(([x, y]) => `${x},${y}`).join(' ');
  const area = coordinates.length ? `M ${coordinates[0][0]} 40 L ${coordinates.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${coordinates[coordinates.length - 1][0]} 40 Z` : '';
  const sum = values.reduce((total, value) => total + value, 0);
  return <div className="trend-sparkline" role="img" aria-label={`${label}: ${sum} tareas cerradas en los últimos ${points.length} días`}>
    <svg viewBox="0 0 120 44" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6c5ce7" stopOpacity=".22"/>
          <stop offset="100%" stopColor="#6c5ce7" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#spark-fill-${id})`}/>}
      {line && <polyline points={line} fill="none" stroke="#6c5ce7" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round"/>}
      {coordinates.length > 0 && <circle cx={coordinates[coordinates.length-1][0]} cy={coordinates[coordinates.length-1][1]} r="3" fill="#6c5ce7"/>}
    </svg>
  </div>;
}
