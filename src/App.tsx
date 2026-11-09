import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { CharacterCounter } from './components/CharacterCounter';
import { NotesBoard } from './components/NotesBoard';
import { TaskBoard } from './components/TaskBoard';
import { UserProfile } from './components/UserProfile';
import { DeviceAccountSection } from './components/DeviceAccountSection';
import { MetricCard, type StatKind } from './components/DashboardVisuals';
import { CalendarDays, ChartNoAxesCombined, TrendingUp, NotebookPen, ListChecks, FolderKanban, House, LayoutDashboard, Bell, CalendarClock, Pencil, Trash2, ArrowRight, ClipboardList, X, Sparkles, Settings, UserRound, Smartphone, ChevronDown, ChevronUp, Search, CheckCircle2, ListTodo, Type, AlignLeft, Clock3, Flag, Plus, Save } from 'lucide-react';
import { NotificationCenter } from './components/NotificationCenter';
import { ReminderModal } from './components/ReminderModal';
import { reminderSummary, validateReminder, type ReminderSchedule } from './domain/reminders';
import { WeeklyAgenda } from './components/WeeklyAgenda';
import { TrendSparkline } from './components/TrendSparkline';
import { ProjectProgressReport } from './components/ProjectProgressReport';
import { calculateAverageCycleDays, calculateCompletionRate, countClosuresByDay } from './domain/metrics';
import { TASK_PRIORITIES, type TaskStatus } from './domain/models';
import { FIELD_LIMITS, validateEventFields, validateRequiredText, validateOptionalText } from './domain/formValidation';
import { useOrbitData } from './hooks/useOrbitData';
import { orbitRepository } from './infrastructure/orbitRepository';
import { supabase } from './infrastructure/supabaseClient';

type View = 'dashboard' | 'projects' | 'board' | 'events' | 'reports' | 'account';
type Space = 'pick' | 'notes' | 'projects' | 'events';
type AccountSection = 'profile' | 'devices' | 'notifications';
type Editor = 'project' | 'task' | 'event';

function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha';
  return new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function getErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'No se pudo completar la operación.';
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      if (event === 'SIGNED_OUT') {
        // Keep a choice only during the current signed-in session, not between logins.
        for (const key of Object.keys(window.sessionStorage)) {
          if (key.startsWith('orbit-session-space:')) window.sessionStorage.removeItem(key);
        }
      }
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function finishPasswordRecovery() {
    await supabase.auth.signOut();
    setPasswordRecovery(false);
  }

  if (authLoading) return <main className="loading">Conectando Orbit Tasks…</main>;
  if (passwordRecovery) return <AuthScreen resetMode onPasswordReset={finishPasswordRecovery} />;
  if (!session) return <AuthScreen />;
  return <Workspace userId={session.user.id} email={session.user.email ?? ''} />;
}

