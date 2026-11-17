import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Project, Task, TaskStatus } from '../domain/models';
import { ReminderOverride } from './ReminderOverride';
import { Search, List, Columns3, Plus, X, ClipboardList, CalendarDays, Flag, Bell, Pencil, Trash2, RotateCcw, GripVertical } from 'lucide-react';

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
  onEdit(task: Task): void;
  onRestore(taskId: string): Promise<void>;
  onPermanentDelete(taskId: string): Promise<void>;
  onDeleteAll(): Promise<void>;
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
        <button className="orbit-action-edit" disabled={saving || (needsResolution && !resolution.trim())} type="submit"><ClipboardList size={16} aria-hidden="true" />Guardar cambios</button>
        <button type="button" disabled={saving} className="orbit-action-delete"
          onClick={() => { void onDelete(task.id); }}>Eliminar</button>
      </div>
    </form>
  );
}

export function TaskBoard({ projects, tasks, selectedProject, onSave, onDelete, onNewTask, onEdit, onRestore, onPermanentDelete, onDeleteAll, saving, userId }: BoardProps) {
  const [view, setView] = useState<BoardView>('list');
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const dragVisual=useRef<{ghost:HTMLElement;source:HTMLElement;offsetX:number;offsetY:number}|null>(null);
  function startTouchVisual(event:React.PointerEvent<HTMLElement>) {
    const source=event.currentTarget.closest<HTMLElement>('.task-compact-card');
    if(!source)return;
    const rect=source.getBoundingClientRect(),ghost=source.cloneNode(true) as HTMLElement;
    ghost.classList.add('orbit-touch-ghost');
    Object.assign(ghost.style,{position:'fixed',left:'0px',top:'0px',width:rect.width+'px',height:rect.height+'px',margin:'0',zIndex:'99999',pointerEvents:'none',transform:`translate3d(${rect.left}px,${rect.top}px,0)`});
    document.body.appendChild(ghost);source.classList.add('orbit-touch-source');
    dragVisual.current={ghost,source,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
  }
  function stopTouchVisual(target?:HTMLElement|null) {
    const visual=dragVisual.current;dragVisual.current=null;if(!visual)return;
    visual.source.classList.remove('orbit-touch-source');
    const rect=target?.getBoundingClientRect()??visual.source.getBoundingClientRect();
    visual.ghost.style.transition='transform 180ms cubic-bezier(.2,.8,.2,1),opacity 180ms ease';
    visual.ghost.style.transform=`translate3d(${rect.left}px,${rect.top}px,0)`;
    visual.ghost.style.opacity='0.35';
    window.setTimeout(()=>visual.ghost.remove(),200);
  }
  const [touchTask,setTouchTask] = useState<string|null>(null);
  const [touchTarget,setTouchTarget] = useState<DisplayStatus|null>(null);
  const [moveError, setMoveError] = useState('');
  async function moveTask(taskId: string, destination: DisplayStatus) {
    const task = tasks.find(item => item.id === taskId);
    if (!task || displayStatus(task.status) === destination || saving || moving) return;
    let resolution = task.resolution ?? '';
    if ((destination === 'Impedimento' || destination === 'Finalizado') && !resolution.trim()) {
      const entered = window.prompt(destination === 'Impedimento' ? 'Indica el motivo del impedimento:' : 'Indica la resolución de la tarea:');
      if (!entered?.trim()) { setMoveError('El cambio requiere un motivo o resolución.'); return; }
      resolution = entered.trim();
    }
    setMoving(true); setMoveError('');
    try { await onSave(taskId, storedStatus(destination), resolution); setMobileLane(destination); }
    catch (error) { setMoveError(error instanceof Error ? error.message : 'No se pudo mover la tarea.'); }
    finally { setMoving(false); setDragTaskId(null); }
  }
  function pointerRelease(event: React.PointerEvent<HTMLElement>, taskId: string) {
    if (event.pointerType === "mouse") return;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-kanban-target]');
    const status=target?.dataset.kanbanTarget as DisplayStatus|undefined;
    stopTouchVisual(target);
    if(status && STATUS_LABELS.includes(status)) void moveTask(taskId,status);
    setDragTaskId(null);setTouchTask(null);setTouchTarget(null);
  }
  function pointerMove(event:React.PointerEvent<HTMLElement>) {
    if(!touchTask || event.pointerType==="mouse")return;
    const visual=dragVisual.current;
    if(visual)visual.ghost.style.transform=`translate3d(${event.clientX-visual.offsetX}px,${event.clientY-visual.offsetY}px,0)`;
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-kanban-target]');
    const status=target?.dataset.kanbanTarget as DisplayStatus|undefined;
    setTouchTarget(status && STATUS_LABELS.includes(status)?status:null);
  }
  const [mobileLane, setMobileLane] = useState<DisplayStatus>('Activa');
  const [section, setSection] = useState<'tasks' | 'search' | 'trash'>('tasks');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId && !task.deleted_at);
  const activeTasks = tasks.filter(task => !task.deleted_at && (!selectedProject || task.project_id === selectedProject));
  const trashedTasks = tasks.filter(task => !!task.deleted_at && (!selectedProject || task.project_id === selectedProject));
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedTaskId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);

  const now = new Date();
  const filtered = useMemo(() => activeTasks.filter((task) => {
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

  function taskItem(task: Task, draggableCard = false) {
    return (
      <article className={`task-list-item task-compact-card ${touchTask===task.id?"orbit-task-touch-active":""}`} key={task.id} draggable={draggableCard && !saving && !moving}
        onDragStart={event => { if (!draggableCard) return; event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDragTaskId(task.id); }}
        onDragEnd={() => setDragTaskId(null)}>
        {draggableCard && <button type="button" className="orbit-drag-handle" aria-label={`Arrastrar ${task.title} a otro estado`} title="Mantén pulsado para mover"
          onPointerDown={event => { if (event.pointerType !== "mouse") { event.currentTarget.setPointerCapture(event.pointerId); setDragTaskId(task.id); setTouchTask(task.id); startTouchVisual(event); } }}
          onPointerMove={pointerMove}
          onPointerUp={event => pointerRelease(event, task.id)} onPointerCancel={() => {setDragTaskId(null);setTouchTask(null);setTouchTarget(null);stopTouchVisual();}}><GripVertical size={18}/></button>}
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
        <div className="orbit-task-card-actions"><button type="button" className="outline" onClick={() => onEdit(task)}><Pencil size={15} /> Editar</button><button type="button" className="outline orbit-action-delete" onClick={() => { void onDelete(task.id); }}><Trash2 size={15} /> Eliminar</button></div>
      </article>
    );
  }

  return (
    <section className="task-board">
      <nav className="orbit-board-tabs" aria-label="Secciones de tareas">
        <button type="button" className={section === 'tasks' ? 'active' : ''} onClick={() => setSection('tasks')}><List size={17} /> Tareas</button>
        <button type="button" className={section === 'search' ? 'active' : ''} onClick={() => setSection('search')}><Search size={17} /> Buscar</button>
        <button type="button" className={section === 'trash' ? 'active' : ''} onClick={() => setSection('trash')}><Trash2 size={17} /> Papelera ({trashedTasks.length})</button>
      </nav>
      {section === 'search' && <section className="orbit-board-panel"><h2 className="orbit-board-panel-title"><Search size={19} /> Buscar tareas</h2><div className="orbit-board-panel-body">
              <div className="board-toolbar">
        <label htmlFor="task-keyword">Buscar por palabra clave
          <div className="board-search"><Search size={17} aria-hidden="true" /><input id="task-keyword" type="search" placeholder="Buscar tareas, proyectos y resoluciones..." value={keyword}
            onChange={(event) => setKeyword(event.target.value)} /></div>
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

        <p>{filtered.length} resultados encontrados</p>
        <div className="task-list">{filtered.map(task => taskItem(task))}{filtered.length === 0 && <p className="empty">No se encontraron tareas.</p>}</div>
      </div></section>}
      {section === 'tasks' && <section className="orbit-board-panel"><h2 className="orbit-board-panel-title"><ClipboardList size={19} /> Tareas del proyecto</h2><div className="orbit-board-panel-body">
        <div className="orbit-board-primary-actions"><button type="button" onClick={onNewTask}><Plus size={16} /> Nueva tarea</button><button type="button" className="outline orbit-action-delete" disabled={!selectedProject || activeTasks.length === 0 || saving} onClick={() => { void onDeleteAll(); }}><Trash2 size={15} /> Eliminar todas</button></div>
              <div className="board-switch">
        <div className="board-view-controls">
          <button type="button" className={view === 'list' ? '' : 'outline'} onClick={() => setView('list')}><List size={16} aria-hidden="true" /> Lista</button>
          <button type="button" className={view === 'kanban' ? '' : 'outline'} onClick={() => setView('kanban')}><Columns3 size={16} aria-hidden="true" /> Kanban</button>
        </div>
        <span>{activeTasks.length} tareas · {overdue} vencidas</span>
      </div>
      {view === 'list' && (
        <div className="task-list">
          {activeTasks.map(task => taskItem(task))}
          {activeTasks.length === 0 && <p className="empty">No encontramos tareas con esos filtros.</p>}
        </div>
      )}
      {view === 'kanban' && (
        <div className="kanban-wrapper">
          {moveError && <p className="error" role="alert">{moveError}</p>}
          <div className={`orbit-kanban-dropbar ${touchTask?"orbit-dropbar-active":""}`} aria-label="Mover tarea a estado">
            {STATUS_LABELS.map(status => <button key={status} type="button" data-kanban-target={status} data-touch-target={touchTarget===status}
              disabled={!dragTaskId || saving || moving} onClick={() => { if (dragTaskId) void moveTask(dragTaskId, status); }}
              onDragOver={event => { if (dragTaskId) event.preventDefault(); }}
              onDrop={event => { event.preventDefault(); const id=event.dataTransfer.getData('text/plain') || dragTaskId; if (id) void moveTask(id,status); }}>
              <StatusDot status={status}/></button>)}
          </div>
          <label className="kanban-mobile-picker" htmlFor="kanban-mobile-status">Estado del tablero
            <select id="kanban-mobile-status" value={mobileLane} onChange={(event) => setMobileLane(event.target.value as DisplayStatus)}>
              {STATUS_LABELS.map((status) => <option key={status} value={status}>{status} ({activeTasks.filter((task) => displayStatus(task.status) === status).length})</option>)}
            </select>
          </label>
          <div className="kanban">
            {STATUS_LABELS.map((status) => (
              <section className="lane" data-kanban-target={status} data-touch-target={touchTarget===status} data-mobile-active={mobileLane === status ? 'true' : 'false'} key={status}
                onDragOver={event => { if (dragTaskId) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); const id=event.dataTransfer.getData("text/plain") || dragTaskId; if (id) void moveTask(id,status); }}>
                <h2><StatusDot status={status} /> <span>{activeTasks.filter((task) => displayStatus(task.status) === status).length}</span></h2>
                {activeTasks.filter((task) => displayStatus(task.status) === status).map(task => taskItem(task, true))}
              </section>
            ))}
          </div>
        </div>
      )}

      </div></section>}
      {section === 'trash' && <section className="orbit-board-panel"><h2 className="orbit-board-panel-title"><Trash2 size={19} /> Papelera del proyecto</h2><div className="orbit-board-panel-body">
        <p>Recupera las tareas eliminadas o elimínalas definitivamente.</p>
        {trashedTasks.map(task => <article className="task-list-item task-compact-card" key={task.id}><strong>{task.title}</strong><small>Eliminada: {dateLabel(task.deleted_at)}</small><div className="orbit-task-card-actions"><button type="button" className="outline" disabled={saving} onClick={() => { void onRestore(task.id); }}><RotateCcw size={15} /> Recuperar</button><button type="button" className="outline orbit-action-delete" disabled={saving} onClick={() => { void onPermanentDelete(task.id); }}><Trash2 size={15} /> Eliminar definitivamente</button></div></article>)}
        {trashedTasks.length === 0 && <p className="empty">La papelera está vacía.</p>}
      </div></section>}
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
