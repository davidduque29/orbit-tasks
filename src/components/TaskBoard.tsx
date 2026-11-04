import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Project, Task, TaskStatus } from '../domain/models';
import { ReminderOverride } from './ReminderOverride';
import { Search, List, Columns3, Plus, X, ClipboardList, CalendarDays, Flag, Bell } from 'lucide-react';

type DisplayStatus = 'Activa' | 'En progreso' | 'Impedimento' | 'Finalizado';
type TimeFilter = 'all' | 'overdue' | 'today' | 'week' | 'closed';
type BoardView = 'list' | 'kanban';
const STATUS_LABELS: DisplayStatus[] = ['Activa', 'En progreso', 'Impedimento', 'Finalizado'];

function displayStatus(status: TaskStatus): DisplayStatus {
  if (status === 'Por hacer') return 'Activa';
  if (status === 'En revisión') return 'Impedimento';
  return status;
}

function storedStatus(status: DisplayStatus): TaskStatus {
  if (status === 'Activa') return 'Por hacer';
  if (status === 'Impedimento') return 'En revisión';
  return status;
}

function dateLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha';
}

function isWithinFilter(task: Task, period: TimeFilter, now: Date): boolean {
  if (period === 'all') return true;
  if (period === 'closed') return task.status === 'Finalizado';
  if (!task.estimated_due_at || task.status === 'Finalizado') return false;
  const due = new Date(task.estimated_due_at);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (period === 'overdue') return due.getTime() < now.getTime();
  if (period === 'today') return due >= today && due < tomorrow;
  const week = new Date(today.getTime());
  week.setDate(week.getDate() + 7);
  return due >= today && due < week;
}

interface BoardProps {
  projects: Project[];
  tasks: Task[];
  selectedProject: string;
  onProjectChange(projectId: string): void;
  onSave(taskId: string, status: TaskStatus, resolution: string): Promise<void>;
  onDelete(taskId: string): Promise<void>;
  onNewTask(): void;
  saving: boolean;
  userId: string;
}

function StatusDot({ status }: { status: DisplayStatus }) {
  return <span className={'status-indicator status-' + (
    status === 'Activa' ? 'active' : status === 'En progreso' ? 'progress'
      : status === 'Impedimento' ? 'blocked' : 'completed'
  )}><span className="status-dot" aria-hidden="true" />{status}</span>;
}

function TaskDetails({ task, projects, onSave, onDelete, saving, userId }: {
  task: Task;
  projects: Project[];
  onSave: BoardProps['onSave'];
  onDelete: BoardProps['onDelete'];
  saving: boolean;
  userId: string;
}) {
  const [status, setStatus] = useState<DisplayStatus>(displayStatus(task.status));
  const [resolution, setResolution] = useState(task.resolution ?? '');
  const [error, setError] = useState('');
  const needsResolution = status === 'Impedimento' || status === 'Finalizado';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (needsResolution && !resolution.trim()) {
      setError('Debes registrar la resolución o el motivo del impedimento.');
      return;
    }
    try {
      await onSave(task.id, storedStatus(status), resolution.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    }
  }

  return (
    <form className="task-detail-form" onSubmit={(event) => void save(event)}>
      <p>{task.description || 'Sin descripción adicional.'}</p>
      <div className="task-detail-grid">
        <div><small>Proyecto</small><strong>{projects.find((p) => p.id === task.project_id)?.name ?? 'Sin proyecto'}</strong></div>
        <div><small>Prioridad</small><strong>{task.priority}</strong></div>
        <div><small>Vencimiento</small><strong>{dateLabel(task.estimated_due_at)}</strong></div>
        <div><small>Cierre</small><strong>{dateLabel(task.completed_at)}</strong></div>
      </div>
      <label htmlFor={'status-' + task.id}>Estado</label>
      <select id={'status-' + task.id} value={status}
        onChange={(event) => setStatus(event.target.value as DisplayStatus)}>
        {STATUS_LABELS.map((item) => <option key={item}>{item}</option>)}
      </select>
      <label htmlFor={'resolution-' + task.id}>
        Resolución o motivo de impedimento {needsResolution ? '(obligatorio)' : '(opcional)'}
      </label>
      <textarea id={'resolution-' + task.id} value={resolution} maxLength={2000}
        onChange={(event) => setResolution(event.target.value)}
        placeholder="Describe qué se realizó o qué impide avanzar..." />
      {error && <p className="error" role="alert">{error}</p>}
      <ReminderOverride type="tasks" userId={userId} itemId={task.id}
        initial={task.reminder_override_minutes ?? null} />
      <div className="task-actions">
        <button disabled={saving || (needsResolution && !resolution.trim())} type="submit">Guardar cambios</button>
        <button type="button" disabled={saving} className="danger"
          onClick={() => { if (window.confirm('¿Eliminar esta tarea?')) void onDelete(task.id); }}>Eliminar tarea</button>
      </div>
    </form>
  );
}

