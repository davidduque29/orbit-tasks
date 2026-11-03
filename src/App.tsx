import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen } from './components/AuthScreen';
import { TaskBoard } from './components/TaskBoard';
import { UserProfile } from './components/UserProfile';
import { NotificationCenter } from './components/NotificationCenter';
import { ReminderOverride } from './components/ReminderOverride';
import { calculateAverageCycleDays, calculateCompletionRate, countClosuresByDay } from './domain/metrics';
import { TASK_PRIORITIES, type TaskStatus } from './domain/models';
import { useOrbitData } from './hooks/useOrbitData';
import { orbitRepository } from './infrastructure/orbitRepository';
import { supabase } from './infrastructure/supabaseClient';

type View = 'dashboard' | 'projects' | 'board' | 'events' | 'reports' | 'notifications';
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
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
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
  const [eventProjectId, setEventProjectId] = useState('');

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
    } catch (cause) {
      setFeedback(getErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await execute(() => orbitRepository.createProject(userId, {
      name: projectName.trim(),
      description: projectDescription.trim(),
      color: '#7558df',
    }));
    setProjectName('');
    setProjectDescription('');
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await execute(() => orbitRepository.createTask(userId, {
      project_id: taskProjectId,
      title: taskTitle.trim(),
      description: taskDescription.trim(),
      priority: taskPriority,
      status: 'Por hacer',
      estimated_due_at: taskDue ? new Date(taskDue).toISOString() : null,
    }));
    setTaskTitle('');
    setTaskDescription('');
    setTaskDue('');
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await execute(() => orbitRepository.createEvent(userId, {
      title: eventTitle.trim(),
      description: eventDescription.trim(),
      starts_at: new Date(eventStart).toISOString(),
      project_id: eventProjectId || null,
    }));
    setEventTitle('');
    setEventDescription('');
  }

  async function changeStatus(taskId: string, status: TaskStatus, resolution: string) {
    await execute(() => orbitRepository.updateTaskStatus(taskId, status, resolution));
  }

  function openEditor(type: Editor) {
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
        <div className="wordmark"><span className="logo">✦</span><span>Orbit <b>Tasks</b></span></div>
        <UserProfile userId={userId} email={email} />
      </header>
      <nav className="tabs" aria-label="Secciones">
        {([
          ['dashboard', 'Inicio'], ['projects', 'Proyectos'], ['board', 'Tablero'],
          ['events', 'Eventos'], ['reports', 'Reportes'], ['notifications', 'Avisos'],
        ] as const).map(([key, title]) => (
          <button className={view === key ? 'active' : ''} key={key} onClick={() => setView(key)}>
            {title}
          </button>
        ))}
      </nav>
      <main className="workspace">
        {feedback && <p role="status" className="feedback">{feedback}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {loading && <p className="muted">Sincronizando datos…</p>}

        {view === 'dashboard' && (
          <>
            <div className="heading"><div><h1>Tu productividad</h1><p>Proyectos, tareas y eventos sincronizados en Supabase.</p></div>
              <button onClick={() => openEditor('task')}>＋ Nueva tarea</button></div>
            <div className="stats">
              <Stat label="Proyectos" value={String(projects.length)} />
              <Stat label="Pendientes" value={String(tasks.length - completed.length)} />
              <Stat label="Finalizadas" value={String(completed.length)} />
              <Stat label="Próximos eventos" value={String(events.filter((item) => new Date(item.starts_at) >= new Date()).length)} />
            </div>
            <section className="card"><h2>Próximas entregas</h2>
              {tasks.filter((task) => task.status !== 'Finalizado').sort((a, b) =>
                (a.estimated_due_at ?? '9999').localeCompare(b.estimated_due_at ?? '9999'))
                .slice(0, 6).map((task) => (
                  <div className="list-row" key={task.id}><strong>{task.title}</strong>
                    <span>{formatDate(task.estimated_due_at)}</span></div>
                ))}
              {tasks.length === 0 && <Empty message="Crea tu primer proyecto y comienza a registrar tareas." />}
            </section>
          </>
        )}

        {view === 'projects' && (
          <>
            <div className="heading"><div><h1>Proyectos</h1><p>Tu trabajo organizado por iniciativas.</p></div>
              <button onClick={() => openEditor('project')}>＋ Nuevo proyecto</button></div>
            <div className="project-grid">
              {projects.map((project) => {
                const projectTasks = tasks.filter((task) => task.project_id === project.id);
                const totalTasks = projectTasks.length;
                const completedTasks = projectTasks.filter((task) => task.status === 'Finalizado').length;
                const pendingTasks = totalTasks - completedTasks;
                return <article className="card" key={project.id}>
                  <h2>{project.name}</h2><p>{project.description || 'Sin descripción'}</p>
                  <div className="progress"><div style={{ width: calculateCompletionRate(projectTasks) + '%' }} /></div>
                  <small>Progreso: {completedTasks} de {totalTasks} finalizadas</small>
                  <div className="project-task-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.9rem', marginTop: '0.7rem', marginBottom: '0.8rem' }}>
                    <span><strong>Total:</strong> {totalTasks}</span>
                    <span><strong>Pendientes:</strong> {pendingTasks}</span>
                    <span><strong>Finalizadas:</strong> {completedTasks}</span>
                  </div>
                  <div className="card-actions">
                    <button className="outline" onClick={() => { setSelectedProject(project.id); setView('board'); }}>Ver tablero</button>
                    <button className="danger" onClick={() => {
                      if (window.confirm('¿Eliminar el proyecto y todas sus tareas?')) {
                        void execute(() => orbitRepository.deleteProject(project.id));
                      }
                    }}>Eliminar</button>
                  </div>
                </article>;
              })}
            </div>
            {projects.length === 0 && <Empty message="Aún no tienes proyectos." />}
          </>
        )}

        {view === 'board' && (
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

        {view === 'events' && (
          <>
            <div className="heading"><div><h1>Eventos y agenda</h1><p>Registra citas y compromisos importantes.</p></div>
              <button onClick={() => openEditor('event')}>＋ Nuevo evento</button></div>
            <div className="notice">🔔 Los eventos ya se almacenan en la nube. Las alarmas push con la app cerrada todavía requieren configurar el proveedor de notificaciones y las suscripciones de los dispositivos.</div>
            <section className="card">
              {events.map((item) => <div className="list-row" key={item.id}>
                <div><strong>{item.title}</strong><p>{item.description}</p><small>{formatDate(item.starts_at)}</small>
                  <ReminderOverride userId={userId} itemId={item.id} type="events" initial={item.reminder_override_minutes ?? null} />
                </div>
                <button className="danger" onClick={() => {
                  if (window.confirm('¿Eliminar este evento?')) void execute(() => orbitRepository.deleteEvent(item.id));
                }}>Eliminar</button>
              </div>)}
              {events.length === 0 && <Empty message="Tu agenda está vacía." />}
            </section>
          </>
        )}

        {view === 'notifications' && <NotificationCenter userId={userId} />}

        {view === 'reports' && (
          <>
            <div className="heading"><div><h1>Indicadores</h1><p>Mide resultados y velocidad de cierre.</p></div></div>
            <select aria-label="Proyecto del reporte" className="filter" value={selectedProject}
              onChange={(event) => setSelectedProject(event.target.value)}>
              <option value="">Todos los proyectos</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <div className="stats">
              <Stat label="Tareas" value={String(visibleTasks.length)} />
              <Stat label="Completadas" value={String(visibleTasks.filter((task) => task.status === 'Finalizado').length)} />
              <Stat label="Avance" value={calculateCompletionRate(visibleTasks).toFixed(0) + '%'} />
              <Stat label="Ciclo promedio" value={cycle === null ? '—' : cycle.toFixed(1) + ' días'} />
            </div>
            <section className="card"><h2>Velocidad de cierre · 7 días</h2>
              <div className="chart">
                {closureHistory.map((item) => (
                  <div className="chart-column" key={item.date}>
                    <b>{item.count}</b><div className="chart-bar" style={{ height: 10 + item.count * 28 }} />
                    <small>{item.date.slice(5)}</small>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {editor && (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditor(null)}>
          <section className="modal" role="dialog" aria-modal="true" aria-label="Nuevo registro"
            onClick={(event) => event.stopPropagation()}>
            <div className="heading"><h2>{editor === 'project' ? 'Nuevo proyecto' : editor === 'task' ? 'Nueva tarea' : 'Nuevo evento'}</h2>
              <button className="outline" onClick={() => setEditor(null)}>Cerrar</button></div>
            {editor === 'project' && <form onSubmit={(event) => void saveProject(event)}>
              <label>Nombre<input required maxLength={120} value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
              <label>Descripción<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} /></label>
              <button disabled={saving}>Guardar proyecto</button>
            </form>}
            {editor === 'task' && <form onSubmit={(event) => void saveTask(event)}>
              <label>Título<input required maxLength={200} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></label>
              <label>Descripción<textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} /></label>
              <label>Proyecto<select required value={taskProjectId} onChange={(event) => setTaskProjectId(event.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select></label>
              <label>Prioridad<select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}>
                {TASK_PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
              </select></label>
              <label>Fecha estimada<input type="datetime-local" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} /></label>
              <button disabled={saving}>Guardar tarea</button>
            </form>}
            {editor === 'event' && <form onSubmit={(event) => void saveEvent(event)}>
              <label>Título<input required maxLength={200} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} /></label>
              <label>Descripción<textarea value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} /></label>
              <label>Fecha y hora<input required type="datetime-local" value={eventStart}
                onChange={(event) => setEventStart(event.target.value)} /></label>
              <label>Proyecto opcional<select value={eventProjectId} onChange={(event) => setEventProjectId(event.target.value)}>
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

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card stat"><small>{label}</small><strong>{value}</strong></div>;
}

function Empty({ message }: { message: string }) {
  return <p className="empty">{message}</p>;
}
