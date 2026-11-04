import { useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock3, FolderKanban, Info, TrendingUp } from 'lucide-react';
import type { Project, Task } from '../domain/models';
import { buildProjectProgress, combinedProgress, type ProgressPoint } from '../domain/projectProgress';

function ProgressGraph({ points }: { points: ProgressPoint[] }) {
  const width = 680;
  const height = 260;
  const left = 43;
  const right = 14;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const coords = points.map((point, index) => ({
    x: left + index * (plotWidth / Math.max(1, points.length - 1)),
    y: top + plotHeight * (1 - point.percent / 100),
  }));
  const path = coords.map((coord, index) => `${index ? 'L' : 'M'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`).join(' ');
  const area = coords.length
    ? `${path} L ${coords[coords.length - 1].x} ${top + plotHeight} L ${coords[0].x} ${top + plotHeight} Z`
    : '';
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const first = points[0];
  const last = points[points.length - 1];
  const description = points.length && last
    ? `El progreso varió de ${first.percent}% a ${last.percent}% entre ${first.date} y ${last.date}.`
    : 'Sin datos para este período.';

  return (
    <div className="project-progress-chart" role="img" aria-label={description}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <linearGradient id="orbit-progress-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6c5ce7" stopOpacity=".28" />
            <stop offset="100%" stopColor="#6c5ce7" stopOpacity=".018" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map(tick => {
          const y = top + plotHeight * (1 - tick / 100);
          return <g key={tick}>
            <line x1={left} x2={width - right} y1={y} y2={y} stroke="#e9e6f4" strokeDasharray="4 4" />
            <text x={left - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#7a859e">{tick}%</text>
          </g>;
        })}
        {area && <path d={area} fill="url(#orbit-progress-gradient)" />}
        {path && <path d={path} fill="none" stroke="#6c5ce7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
        {coords.length > 0 && <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r="5" fill="#6c5ce7" stroke="white" strokeWidth="3" />}
        {labelIndexes.map(index => <text key={index} x={coords[index]?.x ?? left} y={height - 13}
          textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
          fill="#7a859e" fontSize="12">{points[index]?.date.slice(5) || ''}</text>)}
      </svg>
    </div>
  );
}

export function ProjectProgressReport({ projects, tasks }: { projects: Project[]; tasks: Task[] }) {
  const [projectId, setProjectId] = useState('');
  const [days, setDays] = useState(30);
  const series = useMemo(() => buildProjectProgress(projects, tasks, days), [projects, tasks, days]);
  const selected = series.find(seriesItem => seriesItem.projectId === projectId);
  const displayed = selected ? selected.points : combinedProgress(series);
  const latest = displayed[displayed.length - 1];
  const remaining = Math.max(0, (latest?.created ?? 0) - (latest?.completed ?? 0));
  const scopeLabel = selected ? selected.projectName : 'Todos los proyectos';

  return <div className="project-progress-report">
    <div className="project-progress-filters">
      <label>Proyecto
        <select value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">Todos los proyectos</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label>Período
        <select value={days} onChange={event => setDays(Number(event.target.value))}>
          <option value={7}>Últimos 7 días</option>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
        </select>
      </label>
    </div>

    <div className="project-progress-kpis">
      <div><FolderKanban size={19} aria-hidden="true" /><small>Tareas registradas</small><strong>{latest?.created ?? 0}</strong></div>
      <div><CheckCircle2 size={19} aria-hidden="true" /><small>Finalizadas</small><strong>{latest?.completed ?? 0}</strong></div>
      <div><Clock3 size={19} aria-hidden="true" /><small>Pendientes</small><strong>{remaining}</strong></div>
      <div><TrendingUp size={19} aria-hidden="true" /><small>Avance actual</small><strong>{latest?.percent ?? 0}%</strong></div>
    </div>

    <section className="card project-progress-visual">
      <div className="project-progress-title">
        <div><h2><Activity size={19} aria-hidden="true" /> Evolución de tareas</h2>
          <p>{scopeLabel} · porcentaje de tareas finalizadas a lo largo del período</p></div>
        <strong>{latest?.percent ?? 0}%</strong>
      </div>
      {projects.length === 0 ? <p className="empty">Crea un proyecto para comenzar a medir su progreso.</p>
        : <ProgressGraph points={displayed}/>}
      <div className="project-progress-note"><Info size={16} aria-hidden="true" />
        <p>Reconstrucción aproximada basada en las fechas de creación y finalización de las tareas actuales.
          No representa un historial completo: tareas eliminadas, reabiertas o trasladadas pueden cambiar la curva.
          Para registrar cada cambio de estado con precisión se necesita un historial de auditoría.</p>
      </div>
    </section>

    {!projectId && series.length > 0 && <section className="card progress-project-list">
      <h2>Avance por proyecto</h2>
      {series.map(item => <button type="button" className="project-progress-row" key={item.projectId}
        onClick={() => setProjectId(item.projectId)} aria-label={`Filtrar por ${item.projectName}, avance ${item.percent}%`}>
        <div><strong>{item.projectName}</strong><small>{item.completed} de {item.created} tareas finalizadas</small></div>
        <div className="project-progress-row-track"><span style={{ width: `${item.percent}%` }}/></div>
        <b>{item.percent}%</b>
      </button>)}
    </section>}
  </div>;
}