export function TaskBoard({ projects, tasks, selectedProject, onProjectChange, onSave, onDelete, onNewTask, saving, userId }: BoardProps) {
  const [view, setView] = useState<BoardView>('list');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedTaskId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);

  const now = new Date();
  const filtered = useMemo(() => tasks.filter((task) => {
    const project = projects.find((p) => p.id === task.project_id);
    const searchable = [task.title, task.description, task.resolution, project?.name]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    return (!selectedProject || task.project_id === selectedProject)
      && (!keyword.trim() || searchable.includes(keyword.trim().toLocaleLowerCase()))
      && (statusFilter === 'all' || displayStatus(task.status) === statusFilter)
      && (priorityFilter === 'all' || task.priority === priorityFilter)
      && isWithinFilter(task, timeFilter, now);
  }), [tasks, projects, selectedProject, keyword, statusFilter, priorityFilter, timeFilter, now.getTime()]);

  const overdue = filtered.filter((task) => task.status !== 'Finalizado'
    && task.estimated_due_at && new Date(task.estimated_due_at) < now).length;

  function taskItem(task: Task) {
    return (
      <article className="task-list-item task-compact-card" key={task.id}>
        <button type="button" className="task-summary task-compact-button"
          aria-label={`Ver detalles de ${task.title}`}
          onClick={() => setSelectedTaskId(task.id)}>
          <span className="task-summary-main">
            <strong>{task.title}</strong>
            <span className="task-compact-meta"><Flag size={13} aria-hidden="true" />{task.priority}
              {task.estimated_due_at && <><CalendarDays size={13} aria-hidden="true" />{dateLabel(task.estimated_due_at)}</>}
              {task.reminder_override_minutes?.length ? <Bell size={13} aria-label="Con recordatorios" /> : null}
            </span>
          </span>
          <StatusDot status={displayStatus(task.status)} />
        </button>
      </article>
    );
  }

  return (
    <section className="task-board">
      <div className="heading">
        <div><h1>Tablero de tareas</h1><p>Busca, filtra y consulta las resoluciones.</p></div>
        <button type="button" onClick={onNewTask}><Plus size={16} aria-hidden="true" /> Nueva tarea</button>
      </div>
      <div className="board-toolbar">
        <label htmlFor="task-keyword">Buscar por palabra clave
          <div className="board-search"><Search size={17} aria-hidden="true" /><input id="task-keyword" type="search" placeholder="Buscar tareas, proyectos y resoluciones..." value={keyword}
            onChange={(event) => setKeyword(event.target.value)} /></div>
        </label>
        <label htmlFor="board-project">Proyecto
          <select id="board-project" value={selectedProject} onChange={(event) => onProjectChange(event.target.value)}>
            <option value="">Todos los proyectos</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label htmlFor="board-status">Estado
          <select id="board-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Todos</option>
            {STATUS_LABELS.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        <label htmlFor="board-dates">Fecha
          <select id="board-dates" value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}>
            <option value="all">Todas</option>
            <option value="overdue">Vencidas</option>
            <option value="today">Vencen hoy</option>
            <option value="week">Próximos 7 días</option>
            <option value="closed">Finalizadas</option>
          </select>
        </label>
        <label htmlFor="board-priority">Prioridad
          <select id="board-priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="all">Todas</option>
            {['Baja', 'Media', 'Alta', 'Crítica'].map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </label>
      </div>
      <div className="board-switch">
        <div className="board-view-controls">
          <button type="button" className={view === 'list' ? '' : 'outline'} onClick={() => setView('list')}><List size={16} aria-hidden="true" /> Lista</button>
          <button type="button" className={view === 'kanban' ? '' : 'outline'} onClick={() => setView('kanban')}><Columns3 size={16} aria-hidden="true" /> Kanban</button>
        </div>
        <span>{filtered.length} tareas · {overdue} vencidas</span>
      </div>
      {view === 'list' && (
        <div className="task-list">
          {filtered.map(taskItem)}
          {filtered.length === 0 && <p className="empty">No encontramos tareas con esos filtros.</p>}
        </div>
      )}
      {view === 'kanban' && (
        <div className="kanban">
          {STATUS_LABELS.map((status) => (
            <section className="lane" key={status}>
              <h2><StatusDot status={status} /> <span>{filtered.filter((task) => displayStatus(task.status) === status).length}</span></h2>
              {filtered.filter((task) => displayStatus(task.status) === status).map(taskItem)}
            </section>
          ))}
        </div>
      )}
      {selectedTask && (
        <div className="modal-backdrop" role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTaskId(null); }}>
          <section className="modal orbit-detail-modal" role="dialog" aria-modal="true"
            aria-labelledby="task-detail-title">
            <ClipboardList className="orbit-modal-watermark" size={180} aria-hidden="true" />
            <header className="orbit-modal-header">
              <span className="orbit-modal-icon"><ClipboardList size={23} aria-hidden="true" /></span>
              <div className="orbit-modal-heading"><small>Detalle de tarea</small>
                <h2 id="task-detail-title">{selectedTask.title}</h2></div>
              <button type="button" className="outline orbit-modal-close" aria-label="Cerrar detalle de tarea"
                onClick={() => setSelectedTaskId(null)}><X size={20} /></button>
            </header>
            <TaskDetails key={selectedTask.id + ':' + selectedTask.status + ':' + selectedTask.resolution}
              task={selectedTask} projects={projects}
              onSave={async (id, status, resolution) => { await onSave(id, status, resolution); }}
              onDelete={async (id) => { await onDelete(id); setSelectedTaskId(null); }}
              saving={saving} userId={userId} />
          </section>
        </div>
      )}
    </section>
  );
}