function Workspace({ userId, email }: { userId: string; email: string }) {
  const { projects, tasks, events, loading, error, refresh } = useOrbitData(userId);
  const [view, setView] = useState<View>('dashboard');
  const [space, setSpace] = useState<Space>(() => {
    const choice = window.sessionStorage.getItem(`orbit-session-space:${userId}`);
    return choice === 'notes' || choice === 'projects' || choice === 'events' ? choice : 'pick';
  });
  function chooseSpace(target: Space) {
    if (target === 'pick') window.sessionStorage.removeItem(`orbit-session-space:${userId}`);
    else window.sessionStorage.setItem(`orbit-session-space:${userId}`, target);
    setSpace(target);
    setView(target === 'events' ? 'events' : 'dashboard');
    setFeedback('');
  }

  const [accountSection, setAccountSection] = useState<AccountSection>('profile');
  const [reportTab, setReportTab] = useState<'indicators' | 'progress'>('indicators');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventListFilter, setEventListFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [eventListNow, setEventListNow] = useState(() => Date.now());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const selectedEvent = events.find((item) => item.id === selectedEventId);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskPriority, setTaskPriority] = useState<(typeof TASK_PRIORITIES)[number]>('Media');
  const [taskDue, setTaskDue] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventStart, setEventStart] = useState(toLocalInput(new Date(Date.now() + 3_600_000)));
  const [eventSchedule, setEventSchedule] = useState<ReminderSchedule>({ at: null, rule: null });
  const [eventReminderOpen, setEventReminderOpen] = useState(false);
  const [eventAvisos, setEventAvisos] = useState<number[] | null>(null);
  const [allowWeekendEvent, setAllowWeekendEvent] = useState(false);
  const [eventProjectId, setEventProjectId] = useState('');
  const [formError, setFormError] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);

  function closeEditor() {
    if (saving) return;
    if (editorDirty && !window.confirm('Tienes cambios sin guardar. ¿Quieres descartarlos?')) return;
    setEditor(null);
    setEditorDirty(false);
  }

  useEffect(() => {
    const updateNow = () => setEventListNow(Date.now());
    const interval = window.setInterval(updateNow, 60_000);
    window.addEventListener('focus', updateNow);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', updateNow); };
  }, []);

  const sortedEvents = useMemo(() => [...events].sort((left, right) => left.starts_at.localeCompare(right.starts_at)), [events]);
  const upcomingEvents = sortedEvents.filter((item) => item.status !== 'Cancelado' && new Date(item.starts_at).getTime() >= eventListNow);
  const previousEvents = sortedEvents.filter((item) => new Date(item.starts_at).getTime() < eventListNow).reverse();
  const displayedEvents = eventListFilter === 'upcoming' ? upcomingEvents : eventListFilter === 'past' ? previousEvents : sortedEvents;

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !selectedProject || task.project_id === selectedProject),
    [selectedProject, tasks],
  );

  const completed = tasks.filter((task) => task.status === 'Finalizado');
  const cycle = calculateAverageCycleDays(visibleTasks.filter((task) => task.status === 'Finalizado'));
  const weekStart = new Date();
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const closureHistory = countClosuresByDay(visibleTasks, weekStart, 7);

  async function execute(action: () => Promise<unknown>) {
    setSaving(true);
    setFeedback('');
    try {
      await action();
      await refresh();
      setEditor(null);
      setEditorDirty(false);
      setFeedback('Cambios guardados y sincronizados.');
      return true;
    } catch (cause) {
      const message = getErrorMessage(cause);
      setFeedback(message);
      if (editor) setFormError(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateRequiredText(projectName, 'nombre del proyecto', FIELD_LIMITS.projectName)
      ?? validateOptionalText(projectDescription, 'descripción del proyecto', FIELD_LIMITS.projectDescription);
    if (validation) { setFormError(validation); return; }
    setFormError('');
    const saved = await execute(() => orbitRepository.createProject(userId, {
      name: projectName.trim(),
      description: projectDescription.trim(),
      color: '#7558df',
    }));
    if (!saved) return;
    setProjectName('');
    setProjectDescription('');
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateRequiredText(taskTitle, 'título de tarea', FIELD_LIMITS.taskTitle, 4)
      ?? validateOptionalText(taskDescription, 'descripción de tarea', FIELD_LIMITS.taskDescription);
    if (validation) { setFormError(validation); return; }
    setFormError('');
    const saved = await execute(() => orbitRepository.createTask(userId, {
      project_id: taskProjectId,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      status: 'Por hacer',
      estimated_due_at: taskDue ? new Date(taskDue).toISOString() : null,
    }));
    if (!saved) return;
    setTaskTitle('');
    setTaskDescription('');
    setTaskDue('');
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const originalEvent = editingEventId ? events.find(item => item.id === editingEventId) : null;
    const originalStart = originalEvent ? toLocalInput(new Date(originalEvent.starts_at)) : null;
    const preservingPastDate = Boolean(originalEvent && eventStart === originalStart);
    const validation = validateEventFields(eventTitle, eventDescription, eventStart,
      preservingPastDate ? new Date(0) : new Date(), allowWeekendEvent);
    if (validation) { setFormError(validation); return; }
    // Preserve an existing expired schedule when changing only historical event details.
    // New or modified reminders must always be scheduled in the future.
    const originalReminderAt = originalEvent?.recurrence_rule ? originalEvent.starts_at : null;
    const preservingExpiredReminder = preservingPastDate
      && eventSchedule.at === originalReminderAt
      && JSON.stringify(eventSchedule.rule) === JSON.stringify(originalEvent?.recurrence_rule ?? null);
    const reminderError = preservingExpiredReminder ? null : validateReminder(eventSchedule);
    if (reminderError) { setFormError(reminderError); return; }
    setFormError('');
    const payload = {
      title: eventTitle.trim(),
      description: eventDescription.trim(),
      starts_at: new Date(eventStart).toISOString(),
      project_id: eventProjectId || null,
      reminder_override_minutes: eventAvisos,
      recurrence_rule: eventSchedule.rule,
    };
    const saved = await execute(() => editingEventId
      ? orbitRepository.updateEvent(editingEventId, userId, payload)
      : orbitRepository.createEvent(userId, payload));
    if (!saved) return;
    setEventTitle('');
    setEventDescription('');
    setEventSchedule({ at: null, rule: null });
    setEventAvisos(null);
    setEditingEventId(null);
    setAllowWeekendEvent(false);
  }

  async function changeStatus(taskId: string, status: TaskStatus, resolution: string) {
    await execute(() => orbitRepository.updateTaskStatus(taskId, status, resolution));
  }

  function openTaskForProject(projectId: string) {
    setSelectedProject(projectId);
    setFormError('');
    setTaskProjectId(projectId);
    setTaskTitle('');
    setTaskDescription('');
    setTaskDue('');
    setEditor('task');
  }

  function editEvent(item: typeof events[number]) {
    setEditingEventId(item.id);
    setEventTitle(item.title);
    setEventDescription(item.description);
    setEventStart(toLocalInput(new Date(item.starts_at)));
    setEventSchedule({ at: item.recurrence_rule ? new Date(item.starts_at).toISOString() : null, rule: item.recurrence_rule });
    setEventAvisos(item.reminder_override_minutes ?? null);
    setEventProjectId(item.project_id ?? '');
    setAllowWeekendEvent([0, 6].includes(new Date(item.starts_at).getDay()));
    setFormError('');
    setEditorDirty(false);
    setSelectedEventId(null);
    setEditor('event');
  }

  function openEditor(type: Editor) {
    setFormError('');
    setEditorDirty(false);
    if (type === 'event') {
      setEditingEventId(null);
      setEventTitle('');
      setEventDescription('');
      setEventProjectId('');
      setEventStart(toLocalInput(new Date(Date.now() + 3_600_000)));
      setEventSchedule({ at: null, rule: null });
      setEventAvisos(null);
          setAllowWeekendEvent(false);
    }
    if (type === 'task' && projects.length === 0) {
      setFeedback('Crea primero un proyecto para registrar tareas.');
      setEditor('project');
      return;
    }
    setTaskProjectId(selectedProject || projects[0]?.id || '');
    setEditor(type);
  }

  return (
    <div className="shell">
      <header className="header">
        <div className="wordmark"><img className="brand-logo" src="/orbit-tasks/orbit-approved.webp" alt="" /><span>Orbit <b>Tasks</b></span></div>
        <div className="orbit-header-actions">

          <UserProfile userId={userId} email={email} onAccountClick={() => { setView('account'); setAccountSection('profile'); }} />
        </div>
      </header>
      {space !== 'pick' && <nav className="workspace-navigation" aria-label="Cambiar módulo">
        <div className="workspace-navigation-heading">
          <span>Espacios de trabajo</span>
          <button type="button" className="workspace-navigation-home" onClick={() => chooseSpace('pick')} aria-label="Ver todos los espacios de trabajo">
            <LayoutDashboard size={15} aria-hidden="true" /> Ver todos
          </button>
        </div>
        <div className="workspace-navigation-options">
          {([
            ['notes', 'Pendientes', ListChecks],
            ['projects', 'Proyectos', FolderKanban],
            ['events', 'Eventos', CalendarDays],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" className={`workspace-navigation-item${space === key ? ' is-active' : ''}`}
              aria-current={space === key ? 'page' : undefined}
              onClick={() => { if (space !== key) chooseSpace(key); }}>
              <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>}
      {space === 'projects' && <nav className="tabs" aria-label="Secciones">
        {([
          ['dashboard', 'Inicio', House], ['projects', 'Proyectos', FolderKanban], ['board', 'Tablero', LayoutDashboard],
          ['reports', 'Reportes', ChartNoAxesCombined],
        ] as const).map(([key, title, Icon]) => (
          <button type="button" aria-current={view === key ? 'page' : undefined} className={view === key ? 'active' : ''} key={key} onClick={() => setView(key)}>
            <Icon size={15} aria-hidden="true" />{title}
          </button>
        ))}
      </nav>}
      <main className="workspace">
        {feedback && <p role="status" className="feedback">{feedback}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {loading && <p className="muted">Sincronizando datos…</p>}

        {space === 'pick' && <section className="space-welcome">
          <img src="/orbit-tasks/orbit-approved.webp" alt="" className="space-welcome-logo" />
          <h1>¿Qué quieres organizar hoy?</h1>
          <p>Tres espacios independientes para organizar tus pendientes, proyectos y eventos.</p>
          <div className="space-choice-grid">
            <button type="button" onClick={() => chooseSpace('notes')} className="space-choice space-choice-notes">
              <span className="space-choice-icon"><ListChecks size={29} aria-hidden="true" /></span>
              <span><strong>Pendientes</strong><small>Notas rápidas, categorías, recordatorios y check para completar.</small></span>
              <ArrowRight size={21} aria-hidden="true"/>
            </button>
            <button type="button" onClick={() => chooseSpace('projects')} className="space-choice space-choice-projects">
              <span className="space-choice-icon"><FolderKanban size={29} aria-hidden="true" /></span>
              <span><strong>Proyectos</strong><small>Tablero Kanban, tareas y reportes de evolución.</small></span>
              <ArrowRight size={21} aria-hidden="true"/>
            </button>
            <button type="button" onClick={() => chooseSpace('events')} className="space-choice space-choice-events">
              <span className="space-choice-icon"><CalendarDays size={29} aria-hidden="true" /></span>
              <span><strong>Eventos</strong><small>Agenda, reuniones, recurrencias y recordatorios.</small></span>
              <ArrowRight size={21} aria-hidden="true"/>
            </button>
          </div>
        </section>}
        {space === 'notes' && view !== 'account' && <NotesBoard userId={userId} />}
        {space === 'notes' && view === 'account' && <button type="button" className="outline space-return" onClick={() => setView('dashboard')}>
          <NotebookPen size={17} aria-hidden="true"/> Volver a Pendientes
        </button>}
        {space === 'events' && view === 'account' && <button type="button" className="outline space-return" onClick={() => setView('events')}>
          <CalendarDays size={17} aria-hidden="true"/> Volver a Eventos
        </button>}
        {space === 'projects' && view === 'dashboard' && (
          <>
            <div className="heading"><div><h1>Tu productividad</h1><p>Proyectos y tareas sincronizados en Supabase.</p></div>
              <button onClick={() => { setView('projects'); openEditor('project'); }}><FolderKanban size={17} aria-hidden="true" /> Nuevo proyecto</button></div>
            <div className="stats">
              <Stat label="Proyectos" value={String(projects.length)} kind="projects" />
              <Stat label="Pendientes" value={String(tasks.length - completed.length)} kind="pending" />
              <Stat label="Finalizadas" value={String(completed.length)} kind="finished" />
            </div>
            <section className="card"><h2>Próximas entregas</h2>
              {tasks.filter((task) => task.status !== 'Finalizado').sort((a, b) =>
                (a.estimated_due_at ?? '9999').localeCompare(b.estimated_due_at ?? '9999'))
                .slice(0, 6).map((task) => (
                  <div className="list-row" key={task.id}><strong>{task.title}</strong>
                    <span className={task.estimated_due_at ? (new Date(task.estimated_due_at).getTime() < Date.now() ? 'date-badge overdue' : 'date-badge') : 'date-badge neutral'}>{task.estimated_due_at ? <CalendarDays size={13} aria-hidden="true"/> : null}{formatDate(task.estimated_due_at)}</span></div>
                ))}
              {tasks.length === 0 && <Empty message="Crea tu primer proyecto y comienza a registrar tareas." />}
            </section>
          </>
        )}

        {space === 'projects' && view === 'projects' && (
          <>
            <div className="heading"><div><h1>Proyectos</h1><p>Tu trabajo organizado por iniciativas.</p></div>
              <button onClick={() => openEditor('project')}>＋ Nuevo proyecto</button></div>
            <div className="project-search"><Search size={18} aria-hidden="true" />
              <input type="search" aria-label="Buscar proyectos" placeholder="Buscar proyectos..."
                value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} />
            </div>
            <div className="project-grid compact-project-grid">
              {projects.filter((project) => [project.name, project.description].join(' ').toLocaleLowerCase()
                .includes(projectSearch.trim().toLocaleLowerCase())).map((project) => {
                const projectTasks = tasks.filter((task) => task.project_id === project.id);
                const totalTasks = projectTasks.length;
                const completedTasks = projectTasks.filter((task) => task.status === 'Finalizado').length;
                const pendingTasks = totalTasks - completedTasks;
                const progress = calculateCompletionRate(projectTasks);
                const expanded = expandedProjects.includes(project.id);
                return <article className={expanded ? 'card project-compact-card is-expanded' : 'card project-compact-card'}
                  key={project.id}>
                  <button className="project-compact-summary" type="button" aria-expanded={expanded}
                    aria-controls={`project-detail-${project.id}`}
                    onClick={() => setExpandedProjects((current) => expanded
                      ? current.filter((id) => id !== project.id) : [...current, project.id])}>
                    <span className="project-compact-icon"><FolderKanban size={22} aria-hidden="true" /></span>
                    <span className="project-compact-copy">
                      <strong>{project.name}</strong>
                      <span className="project-compact-metrics">
                        <ListTodo size={14} aria-hidden="true" /> {totalTasks} {totalTasks === 1 ? 'tarea' : 'tareas'}
                        <span className="project-compact-percent">{progress.toFixed(0)}%</span>
                      </span>
                    </span>
                    <span className="project-compact-chevron" aria-hidden="true">
                      {expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </span>
                  </button>
                  <div className="project-progress-track" role="progressbar" aria-label={`Avance de ${project.name}`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  <button className="project-create-task project-create-task-shortcut" type="button"
                    onClick={() => openTaskForProject(project.id)}
                    aria-label={`Crear una tarea en ${project.name}`}>
                    <Plus size={16} aria-hidden="true"/> Crear tarea
                  </button>
                  {expanded && <div id={`project-detail-${project.id}`} className="project-compact-details">
                    <p>{project.description || 'Sin descripción adicional.'}</p>
                    <div className="project-compact-totals">
                      <span><ListTodo size={17} aria-hidden="true" />Total <strong>{totalTasks}</strong></span>
                      <span><ArrowRight size={17} aria-hidden="true" />Pendientes <strong>{pendingTasks}</strong></span>
                      <span><CheckCircle2 size={17} aria-hidden="true" />Finalizadas <strong>{completedTasks}</strong></span>
                    </div>
                    <div className="card-actions">
                      <button className="project-open-board" type="button"
                        onClick={() => { setSelectedProject(project.id); setView('board'); }}>
                        <ArrowRight size={15} aria-hidden="true" />Ver tablero
                      </button>
                      <button className="orbit-action-delete" type="button" onClick={() => {
                        if (window.confirm('¿Eliminar el proyecto y todas sus tareas?')) {
                          void execute(() => orbitRepository.deleteProject(project.id));
                        }
                      }}><Trash2 size={15} aria-hidden="true" />Eliminar</button>
                    </div>
                  </div>}
                </article>;
              })}
            </div>
            {projects.length === 0 && <Empty message="Aún no tienes proyectos." />}
          </>
        )}

        {space === 'projects' && view === 'board' && (
          <TaskBoard
            projects={projects}
            tasks={tasks}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
            onNewTask={() => openEditor('task')}
            onSave={changeStatus}
            onDelete={async (taskId) => { await execute(() => orbitRepository.deleteTask(taskId)); }}
            saving={saving}
            userId={userId}
          />
        )}

        {space === 'events' && view === 'events' && (
          <>
            <div className="heading event-page-heading">
              <div><h1><CalendarDays size={25} aria-hidden="true" /> Eventos y agenda</h1>
                <p>Organiza tus citas, reuniones y compromisos importantes.</p></div>
              <button type="button" onClick={() => openEditor('event')}><Plus size={18} aria-hidden="true"/> Nuevo evento</button>
            </div>
            <div className="event-reminder-hint">
              <CalendarClock size={17} aria-hidden="true" />
              <span>Los recordatorios se gestionan automáticamente. Revisa tus permisos en <button type="button"
                onClick={() => { setView('account'); setAccountSection('notifications'); }}>Mi cuenta → Avisos</button>.</span>
            </div>
            <WeeklyAgenda events={events} onEdit={editEvent} onDelete={(item) => {
              if (window.confirm(`¿Eliminar el evento "${item.title}"?`)) {
                void execute(() => orbitRepository.deleteEvent(item.id));
              }
            }} />
            <section className="event-list-section" aria-labelledby="event-list-title">
              <div className="event-list-heading">
                <h2 id="event-list-title"><ListChecks size={20} aria-hidden="true"/> Mis eventos <span>{events.length}</span></h2>
                <div className="event-list-filters" role="group" aria-label="Filtrar eventos por fecha">
                  {([
                    ['upcoming', 'Próximos', upcomingEvents.length],
                    ['past', 'Anteriores', previousEvents.length],
                    ['all', 'Todos', events.length],
                  ] as const).map(([key, label, count]) => (
                    <button type="button" key={key} className={eventListFilter === key ? 'selected' : ''}
                      aria-pressed={eventListFilter === key} onClick={() => setEventListFilter(key)}>
                      {label} <span>{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card event-list-card">
                {displayedEvents.map((item) => {
                  const date = new Date(item.starts_at);
                  return <div className="event-compact-card" key={item.id}>
                    <span className="event-date-tile" aria-hidden="true">
                      <strong>{date.getDate()}</strong>
                      <small>{date.toLocaleDateString('es-CO', {month:'short'}).replace('.','')}</small>
                    </span>
                    <span className="event-compact-copy"><strong>{item.title}</strong>
                      <small><Clock3 size={13} aria-hidden="true" />{formatDate(item.starts_at)}</small>
                      {item.status === 'Cancelado' && <small className="event-cancelled-label">Cancelado</small>}
                    </span>
                    <span className="orbit-action-pair event-list-actions">
                      <button type="button" className="orbit-action-edit" aria-label={`Editar ${item.title}`} title="Editar evento" onClick={() => editEvent(item)}><Pencil size={17} aria-hidden="true"/></button>
                      <button type="button" className="orbit-action-delete" aria-label={`Eliminar ${item.title}`} title="Eliminar evento" onClick={() => {
                        if (window.confirm(`¿Eliminar el evento "${item.title}"?`)) {
                          void execute(() => orbitRepository.deleteEvent(item.id));
                        }
                      }}><Trash2 size={17} aria-hidden="true"/></button>
                    </span>
                  </div>;
                })}
                {displayedEvents.length === 0 && <div className="event-list-empty">
                  <CalendarDays size={23} aria-hidden="true"/>
                  <p>{eventListFilter === 'upcoming' ? 'No tienes eventos próximos.' : eventListFilter === 'past' ? 'No tienes eventos anteriores.' : 'Tu agenda está vacía.'}</p>
                </div>}
              </div>
            </section>
          </>
        )}

        {view === 'account' && (
          <section className="account-page">
            <div className="heading"><div><h1>Mi cuenta</h1><p>Personaliza tu perfil y administra los avisos de tus dispositivos.</p></div>
              <Settings size={27} aria-hidden="true" className="account-page-icon" /></div>
            <div className="account-navigation" role="group" aria-label="Configuración de cuenta">
              {([
                ['profile', 'Mi perfil', UserRound],
                ['devices', 'Dispositivos', Smartphone],
                ['notifications', 'Avisos', Bell],
              ] as const).map(([section, title, Icon]) =>
                <button type="button" key={section} aria-pressed={accountSection === section}
                  className={accountSection === section ? 'account-nav-active' : ''}
                  onClick={() => setAccountSection(section)}><Icon size={16} aria-hidden="true" />{title}</button>)}
            </div>
            {accountSection === 'profile' && (
              <div className="card account-profile-card">
                <UserProfile userId={userId} email={email} embedded />
              </div>
            )}
            {accountSection === 'devices' && (
              <div className="card account-devices-card">
                <h2>Mis dispositivos</h2>
                <p>Administra los equipos registrados para recibir notificaciones de Orbit Tasks.</p>
                <DeviceAccountSection userId={userId} />
              </div>
            )}
            {accountSection === 'notifications' && <NotificationCenter userId={userId} />}
          </section>
        )}

        {space === 'projects' && view === 'reports' && (
          <>
            <div className="heading"><div><h1>Reportes</h1><p>Consulta indicadores y la evolución de tus proyectos.</p></div></div>
            <div className="report-section-tabs" role="group" aria-label="Tipo de reporte">
              <button type="button" className={reportTab === 'indicators' ? 'active' : ''} aria-pressed={reportTab === 'indicators'}
                onClick={() => setReportTab('indicators')}><ChartNoAxesCombined size={17} aria-hidden="true" />Indicadores</button>
              <button type="button" className={reportTab === 'progress' ? 'active' : ''} aria-pressed={reportTab === 'progress'}
                onClick={() => setReportTab('progress')}><TrendingUp size={17} aria-hidden="true" />Progreso</button>
            </div>
            {reportTab === 'progress' && <ProjectProgressReport projects={projects} tasks={tasks} />}
            {reportTab === 'indicators' && <>
            <select aria-label="Proyecto del reporte" className="filter" value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}>
              <option value="">Todos los proyectos</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <div className="stats">
              <Stat label="Tareas" value={String(visibleTasks.length)} kind="tasks" />
              <Stat label="Completadas" value={String(visibleTasks.filter((task) => task.status === 'Finalizado').length)} kind="finished" />
              <Stat label="Avance" value={calculateCompletionRate(visibleTasks).toFixed(0) + '%'} kind="progress" />
              <Stat label="Ciclo promedio" value={cycle === null ? '—' : cycle.toFixed(1) + ' días'} kind="cycle" />
            </div>
            <section className="card report-trend-card">
              <div className="report-trend-heading">
                <div><h2>Velocidad de cierre · 7 días</h2><p>Tendencia de tareas finalizadas en el período.</p></div>
                <TrendSparkline points={closureHistory} label="Tendencia de cierres" />
              </div>
              <div className="chart" aria-label="Cantidad de tareas completadas por día">
                {closureHistory.map((item) => (
                  <div className="chart-column" key={item.date}>
                    <b>{item.count}</b><div className="chart-bar" style={{ height: 10 + item.count * 28 }} />
                    <small>{item.date.slice(5)}</small>
                  </div>
                ))}
              </div>
            </section>
            </>}
          </>
        )}
      </main>

      {selectedEvent && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedEventId(null);
        }}>
          <section className="modal orbit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="event-detail-title">
            <CalendarDays className="orbit-modal-watermark" size={180} aria-hidden="true" />
            <header className="orbit-modal-header">
              <span className="orbit-modal-icon"><CalendarClock size={22} aria-hidden="true" /></span>
              <div className="orbit-modal-heading"><small>Detalle del evento</small>
                <h2 id="event-detail-title">{selectedEvent.title}</h2></div>
              <button className="outline orbit-modal-close" aria-label="Cerrar detalle" onClick={() => setSelectedEventId(null)}><X size={19} /></button>
            </header>
            <div className="orbit-event-details">
              <div className="orbit-event-description">
                <span className="orbit-detail-label"><AlignLeft size={16} aria-hidden="true" />Descripción</span>
                <p>{selectedEvent.description || 'Sin descripción adicional.'}</p>
              </div>
              <div className="orbit-event-date-actions">
                <div className="orbit-event-date">
                  <span className="orbit-detail-label"><CalendarClock size={16} aria-hidden="true" />Fecha y hora del evento</span>
                  <p>{formatDate(selectedEvent.starts_at)}</p>
                </div>
                <div className="orbit-action-pair">
                  <button type="button" className="orbit-action-edit" onClick={() => editEvent(selectedEvent)}>
                    <Pencil size={16} aria-hidden="true" /> Editar
                  </button>
                  <button type="button" className="orbit-action-delete" onClick={() => {
                    if (window.confirm('¿Eliminar este evento?')) {
                      void execute(() => orbitRepository.deleteEvent(selectedEvent.id)).then(() => setSelectedEventId(null));
                    }
                  }}><Trash2 size={16} aria-hidden="true" /> Eliminar</button>
                </div>
              </div>
              <div className="orbit-event-reminder">
                <span className="orbit-detail-label"><Bell size={16} aria-hidden="true" />Recordatorio</span>
                <p>{reminderSummary({ at: selectedEvent.recurrence_rule || selectedEvent.reminder_override_minutes?.length ? selectedEvent.starts_at : null, rule: selectedEvent.recurrence_rule })}</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {eventReminderOpen && (
        <ReminderModal variant="events" schedule={{ ...eventSchedule, at: (() => {
          const selected = new Date(eventSchedule.at ?? eventStart);
          return selected.getTime() > Date.now() ? selected.toISOString()
            : new Date(Date.now() + 3_600_000).toISOString();
        })() }}
          onClose={() => setEventReminderOpen(false)}
          onSave={(next) => {
            setEventSchedule(next);
            setEditorDirty(true);
            setEventReminderOpen(false);
          }}/>
      )}

      {editor && (
        <div className="modal-backdrop" role="presentation" onClick={closeEditor}>
          <section onChange={() => setEditorDirty(true)} className="modal orbit-detail-modal orbit-create-modal" role="dialog" aria-modal="true" aria-label={editor === 'event' ? (editingEventId ? 'Editar evento' : 'Nuevo evento') : editor === 'task' ? 'Nueva tarea' : 'Nuevo proyecto'}
            onClick={(event) => event.stopPropagation()}>
            <Sparkles className="orbit-modal-watermark" size={175} aria-hidden="true" />
            <header className="orbit-modal-header">
              <span className="orbit-modal-icon">{editor === 'project' ? <FolderKanban size={23} /> : editor === 'task' ? <ClipboardList size={23} /> : <CalendarDays size={23} />}</span>
              <div className="orbit-modal-heading">
                {editor !== 'event' && <small>Crear registro</small>}
                <h2>{editor === 'project' ? 'Nuevo proyecto' : editor === 'task' ? 'Nueva tarea' : editingEventId ? 'Editar evento' : 'Nuevo evento'}</h2></div>
              <button type="button" className="outline orbit-modal-close" aria-label="Cerrar formulario" onClick={closeEditor}><X size={19} /></button>
            </header>
            {formError && <p className="field-error form-validation-alert" role="alert">{formError}</p>}
            {editor === 'project' && <form onSubmit={(event) => void saveProject(event)} className="orbit-validated-form">
              <label><span className="form-label-icon"><FolderKanban size={16} aria-hidden="true"/>Nombre del proyecto <small>*</small></span>
                <input required minLength={2} spellCheck={true} lang="es" autoCorrect="on" maxLength={FIELD_LIMITS.projectName} placeholder="Ej.: Mejoras de Orbit Tasks" value={projectName}
                  onChange={(event) => setProjectName(event.target.value.slice(0, FIELD_LIMITS.projectName))} />
                <CharacterCounter value={projectName} max={FIELD_LIMITS.projectName} /></label>
              <label><span className="form-label-icon"><AlignLeft size={16} aria-hidden="true"/>Descripción (opcional)</span>
                <textarea spellCheck={true} lang="es" autoCorrect="on" autoCapitalize="sentences" maxLength={FIELD_LIMITS.projectDescription} placeholder="Describe brevemente el objetivo del proyecto..." value={projectDescription}
                  onChange={(event) => setProjectDescription(event.target.value.slice(0, FIELD_LIMITS.projectDescription))} />
                <CharacterCounter value={projectDescription} max={FIELD_LIMITS.projectDescription} /></label>
              <button disabled={saving}>{saving ? 'Guardando…' : 'Guardar proyecto'}</button>
            </form>}
            {editor === 'task' && <form onSubmit={(event) => void saveTask(event)} className="orbit-validated-form">
              <label><span className="form-label-icon"><Type size={16} aria-hidden="true"/>Título de la tarea <small>*</small></span>
                <input required minLength={4} spellCheck={true} lang="es" autoCorrect="on" maxLength={FIELD_LIMITS.taskTitle} placeholder="Ej.: Validar el tablero Kanban" value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value.slice(0, FIELD_LIMITS.taskTitle))} />
                <CharacterCounter value={taskTitle} max={FIELD_LIMITS.taskTitle} /></label>
              <label><span className="form-label-icon"><AlignLeft size={16} aria-hidden="true"/>Descripción (opcional)</span>
                <textarea spellCheck={true} lang="es" autoCorrect="on" autoCapitalize="sentences" maxLength={FIELD_LIMITS.taskDescription} placeholder="¿Qué se debe realizar?" value={taskDescription}
                  onChange={(event) => setTaskDescription(event.target.value.slice(0, FIELD_LIMITS.taskDescription))} />
                <CharacterCounter value={taskDescription} max={FIELD_LIMITS.taskDescription} /></label>
              <label><span className="form-label-icon"><FolderKanban size={16} aria-hidden="true"/>Proyecto <small>*</small></span>
                <select required value={taskProjectId} onChange={(event) => setTaskProjectId(event.target.value)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>
              <label><span className="form-label-icon"><Flag size={16} aria-hidden="true"/>Prioridad</span>
                <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}>
                  {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                </select></label>
              <label><span className="form-label-icon"><Clock3 size={16} aria-hidden="true"/>Fecha estimada</span>
                <input type="datetime-local" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label>
              <button disabled={saving}>{saving ? 'Guardando…' : 'Guardar tarea'}</button>
            </form>}
            {editor === 'event' && <form onSubmit={(event) => void saveEvent(event)} className="orbit-validated-form orbit-event-editor-form">
              <label><span className="form-label-icon"><Type size={16} aria-hidden="true"/>Título del evento <small>*</small></span>
                <input required minLength={4} spellCheck={true} lang="es" autoCorrect="on" maxLength={FIELD_LIMITS.eventTitle} placeholder="Ej.: Reunión de seguimiento" value={eventTitle}
                  onChange={(event) => setEventTitle(event.target.value.slice(0, FIELD_LIMITS.eventTitle))} />
                <CharacterCounter value={eventTitle} max={FIELD_LIMITS.eventTitle} /></label>
              <label><span className="form-label-icon"><AlignLeft size={16} aria-hidden="true"/>Descripción (opcional)</span>
                <textarea spellCheck={true} lang="es" autoCorrect="on" autoCapitalize="sentences" maxLength={FIELD_LIMITS.eventDescription} placeholder="Agrega el lugar, propósito o detalles del evento..." value={eventDescription}
                  onChange={(event) => setEventDescription(event.target.value.slice(0, FIELD_LIMITS.eventDescription))} />
                <CharacterCounter value={eventDescription} max={FIELD_LIMITS.eventDescription} /></label>
              <label><span className="form-label-icon"><CalendarClock size={16} aria-hidden="true"/>Fecha y hora del evento <small>*</small></span>
                <div className="event-date-time-controls">
                  <input aria-label="Fecha del evento" required type="date" min={editingEventId ? undefined : toLocalInput(new Date()).slice(0, 10)}
                    value={eventStart.slice(0, 10)}
                    onChange={(event) => {
                      const next = `${event.target.value}T${eventStart.slice(11, 16) || '09:00'}`;
                      setEventStart(next);
                      // Event date and reminder date are independent; do not move the reminder.
                    }} />
                  <input aria-label="Hora del evento" required type="time"
                    value={eventStart.slice(11, 16)}
                    onChange={(event) => {
                      const next = `${eventStart.slice(0, 10)}T${event.target.value}`;
                      setEventStart(next);
                      // Event date and reminder date are independent; do not move the reminder.
                    }} />
                </div>
                <span className="field-help">{editingEventId ? 'Puedes conservar la fecha original; para reprogramar selecciona una fecha futura.' : 'Selecciona una fecha futura.'} Los eventos en sábado o domingo requieren confirmación.</span>
              </label>
              {eventStart && [0, 6].includes(new Date(eventStart).getDay()) && (
                <label className="event-weekend-confirm">
                  <input type="checkbox" checked={allowWeekendEvent} onChange={(event) => setAllowWeekendEvent(event.target.checked)} />
                  Confirmo que este evento se realizará durante el fin de semana.
                </label>
              )}
              <div className="event-reminder-select orbit-event-options">
                <button type="button" className="orbit-event-options-toggle" onClick={() => setEventReminderOpen(true)}>
                  <CalendarClock size={19} aria-hidden="true"/>
                  <span><strong>Configurar recordatorio</strong>
                    {eventSchedule.at && <small>{reminderSummary(eventSchedule)}</small>}
                  </span>
                  <ChevronDown size={18} aria-hidden="true"/>
                </button>
              </div>
              <label><span className="form-label-icon"><FolderKanban size={16} aria-hidden="true"/>Proyecto opcional</span>
                <select value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)}>
                  <option value="">Sin proyecto</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>
              <div className="orbit-event-save-footer"><button type="submit" disabled={saving}><Save size={18} aria-hidden="true"/>{saving ? 'Guardando…' : editingEventId ? 'Guardar cambios' : 'Guardar evento'}</button></div>
            </form>}
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, kind }: { label: string; value: string; kind: StatKind }) {
  return <MetricCard label={label} value={value} kind={kind} />;
}

function Empty({ message }: { message: string }) {
  return <p className="empty">{message}</p>;
}
