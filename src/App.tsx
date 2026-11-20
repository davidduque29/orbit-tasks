import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { orbitLogo } from './assets/orbitLogo';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { CharacterCounter } from './components/CharacterCounter';
import { NotesBoard } from './components/NotesBoard';
import { TaskBoard } from './components/TaskBoard';
import { UserProfile } from './components/UserProfile';
import { DeviceAccountSection } from './components/DeviceAccountSection';
import { MetricCard, type StatKind } from './components/DashboardVisuals';
import { CalendarDays, ChartNoAxesCombined, TrendingUp, ListChecks, FolderKanban, House, LayoutDashboard, Bell, CalendarClock, Pencil, Trash2, ArrowRight, ClipboardList, MoreVertical, ArrowLeft, X, Sparkles, AlertTriangle, Settings, UserRound, Smartphone, ChevronDown, ChevronUp, Search, CheckCircle2, ListTodo, Type, AlignLeft, Clock3, Flag, Plus, Save, Sun, Moon } from 'lucide-react';
import { NotificationCenter } from './components/NotificationCenter';
import { ReminderModal } from './components/ReminderModal';
import { reminderSummary, validateReminder, type ReminderSchedule } from './domain/reminders';
import { WeeklyAgenda } from './components/WeeklyAgenda';
import { TrendSparkline } from './components/TrendSparkline';
import { ProjectProgressReport } from './components/ProjectProgressReport';
import { calculateAverageCycleDays, calculateCompletionRate, countClosuresByDay } from './domain/metrics';
import { TASK_PRIORITIES, type TaskStatus, type Task } from './domain/models';
import { FIELD_LIMITS, validateEventFields, validateRequiredText, validateOptionalText } from './domain/formValidation';
import { useOrbitData } from './hooks/useOrbitData';
import { orbitRepository } from './infrastructure/orbitRepository';
import { supabase } from './infrastructure/supabaseClient';

