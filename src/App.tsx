import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { CharacterCounter } from './components/CharacterCounter';
import { NotesBoard } from './components/NotesBoard';
import { TaskBoard } from './components/TaskBoard';
import { UserProfile } from './components/UserProfile';
import { DeviceAccountSection } from './components/DeviceAccountSection';
import { MetricCard, type StatKind } from './components/DashboardVisuals';
import { CalendarDays, ChartNoAxesCombined, TrendingUp, NotebookPen, ListChecks, FolderKanban, House, LayoutDashboard, Bell, CalendarClock, Trash2, ArrowRight, ClipboardList, X, Sparkles, Settings, UserRound, Smartphone, ChevronDown, ChevronUp, Search, CheckCircle2, ListTodo, Type, AlignLeft, Clock3, Flag, Plus } from 'lucide-react';
import { NotificationCenter } from './components/NotificationCenter';
import { ReminderOverride } from './components/ReminderOverride';
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
type Space = 'pick' | 'notes' | 'projects';
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
    return choice === 'notes' || choice === 'projects' ? choice : 'pick';
  });
  function chooseSpace(target: Space) {
    if (target === 'pick') window.sessionStorage.removeItem(`orbit-session-space:${userId}`);
    else window.sessionStorage.setItem(`orbit-session-space:${userId}`, target);
    setSpace(target);
    setView('dashboard');
    setFeedback('');
  }

  const [accountSection, setAccountSection] = useState<AccountSection>('profile');
  const [reportTab, setReportTab] = useState<'indicators' | 'progress'>('indicators');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
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
  const [allowWeekendEvent, setAllowWeekendEvent] = useState(false);
  const [eventProjectId, setEventProjectId] = useState('');
  const [formError, setFormError] = useState('');

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
    const validation = validateEventFields(eventTitle, eventDescription, eventStart, new Date(), allowWeekendEvent);
    if (validation) { setFormError(validation); return; }
    const reminderError = validateReminder(eventSchedule);
    if (reminderError) { setFormError(reminderError); return; }
    setFormError('');
    const saved = await execute(() => orbitRepository.createEvent(userId, {
      title: eventTitle.trim(),
      description: eventDescription.trim(),
      starts_at: new Date(eventStart).toISOString(),
      project_id: eventProjectId || null,
      reminder_override_minutes: eventSchedule.at ? [0] : [],
      recurrence_rule: eventSchedule.rule,
    }));
    if (!saved) return;
    setEventTitle('');
    setEventDescription('');
    setEventSchedule({ at: null, rule: null });
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

  function openEditor(type: Editor) {
    setFormError('');
    if (type === 'event') {
      setEventStart(toLocalInput(new Date(Date.now() + 3_600_000)));
      setEventSchedule({ at: null, rule: null });
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
          {space !== 'pick' && <div className="space-switch">
            <label htmlFor="space-selector" className="space-switch-label">Espacio de trabajo</label>
            <div className="space-switch-controls">
              <select id="space-selector" aria-label="Cambiar espacio de trabajo" value={space}
                onChange={(event) => chooseSpace(event.target.value as Space)}>
                <option value="notes">Pendientes</option>
                <option value="projects">Proyectos</option>
              </select>
              <button type="button" className="space-choose-button" onClick={() => chooseSpace('pick')} title="Elegir módulo"
                aria-label="Volver a elegir entre Pendientes y Proyectos"><LayoutDashboard size={18} aria-hidden="true"/></button>
            </div>
          </div>}
          <UserProfile userId={userId} email={email} onAccountClick={() => { setView('account'); setAccountSection('profile'); }} />
        </div>
      </header>
      {space === 'projects' && <nav className="tabs" aria-label="Secciones">
        {([
          ['dashboard', 'Inicio', House], ['projects', 'Proyectos', FolderKanban], ['board', 'Tablero', LayoutDashboard],
          ['events', 'Eventos', CalendarDays], ['reports', 'Reportes', ChartNoAxesCombined],
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
          <p>Dos espacios independientes para organizar tus pendientes y tus proyectos.</p>
          <div className="space-choice-grid">
            <button type="button" onClick={() => chooseSpace('notes')} className="space-choice space-choice-notes">
              <span className="space-choice-icon"><ListChecks size={29} aria-hidden="true" /></span>
              <span><strong>Pendientes</strong><small>Notas rápidas, categorías, recordatorios y check para completar.</small></span>
              <ArrowRight size={21} aria-hidden="true"/>
            </button>
            <button type="button" onClick={() => chooseSpace('projects')} className="space-choice space-choice-projects">
              <span className="space-choice-icon"><FolderKanban size={29} aria-hidden="true" /></span>
              <span><strong>Proyectos</strong><small>Tablero Kanban, eventos, tareas y reportes de evolución.</small></span>
              <ArrowRight size={21} aria-hidden="true"/>
            </button>
          </div>
        </section>}
        {space === 'notes' && view !== 'account' && <NotesBoard userId={userId} />}
        {space === 'notes' && view === 'account' && <button type="button" className="outline space-return" onClick={() => setView('dashboard')}>
          <NotebookPen size={17} aria-hidden="true"/> Volver a Pendientes
        </button>}
        {space === 'projects' && view === 'dashboard' && (
          <>
            <div className="heading"><div><h1>Tu productividad</h1><p>Proyectos, tareas y eventos sincronizados en Supabase.</p></div>
              <button onClick={() => { setView('projects'); openEditor('project'); }}><FolderKanban size={17} aria-hidden="true" /> Nuevo proyecto</button></div>
            <div className="stats">
              <Stat label="Proyectos" value={String(projects.length)} kind="projects" />
              <Stat label="Pendientes" value={String(tasks.length - completed.length)} kind="pending" />
              <Stat label="Finalizadas" value={String(completed.length)} kind="finished" />
              <Stat label="Próximos eventos" value={String(events.filter((item) => new Date(item.starts_at) >= new Date()).length)} kind="events" />
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
                      <button className="danger" type="button" onClick={() => {
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

        {space === 'projects' && view === 'events' && (
          <>
            <div className="heading"><div><h1>Eventos y agenda</h1><p>Registra citas y compromisos importantes.</p></div>
              <button onClick={() => openEditor('event')}>＋ Nuevo evento</button></div>
            <div className="notice">🔔 Tus eventos se sincronizan en Supabase. Los recordatorios se procesan automáticamente; verifica el estado del dispositivo en Avisos.</div>
            <WeeklyAgenda events={events} />
            <section className="card event-list-card">
              {events.map((item) => <button type="button" className="event-compact-card" key={item.id}
                onClick={() => setSelectedEventId(item.id)} aria-label={`Ver detalle de ${item.title}`}>
                <span className="event-compact-icon"><CalendarDays size={19} aria-hidden="true" /></span>
                <span className="event-compact-copy"><strong>{item.title}</strong>
                  <small><CalendarClock size={13} aria-hidden="true" />{formatDate(item.starts_at)}</small></span>
                <ArrowRight size={17} aria-hidden="true" />
              </button>)}
              {events.length === 0 && <Empty message="Tu agenda está vacía." />}
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
              <p>{selectedEvent.description || 'Sin descripción adicional.'}</p>
              <p className="event-time"><CalendarClock size={16} aria-hidden="true" />{formatDate(selectedEvent.starts_at)}</p>
              <ReminderOverride userId={userId} itemId={selectedEvent.id} type="events" initial={selectedEvent.reminder_override_minutes ?? null} />
              <button className="danger" onClick={() => {
                if (window.confirm('¿Eliminar este evento?')) {
                  void execute(() => orbitRepository.deleteEvent(selectedEvent.id)).then(() => setSelectedEventId(null));
                }
              }}><Trash2 size={15} aria-hidden="true" /> Eliminar evento</button>
            </div>
          </section>
        </div>
      )}

      {eventReminderOpen && (
        <ReminderModal variant="events" schedule={eventSchedule}
          onClose={() => setEventReminderOpen(false)}
          onSave={(next) => {
            setEventSchedule(next);
            setEventReminderOpen(false);
          }}/>
      )}

      {editor && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditor(null)}>
          <section className="modal orbit-detail-modal orbit-create-modal" role="dialog" aria-modal="true" aria-label="Nuevo registro"
            onClick={(event) => event.stopPropagation()}>
            <Sparkles className="orbit-modal-watermark" size={175} aria-hidden="true" />
            <header className="orbit-modal-header">
              <span className="orbit-modal-icon">{editor === 'project' ? <FolderKanban size={23} /> : editor === 'task' ? <ClipboardList size={23} /> : <CalendarDays size={23} />}</span>
              <div className="orbit-modal-heading"><small>Nuevo registro</small>
                <h2>{editor === 'project' ? 'Nuevo proyecto' : editor === 'task' ? 'Nueva tarea' : 'Nuevo evento'}</h2></div>
              <button type="button" className="outline orbit-modal-close" aria-label="Cerrar formulario" onClick={() => setEditor(null)}><X size={19} /></button>
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
              <button disabled={saving}>Guardar proyecto</button>
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
              <button disabled={saving}>Guardar tarea</button>
            </form>}
            {editor === 'event' && <form onSubmit={(event) => void saveEvent(event)} className="orbit-validated-form">
              <label><span className="form-label-icon"><Type size={16} aria-hidden="true"/>Título del evento <small>*</small></span>
                <input required minLength={4} spellCheck={true} lang="es" autoCorrect="on" maxLength={FIELD_LIMITS.eventTitle} placeholder="Ej.: Reunión de seguimiento" value={eventTitle}
                  onChange={(event) => setEventTitle(event.target.value.slice(0, FIELD_LIMITS.eventTitle))} />
                <CharacterCounter value={eventTitle} max={FIELD_LIMITS.eventTitle} /></label>
              <label><span className="form-label-icon"><AlignLeft size={16} aria-hidden="true"/>Descripción (opcional)</span>
                <textarea spellCheck={true} lang="es" autoCorrect="on" autoCapitalize="sentences" maxLength={FIELD_LIMITS.eventDescription} placeholder="Agrega el lugar, propósito o detalles del evento..." value={eventDescription}
                  onChange={(event) => setEventDescription(event.target.value.slice(0, FIELD_LIMITS.eventDescription))} />
                <CharacterCounter value={eventDescription} max={FIELD_LIMITS.eventDescription} /></label>
              <label><span className="form-label-icon"><CalendarClock size={16} aria-hidden="true"/>Fecha y hora <small>*</small></span>
                <input required type="datetime-local" min={toLocalInput(new Date())} value={eventStart}
                  onChange={(event) => setEventStart(event.target.value)} />
                <span className="field-help">Selecciona una fecha futura. Los eventos en sábado o domingo requieren confirmación.</span>
              </label>
              {eventStart && [0, 6].includes(new Date(eventStart).getDay()) && (
                <label className="event-weekend-confirm">
                  <input type="checkbox" checked={allowWeekendEvent} onChange={(event) => setAllowWeekendEvent(event.target.checked)} />
                  Confirmo que este evento se realizará durante el fin de semana.
                </label>
              )}
              <div className="event-reminder-select">
                <span className="form-label-icon"><Bell size={17} aria-hidden="true"/>Recordatorio y repetición</span>
                <button type="button" className="outline" onClick={() => setEventReminderOpen(true)}>
                  <CalendarClock size={17} aria-hidden="true"/> {reminderSummary(eventSchedule)} · Configurar
                </button>
                <span className="field-help">El aviso se configura con una fecha y hora; los eventos repetidos mantienen ese horario.</span>
              </div>
              <label><span className="form-label-icon"><FolderKanban size={16} aria-hidden="true"/>Proyecto opcional</span>
                <select value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)}>
                  <option value="">Sin proyecto</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>
              <button disabled={saving}>Guardar evento</button>
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
