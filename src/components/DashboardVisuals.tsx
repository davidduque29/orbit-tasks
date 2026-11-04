import type { ReactNode } from 'react';
import { CalendarDays, CheckCheck, Clock3, FolderKanban, ListTodo, TrendingUp } from 'lucide-react';

const ICONS = {
  projects: FolderKanban,
  pending: ListTodo,
  finished: CheckCheck,
  events: CalendarDays,
  tasks: ListTodo,
  cycle: Clock3,
  progress: TrendingUp,
};

export type StatKind = keyof typeof ICONS;

export function MetricCard({ label, value, kind = 'tasks', children }: {
  label: string;
  value: string;
  kind?: StatKind;
  children?: ReactNode;
}) {
  const Icon = ICONS[kind];
  return <article className={`card stat metric-card metric-${kind}`}>
    <span className="metric-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.1}/></span>
    <small>{label}</small>
    <strong>{value}</strong>
    {kind === 'progress' && <div className="metric-progress-track" aria-hidden="true"><div style={{width:`${Math.max(0,Math.min(100,Number.parseFloat(value) || 0))}%`}} /></div>}
    {children}
  </article>;
}

export function ProgressRing({ percent, label }: { percent: number; label: string }) {
  const normalized = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return <div className="progress-ring" role="img" aria-label={`${label}: ${Math.round(normalized)}% completado`}>
    <svg viewBox="0 0 52 52" aria-hidden="true">
      <circle className="progress-ring-track" cx="26" cy="26" r="21"/>
      <circle className="progress-ring-value" cx="26" cy="26" r="21"
        strokeDasharray={2 * Math.PI * 21}
        strokeDashoffset={2 * Math.PI * 21 * (1 - normalized / 100)}/>
    </svg>
    <span>{Math.round(normalized)}%</span>
  </div>;
}