type View = 'dashboard' | 'projects' | 'board' | 'events' | 'reports' | 'account';
type Space = 'pick' | 'notes' | 'projects' | 'events';
type AccountSection = 'home' | 'profile' | 'devices' | 'notifications' | 'appearance' | 'security';
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
  useEffect(() => {
    const dismissProjectMenus = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.project-card-options')) return;
      document.querySelectorAll<HTMLDetailsElement>('.project-card-options[open]').forEach(menu => menu.removeAttribute('open'));
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') document.querySelectorAll<HTMLDetailsElement>('.project-card-options[open]').forEach(menu => menu.removeAttribute('open'));
    };
    document.addEventListener('pointerdown', dismissProjectMenus);
    document.addEventListener('keydown', dismissWithEscape);
    return () => { document.removeEventListener('pointerdown', dismissProjectMenus); document.removeEventListener('keydown', dismissWithEscape); };
  }, []);
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
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('orbit-theme') === 'dark' ? 'dark' : 'light');
  useEffect(() => { document.documentElement.dataset.theme = theme; window.localStorage.setItem('orbit-theme', theme); return () => { delete document.documentElement.dataset.theme; }; }, [theme]);
  const { projects, tasks, events, loading, error, refresh } = useOrbitData(userId);
  const [view, setView] = useState<View>('projects');
  const [space, setSpace] = useState<Space>(() => {
    const choice = window.sessionStorage.getItem(`orbit-session-space:${userId}`);
    return choice === 'notes' || choice === 'projects' || choice === 'events' ? choice : 'pick';
  });
  function chooseSpace(target: Space) {
    if (target === 'pick') window.sessionStorage.removeItem(`orbit-session-space:${userId}`);
    else window.sessionStorage.setItem(`orbit-session-space:${userId}`, target);
    setSpace(target);
    setView(target === 'events' ? 'events' : target === 'projects' ? 'projects' : 'dashboard');
    setFeedback('');
  }

  const [accountSection, setAccountSection] = useState<AccountSection>('home');
  const [accountReturn, setAccountReturn] = useState<{ space: Space; view: View } | null>(null);
  function openAccount(section: AccountSection = 'home') { setAccountReturn({ space, view }); setAccountSection(section); setView('account'); }
  function closeAccount() { if (accountReturn) { setSpace(accountReturn.space); setView(accountReturn.view === 'account' ? 'dashboard' : accountReturn.view); } else { setView(space === 'events' ? 'events' : space === 'projects' ? 'projects' : 'dashboard'); } setAccountSection('home'); }

  const [reportTab, setReportTab] = useState<'indicators' | 'progress'>('indicators');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventListFilter, setEventListFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');
  const [eventListNow, setEventListNow] = useState(() => Date.now());
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const selectedEvent = events.find((item) => item.id === selectedEventId && !item.deleted_at);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [projectTrashOpen, setProjectTrashOpen] = useState(false);
  const [eventTrashOpen, setEventTrashOpen] = useState(false);
  const [projectTrashPage, setProjectTrashPage] = useState(1);
  const [eventTrashPage, setEventTrashPage] = useState(1);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClockNow(new Date()), 30000); return () => window.clearInterval(timer); }, []);
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

  const [confirmation, setConfirmation] = useState<{ title: string; message: string; action: () => void } | null>(null);
  function askConfirmation(title: string, message: string, action: () => void) {
    setConfirmation({ title, message, action });
  }
  function closeEditor() {
    if (saving) return;
    if (editorDirty) {
      askConfirmation('¿Descartar cambios?', 'Tienes información sin guardar. ¿Quieres salir sin guardar?', () => {
        setEditor(null);
        setEditorDirty(false);
      });
      return;
    }
    setEditor(null);
    setEditorDirty(false);
  }

  useEffect(() => {
    const updateNow = () => setEventListNow(Date.now());
    const interval = window.setInterval(updateNow, 60_000);
    window.addEventListener('focus', updateNow);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', updateNow); };
  }, []);

  const activeProjects = useMemo(() => projects.filter((project) => !project.deleted_at), [projects]);
  const trashedProjects = useMemo(() => projects.filter((project) => !!project.deleted_at), [projects]);
  const activeEvents = useMemo(() => events.filter((item) => !item.deleted_at && (!item.project_id || activeProjects.some((project) => project.id === item.project_id))), [events, activeProjects]);
  const trashedEvents = useMemo(() => events.filter((item) => !!item.deleted_at), [events]);
  const sortedEvents = useMemo(() => [...activeEvents].sort((left, right) => left.starts_at.localeCompare(right.starts_at)), [activeEvents]);
  const upcomingEvents = sortedEvents.filter((item) => item.status !== 'Cancelado' && new Date(item.starts_at).getTime() >= eventListNow);
  const previousEvents = sortedEvents.filter((item) => new Date(item.starts_at).getTime() < eventListNow).reverse();
  const displayedEvents = eventListFilter === 'upcoming' ? upcomingEvents : eventListFilter === 'past' ? previousEvents : sortedEvents;

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !task.deleted_at && activeProjects.some((project) => project.id === task.project_id) && (!selectedProject || task.project_id === selectedProject)),
    [selectedProject, tasks, activeProjects],
  );

  const completed = visibleTasks.filter((task) => task.status === 'Finalizado');
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
    const saved = await execute(() => editingTaskId ? orbitRepository.updateTask(editingTaskId, {
      project_id: taskProjectId,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      status: tasks.find(item => item.id === editingTaskId)?.status ?? 'Por hacer',
      estimated_due_at: taskDue ? new Date(taskDue).toISOString() : null,
    }) : orbitRepository.createTask(userId, {
      project_id: taskProjectId, title: taskTitle.trim(), description: taskDescription.trim(), priority: taskPriority,
      status: 'Por hacer', estimated_due_at: taskDue ? new Date(taskDue).toISOString() : null,
    }));
    if (!saved) return;
    setEditingTaskId(null);
    setTaskTitle('');
    setTaskDescription('');
    setTaskDue('');
  }

  async function saveEvent(event?: FormEvent<HTMLFormElement>, skipDuplicateWarning = false) {
    event?.preventDefault();
    const originalEvent = editingEventId ? events.find(item => item.id === editingEventId) : null;
    const originalStart = originalEvent ? toLocalInput(new Date(originalEvent.starts_at)) : null;
    const preservingPastDate = Boolean(originalEvent && eventStart === originalStart);
    const validation = validateEventFields(eventTitle, eventDescription, eventStart,
      preservingPastDate ? new Date(0) : new Date(), allowWeekendEvent);
    if (validation) { setFormError(validation); return; }
    // Preserve an existing expired schedule when changing only historical event details.
    // New or modified reminders must always be scheduled in the future.
    const originalReminderAt = originalEvent?.reminder_at ?? (originalEvent?.recurrence_rule ? originalEvent.starts_at : null);
    const preservingExpiredReminder = preservingPastDate
      && eventSchedule.at === originalReminderAt
      && JSON.stringify(eventSchedule.rule) === JSON.stringify(originalEvent?.recurrence_rule ?? null);
    const reminderError = preservingExpiredReminder ? null : validateReminder(eventSchedule);
    if (reminderError) { setFormError(reminderError); return; }
    setFormError('');
    // Warn only for the same normalized title and exact start instant.
    // Repeated meetings at different times are valid; editing excludes the current event.
    const normalizedTitle = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
    const startInstant = new Date(eventStart).getTime();
    const duplicate = events.find(item => item.id !== editingEventId
      && item.status !== 'Cancelado'
      && normalizedTitle(item.title) === normalizedTitle(eventTitle)
      && new Date(item.starts_at).getTime() === startInstant);
    if (duplicate && !skipDuplicateWarning) {
      askConfirmation('Posible evento duplicado',
        'Ya existe un evento con el mismo título, fecha y hora. ¿Quieres guardarlo de todos modos?',
        () => { void saveEvent(undefined, true); });
      return;
    }
    const payload = {
      title: eventTitle.trim(),
      description: eventDescription.trim(),
      starts_at: new Date(eventStart).toISOString(),
      project_id: eventProjectId || null,
      reminder_override_minutes: eventAvisos,
      recurrence_rule: eventSchedule.rule,
      reminder_at: eventSchedule.at,
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

  function editTask(item: Task) {
    setEditingTaskId(item.id);
    setTaskTitle(item.title);
    setTaskDescription(item.description);
    setTaskProjectId(item.project_id);
    setTaskPriority(item.priority);
    setTaskDue(item.estimated_due_at ? toLocalInput(new Date(item.estimated_due_at)) : '');
    setFormError('');
    setEditorDirty(false);
    setEditor('task');
  }

  function openTaskForProject(projectId: string) {
    setEditingTaskId(null);
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
    setEventSchedule({ at: item.reminder_at ?? (item.recurrence_rule ? item.starts_at : null), rule: item.recurrence_rule });
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
    if (type === 'task') { setEditingTaskId(null); setTaskTitle(''); setTaskDescription(''); setTaskDue(''); }
    if (type === 'task' && activeProjects.length === 0) {
      setFeedback('Crea primero un proyecto para registrar tareas.');
      setEditor('project');
      return;
    }
    setTaskProjectId(activeProjects.some((project) => project.id === selectedProject) ? selectedProject : activeProjects[0]?.id || '');
    setEditor(type);
  }

  return (
    <div className="shell">
      <header className="header">
        <div className="wordmark"><img className="brand-logo" src={orbitLogo} alt="" /><span className="orbit-brand-stack"><span>Orbit <b>Tasks</b></span><small className="orbit-header-clock">{clockNow.toLocaleString("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</small></span></div>
        <div className="orbit-header-actions">
          <UserProfile userId={userId} email={email} onAccountClick={() => openAccount()} theme={theme} onThemeChange={setTheme} />
        </div>
      </header>
      {space !== 'pick' && view !== 'account' && <nav className="workspace-navigation" aria-label="Cambiar módulo">
        <div className="workspace-navigation-heading">
          <span>Módulos</span>
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
      <main className="workspace">
        {feedback && <p role="status" className="feedback">{feedback}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {loading && <p className="muted">Sincronizando datos…</p>}

        {space === 'pick' && view !== 'account' && <section className="space-welcome">
          <img src={orbitLogo} alt="" className="space-welcome-logo" />
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
        
        {space === 'projects' && view === 'dashboard' && (
          <>
            <div className="heading"><div><h1>Tu productividad</h1><p>Proyectos y tareas sincronizados en Supabase.</p></div>
              <button onClick={() => { setView('projects'); openEditor('project'); }}><FolderKanban size={17} aria-hidden="true" /> Nuevo proyecto</button></div>
            <div className="stats">
              <Stat label="Proyectos" value={String(activeProjects.length)} kind="projects" />
              <Stat label="Pendientes" value={String(tasks.length - completed.length)} kind="pending" />
              <Stat label="Finalizadas" value={String(completed.length)} kind="finished" />
            </div>
            <section className="card"><h2>Próximas entregas</h2>
              {visibleTasks.filter((task) => task.status !== 'Finalizado').sort((a, b) =>
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
            <div className="heading project-list-heading"><div><h1>Mis proyectos</h1><p>{activeProjects.length} {activeProjects.length === 1 ? "proyecto registrado" : "proyectos registrados"}</p></div>
              <div className="project-heading-actions">
                <button onClick={() => openEditor('project')}><Plus size={17} aria-hidden="true" /> Nuevo proyecto</button>
              </div></div>
            <div className="project-search"><Search size={18} aria-hidden="true" />
              <input type="search" aria-label="Buscar proyectos" placeholder="Buscar proyectos..."
                value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} />
            </div>
<div className="orbit-trash-controls"><button type="button" className="notes-trash-back" onClick={() => { setProjectTrashOpen(!projectTrashOpen); setProjectTrashPage(1); }}>{projectTrashOpen ? <ArrowLeft size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}{projectTrashOpen ? 'Volver a proyectos' : 'Papelera (' + trashedProjects.length + ')'}</button></div>
            {projectTrashOpen && <section className="card notes-trash" aria-label="Papelera de proyectos"><h2><Trash2 size={19} aria-hidden="true"/> Papelera de proyectos</h2><p>Puede restaurar o eliminar definitivamente cada registro.</p>{trashedProjects.slice((projectTrashPage - 1) * 5, projectTrashPage * 5).map((item) => <div className="orbit-trash-entry" key={item.id}><strong>{item.name}</strong><span>{item.deleted_at ? formatDate(item.deleted_at) : ''}</span><div className="orbit-trash-actions"><button type="button" onClick={() => { void execute(() => orbitRepository.restoreProject(item.id)); }}>Restaurar</button><button type="button" className="project-option-danger" onClick={() => askConfirmation('Eliminar definitivamente', 'Esta acción eliminará el proyecto y sus tareas, y desvinculará sus eventos. No se puede deshacer.', () => { void execute(() => orbitRepository.deleteProjectPermanently(item.id)); })}>Eliminar definitivamente</button></div></div>)}{trashedProjects.length === 0 && <p>La papelera está vacía.</p>}<nav className="orbit-pagination" aria-label="Paginación de papelera"><button type="button" disabled={projectTrashPage === 1} onClick={() => setProjectTrashPage((p) => p - 1)}>Anterior</button><span>{projectTrashPage} / {Math.max(1, Math.ceil(trashedProjects.length / 5))}</span><button type="button" disabled={projectTrashPage >= Math.ceil(trashedProjects.length / 5)} onClick={() => setProjectTrashPage((p) => p + 1)}>Siguiente</button></nav></section>}
            {!projectTrashOpen && <div className="project-grid compact-project-grid">
              {activeProjects.filter((project) => [project.name, project.description].join(' ').toLocaleLowerCase()
                .includes(projectSearch.trim().toLocaleLowerCase())).map((project) => {
                const projectTasks = tasks.filter((task) => task.project_id === project.id && !task.deleted_at);
                const totalTasks = projectTasks.length;
                const completedTasks = projectTasks.filter((task) => task.status === 'Finalizado').length;
                const pendingTasks = totalTasks - completedTasks;
                const progress = calculateCompletionRate(projectTasks);
                const expanded = expandedProjects.includes(project.id);
                return <article className="card project-compact-card project-card-redesign" key={project.id}>
                  <div className="project-card-top">
                    <button className="project-compact-summary" type="button" aria-expanded={expanded}
                      aria-controls={`project-detail-${project.id}`}
                      onClick={() => setExpandedProjects((current) => expanded
                        ? current.filter((id) => id !== project.id) : [...current, project.id])}>
                      <span className="project-compact-icon"><FolderKanban size={22} aria-hidden="true" /></span>
                      <span className="project-compact-copy">
                        <strong>{project.name}</strong>
                        <span className="project-card-description">{project.description || 'Sin descripción adicional.'}</span>
                      </span>
                      <span className="project-compact-chevron" aria-hidden="true">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                    </button>
                    <details className="project-card-options">
                      <summary aria-label={`Opciones de ${project.name}`} title="Opciones del proyecto"><MoreVertical size={21} aria-hidden="true" /></summary>
                      <div className="project-card-options-list">
                        <button type="button" onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          setExpandedProjects((current) => current.includes(project.id) ? current : [...current, project.id]);
                        }}><Pencil size={16} aria-hidden="true" /> Ver detalles</button>
                        <button className="project-option-danger" type="button" onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          askConfirmation('Eliminar proyecto', '¿Mover el proyecto a la papelera? Sus tareas quedarán conservadas y ocultas hasta restaurarlo.', () => { void execute(() => orbitRepository.deleteProject(project.id)); });
                        }}><Trash2 size={16} aria-hidden="true" /> Eliminar proyecto</button>
                      </div>
                    </details>
                  </div>
                  <div className="project-card-progress-label"><span>Progreso del proyecto</span><strong>{progress.toFixed(0)}%</strong></div>
                  <div className="project-progress-track" role="progressbar" aria-label={`Avance de ${project.name}`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  <div className="orbit-project-metrics-plain" aria-label="Resumen de tareas del proyecto">
                    <span><span className="project-stat-label"><ListTodo size={17} aria-hidden="true" />Total</span><strong>{totalTasks}</strong></span>
                    <span><span className="project-stat-label"><ArrowRight size={17} aria-hidden="true" />Pendientes</span><strong>{pendingTasks}</strong></span>
                    <span><span className="project-stat-label"><CheckCircle2 size={17} aria-hidden="true" />Finalizadas</span><strong>{completedTasks}</strong></span>
                  </div>
                  <div className="project-card-primary-actions">
                    <button className="project-open-board" type="button" onClick={() => { setSelectedProject(project.id); setView('board'); }}>
                      <LayoutDashboard size={17} aria-hidden="true" /> Ver tablero
                    </button>
                    <button className="project-create-task" type="button" onClick={() => openTaskForProject(project.id)}
                      aria-label={`Crear una tarea en ${project.name}`}>
                      <Plus size={17} aria-hidden="true" /> Crear tarea
                    </button>
                  </div>
                  {expanded && <div id={`project-detail-${project.id}`} className="project-card-extra">
                    <p>{totalTasks === 0 ? 'Todavía no hay tareas en este proyecto.' : `Este proyecto tiene ${totalTasks} tareas registradas.`}</p>
                  </div>}
                </article>;
              })}
            </div>}
            {!projectTrashOpen && activeProjects.length === 0 && <Empty message="Aún no tienes proyectos." />}

          </>
        )}

        {space === 'projects' && view === 'board' && (
          <>
          <div className="project-board-context">
            <button className="project-board-back" type="button" onClick={() => setView('projects')}><ArrowLeft size={17} aria-hidden="true" /> Mis proyectos</button>
            <h1>{selectedProject ? (projects.find((item) => item.id === selectedProject)?.name ?? 'Proyecto') : 'Todos los proyectos'}</h1>
            <p>Tablero del proyecto · {visibleTasks.length} tareas registradas</p>
          </div>
          <TaskBoard
            projects={activeProjects}
            tasks={tasks.filter((task) => activeProjects.some((project) => project.id === task.project_id))}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
            onNewTask={() => openEditor('task')}
            onEdit={editTask}
            onRestore={async id => { await execute(() => orbitRepository.restoreTask(id)); }}
            onPermanentDelete={async id => { askConfirmation('Eliminar definitivamente', 'Esta tarea no podrá recuperarse. ¿Continuar?', () => { void execute(() => orbitRepository.deleteTaskPermanently(id)); }); }}
            onDeleteAll={async () => { if (!selectedProject) return; askConfirmation('Eliminar todas las tareas', 'Las tareas de este proyecto pasarán a la papelera. ¿Continuar?', () => { void execute(() => orbitRepository.deleteTasks(selectedProject)); }); }}
            onSave={changeStatus}
            onDelete={async (taskId) => { askConfirmation('Eliminar tarea', '¿Mover esta tarea a la papelera? Podrás recuperarla.', () => { void execute(() => orbitRepository.deleteTask(taskId)); }); }}
            saving={saving}
            userId={userId}
          />
          </>
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
                onClick={() => openAccount('notifications')}>Mi cuenta → Avisos</button>.</span>
            </div>
<div className="orbit-trash-controls"><button type="button" className="notes-trash-back" onClick={() => { setEventTrashOpen(!eventTrashOpen); setEventTrashPage(1); }}>{eventTrashOpen ? <ArrowLeft size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}{eventTrashOpen ? 'Volver a eventos' : 'Papelera (' + trashedEvents.length + ')'}</button></div>
            {eventTrashOpen && <section className="card notes-trash" aria-label="Papelera de eventos"><h2><Trash2 size={19} aria-hidden="true"/> Papelera de eventos</h2><p>Puede restaurar o eliminar definitivamente cada registro.</p>{trashedEvents.slice((eventTrashPage - 1) * 5, eventTrashPage * 5).map((item) => <div className="orbit-trash-entry" key={item.id}><strong>{item.title}</strong><span>{item.deleted_at ? formatDate(item.deleted_at) : ''}</span><div className="orbit-trash-actions"><button type="button" onClick={() => { void execute(() => orbitRepository.restoreEvent(item.id)); }}>Restaurar</button><button type="button" className="project-option-danger" onClick={() => askConfirmation('Eliminar definitivamente', 'Esta acción eliminará el evento definitivamente. No se puede deshacer.', () => { void execute(() => orbitRepository.deleteEventPermanently(item.id)); })}>Eliminar definitivamente</button></div></div>)}{trashedEvents.length === 0 && <p>La papelera está vacía.</p>}<nav className="orbit-pagination" aria-label="Paginación de papelera"><button type="button" disabled={eventTrashPage === 1} onClick={() => setEventTrashPage((p) => p - 1)}>Anterior</button><span>{eventTrashPage} / {Math.max(1, Math.ceil(trashedEvents.length / 5))}</span><button type="button" disabled={eventTrashPage >= Math.ceil(trashedEvents.length / 5)} onClick={() => setEventTrashPage((p) => p + 1)}>Siguiente</button></nav></section>}
            {!eventTrashOpen && <><WeeklyAgenda events={activeEvents} onEdit={editEvent} onDelete={(item) => {
              askConfirmation('Eliminar evento', `¿Eliminar el evento "${item.title}"? Podrás recuperarlo desde la papelera.`, () => { void execute(() => orbitRepository.deleteEvent(item.id)); });
            }} />
            <section className="event-list-section" aria-labelledby="event-list-title">
              <div className="event-list-heading">
                <h2 id="event-list-title"><ListChecks size={20} aria-hidden="true"/> Mis eventos <span>{activeEvents.length}</span></h2>
                <div className="event-list-filters" role="group" aria-label="Filtrar eventos por fecha">
                  {([
                    ['upcoming', 'Próximos', upcomingEvents.length],
                    ['past', 'Anteriores', previousEvents.length],
                    ['all', 'Todos', activeEvents.length],
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
                        askConfirmation('Eliminar evento', `¿Eliminar el evento "${item.title}"? Podrás recuperarlo desde la papelera.`, () => { void execute(() => orbitRepository.deleteEvent(item.id)); });
                      }}><Trash2 size={17} aria-hidden="true"/></button>
                    </span>
                  </div>;
                })}
                {displayedEvents.length === 0 && <div className="event-list-empty">
                  <CalendarDays size={23} aria-hidden="true"/>
                  <p>{eventListFilter === 'upcoming' ? 'No tienes eventos próximos.' : eventListFilter === 'past' ? 'No tienes eventos anteriores.' : 'Tu agenda está vacía.'}</p>
                </div>}
              </div>
            </section></>}
          </>
        )}

        {view === 'account' && (
          <section className="account-page account-module" aria-label="Módulo Mi cuenta">
            <div className="account-module-header">
              <button type="button" className="account-back-button" onClick={() => accountSection === 'home' ? closeAccount() : setAccountSection('home')} aria-label={accountSection === 'home' ? 'Volver al espacio de trabajo' : 'Volver a Mi cuenta'}><ArrowLeft size={22} aria-hidden="true" /></button>
              <div><h1>{accountSection === 'home' ? 'Mi cuenta' : accountSection === 'profile' ? 'Mi perfil' : accountSection === 'devices' ? 'Dispositivos' : accountSection === 'notifications' ? 'Avisos y notificaciones' : accountSection === 'appearance' ? 'Apariencia' : 'Seguridad'}</h1><p>{accountSection === 'home' ? 'Configuración y preferencias' : 'Administración de tu cuenta'}</p></div>
              <Settings size={24} className="account-page-icon" aria-hidden="true" />
            </div>
            {accountSection === 'home' && (
              <>
                <div className="account-intro-card">
                  <div className="account-intro-avatar"><UserRound size={30} aria-hidden="true" /></div>
                  <div><strong>Tu cuenta de Orbit Tasks</strong><span>{email}</span><small>Cuenta activa</small></div>
                </div>
                <div className="account-menu-list">
                  {([
                    ['profile', 'Mi perfil', 'Foto, nombre y datos personales', UserRound],
                    ['devices', 'Dispositivos', 'Gestiona tus dispositivos y notificaciones', Smartphone],
                    ['notifications', 'Avisos y notificaciones', 'Preferencias de avisos y recordatorios', Bell],
                    ['appearance', 'Apariencia', 'Tema y visualización', Sun],
                    ['security', 'Seguridad', 'Acceso y protección de la cuenta', Settings],
                  ] as const).map(([section, title, subtitle, Icon]) => (
                    <button type="button" key={section} className="account-menu-item" onClick={() => setAccountSection(section)}>
                      <span className="account-menu-icon"><Icon size={21} aria-hidden="true" /></span>
                      <span className="account-menu-copy"><strong>{title}</strong><small>{subtitle}</small></span>
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </>
            )}
            {accountSection === 'profile' && <div className="card account-profile-card"><UserProfile userId={userId} email={email} embedded /></div>}
            {accountSection === 'devices' && <div className="card account-devices-card"><h2>Mis dispositivos</h2><p>Administra los equipos registrados para recibir notificaciones de Orbit Tasks.</p><DeviceAccountSection userId={userId} /></div>}
            {accountSection === 'notifications' && <NotificationCenter userId={userId} />}
            {accountSection === 'appearance' && <div className="card account-settings-card"><h2>Tema de la aplicación</h2><p>Selecciona cómo quieres visualizar Orbit Tasks.</p><div className="account-theme-options"><button type="button" aria-pressed={theme === 'light'} className={theme === 'light' ? 'selected' : ''} onClick={() => setTheme('light')}><Sun size={20} /> Modo claro</button><button type="button" aria-pressed={theme === 'dark'} className={theme === 'dark' ? 'selected' : ''} onClick={() => setTheme('dark')}><Moon size={20} /> Modo oscuro</button></div></div>}
            {accountSection === 'security' && <div className="card account-settings-card"><h2>Seguridad de tu cuenta</h2><p>La autenticación y recuperación de acceso se gestionan desde tu proveedor de inicio de sesión. No compartas tus credenciales.</p><p>Correo de acceso: <strong>{email}</strong></p></div>}
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
              {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
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
      {space === 'projects' && view !== 'account' && (
        <nav className="project-utility-links project-utility-links-persistent" aria-label="Navegación de proyectos">
          <button type="button" className={view === 'dashboard' ? 'is-active' : ''} aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => setView('dashboard')}><House size={16} aria-hidden="true" /> Inicio</button>
          <button type="button" className={view === 'projects' ? 'is-active' : ''} aria-current={view === 'projects' ? 'page' : undefined} onClick={() => setView('projects')}><FolderKanban size={16} aria-hidden="true" /> Mis proyectos</button>
          <button type="button" className={view === 'board' ? 'is-active' : ''} aria-current={view === 'board' ? 'page' : undefined} onClick={() => { setSelectedProject(''); setView('board'); }}><LayoutDashboard size={16} aria-hidden="true" /> Tablero general</button>
          <button type="button" className={view === 'reports' ? 'is-active' : ''} aria-current={view === 'reports' ? 'page' : undefined} onClick={() => setView('reports')}><ChartNoAxesCombined size={16} aria-hidden="true" /> Reportes</button>
        </nav>
      )}

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
                    askConfirmation('Eliminar evento', `¿Eliminar el evento "${selectedEvent.title}"? Podrás recuperarlo desde la papelera.`, () => { void execute(() => orbitRepository.deleteEvent(selectedEvent.id)).then(() => setSelectedEventId(null)); });
                  }}><Trash2 size={16} aria-hidden="true" /> Eliminar</button>
                </div>
              </div>
              <div className="orbit-event-reminder">
                <span className="orbit-detail-label"><Bell size={16} aria-hidden="true" />Recordatorio</span>
                <p>{reminderSummary({ at: selectedEvent.reminder_at ?? (selectedEvent.recurrence_rule ? selectedEvent.starts_at : null), rule: selectedEvent.recurrence_rule })}</p>
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

      {confirmation && (
        <div className="modal-backdrop orbit-confirm-backdrop" role="presentation" onClick={() => setConfirmation(null)}>
          <section className="modal orbit-detail-modal" role="alertdialog" aria-modal="true" aria-labelledby="orbit-confirm-title" aria-describedby="orbit-confirm-message" onClick={(event) => event.stopPropagation()}>
            <h2 id="orbit-confirm-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{(confirmation.title === '¿Descartar cambios?' || confirmation.title === 'Posible evento duplicado') ? <AlertTriangle size={22} color="#d97706" aria-hidden="true" /> : <Trash2 size={22} color="#dc2626" aria-hidden="true" />}{confirmation.title}</h2>
            <p id="orbit-confirm-message">{confirmation.message}</p>
            <div className="orbit-event-save-footer" style={{ display: 'flex', gap: 12 }}>
              <button type="button" style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }} onClick={() => setConfirmation(null)}>Seguir editando</button>
              <button type="button" style={{ background: (confirmation.title === 'Descartar cambios' || confirmation.title === 'Posible evento duplicado') ? '#b45309' : '#dc2626', color: '#fff', border: 'none' }} onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>{confirmation.title === 'Descartar cambios' ? 'Descartar cambios' : confirmation.title === 'Posible evento duplicado' ? 'Guardar de todos modos' : confirmation.title}</button>
            </div>
          </section>
        </div>
      )}

      {editor && (
        <div className="modal-backdrop" role="presentation" onClick={closeEditor}>
          <section onChange={() => setEditorDirty(true)} className="modal orbit-detail-modal orbit-create-modal" role="dialog" aria-modal="true" aria-label={editor === 'event' ? (editingEventId ? 'Editar evento' : 'Nuevo evento') : editor === 'task' ? (editingTaskId ? 'Editar tarea' : 'Nueva tarea') : 'Nuevo proyecto'}
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
                  {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>
              <label><span className="form-label-icon"><Flag size={16} aria-hidden="true"/>Prioridad</span>
                <select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}>
                  {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
                </select></label>
              <label><span className="form-label-icon"><Clock3 size={16} aria-hidden="true"/>Fecha estimada</span>
                <input type="datetime-local" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label>
              <button disabled={saving}>{saving ? 'Guardando…' : editingTaskId ? 'Guardar cambios' : 'Guardar tarea'}</button>
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
                  {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
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
