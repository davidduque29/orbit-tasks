import { useEffect, useState, type FormEvent } from 'react';
import { getPushState, registerDevice, unregisterDevice, type PushState } from '../infrastructure/pushSupport';
import { ToggleSwitch } from './ToggleSwitch';
import {
  DEFAULT_NOTIFICATION_SETTINGS, REMINDER_OPTIONS,
  loadNotificationSettings, normalizeIntervals, saveNotificationSettings,
  type NotificationSettings,
} from '../infrastructure/notificationSettings';

interface Props { userId: string }

function IntervalSelector({ label, values, onChange, allowNow = false }: {
  label: string;
  values: number[];
  onChange(next: number[]): void;
  allowNow?: boolean;
}) {
  const [amount, setAmount] = useState('2');
  const [unit, setUnit] = useState('60');
  const existing = new Set(REMINDER_OPTIONS.map((option) => option.value));

  function addCustom() {
    const minutes = Number(amount) * Number(unit);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) return;
    onChange(normalizeIntervals([...values, minutes]));
  }

  return (
    <fieldset className="notification-intervals">
      <legend>{label}</legend>
      <div className="notification-choice-grid">
        {REMINDER_OPTIONS.filter((option) => allowNow || option.value > 0).map((option) => (
          <label key={option.value} className="notification-check">
            <input type="checkbox" checked={values.includes(option.value)}
              onChange={(event) => onChange(event.target.checked
                ? normalizeIntervals([...values, option.value])
                : values.filter((value) => value !== option.value))} />
            {option.label}
          </label>
        ))}
      </div>
      {values.filter((value) => !existing.has(value)).map((value) => (
        <label className="notification-check" key={value}>
          <input type="checkbox" checked
            onChange={() => onChange(values.filter((interval) => interval !== value))} />
          {value} minutos antes (personalizado)
        </label>
      ))}
      <div className="notification-custom">
        <input aria-label="Cantidad personalizada" type="number" min="1" max="525600"
          value={amount} onChange={(event) => setAmount(event.target.value)} />
        <select aria-label="Unidad del intervalo" value={unit}
          onChange={(event) => setUnit(event.target.value)}>
          <option value="1">Minutos</option>
          <option value="60">Horas</option>
          <option value="1440">Días</option>
          <option value="10080">Semanas</option>
        </select>
        <button type="button" className="outline" onClick={addCustom}>Añadir</button>
      </div>
      <small>Máximo 12 avisos, hasta un año de anticipación.</small>
    </fieldset>
  );
}

export function NotificationCenter({ userId }: Props) {
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_NOTIFICATION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [pushState, setPushState] = useState<PushState>('ready');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  useEffect(() => {
    void getPushState(userId).then(setPushState).catch(() => setPushState('unsupported'));
  }, [userId]);

  async function togglePush() {
    setPushBusy(true);
    setPushMessage('');
    try {
      if (pushState === 'enabled') await unregisterDevice(userId);
      else await registerDevice(userId);
      const next = await getPushState(userId);
      setPushState(next);
      setPushMessage(next === 'enabled' ? 'Dispositivo registrado. La entrega dependerá de los permisos y ajustes del sistema.' : 'Notificaciones desactivadas en este dispositivo.');
    } catch (cause) {
      setPushMessage(cause instanceof Error ? cause.message : 'No se pudo cambiar la suscripción.');
    } finally { setPushBusy(false); }
  }

  useEffect(() => {
    let active = true;
    void loadNotificationSettings(userId).then((values) => {
      if (active) { setSettings(values); setLoading(false); }
    }).catch((cause: unknown) => {
      if (active) {
        setMessage(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración.');
        setError(true);
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [userId]);

  function change<K extends keyof NotificationSettings>(key: K, value: NotificationSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(false);
    setMessage('');
    try {
      await saveNotificationSettings(userId, settings);
      setMessage('Preferencias guardadas en Supabase.');
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : 'No se pudieron guardar las preferencias.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="notification-center">
      <div className="heading">
        <div><h1>Centro de notificaciones</h1>
          <p>Personaliza los avisos de tareas y eventos.</p></div>
        <span className="notification-bell" aria-hidden="true">🔔</span>
      </div>
      <p className="notice">Tus preferencias se guardan en Supabase. Ya verificamos una entrega Web Push en iPhone; la llegada de cada aviso depende de la conexión y los permisos del dispositivo.</p>
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Notificaciones en este dispositivo</h2>
        <p>Permite que Orbit Tasks reciba avisos cuando esté cerrada.</p>
        {pushState === 'install-required' && <p>En iPhone debes abrir Orbit Tasks desde el icono de la pantalla de inicio, no desde Safari.</p>}
        {pushState === 'unsupported' && <p>Este navegador no admite notificaciones push.</p>}
        {pushState === 'denied' && <p>Los avisos están bloqueados. Debes habilitarlos desde la configuración del dispositivo.</p>}
        {(pushState === 'ready' || pushState === 'enabled') && (
          <button type="button" disabled={pushBusy} onClick={() => void togglePush()}>
            {pushBusy ? 'Procesando…' : pushState === 'enabled' ? 'Desactivar en este dispositivo' : 'Activar notificaciones'}
          </button>
        )}
        {pushMessage && <p role="status">{pushMessage}</p>}
        <details className="device-sound-guide">
          <summary>🔊 Sonido y vibración: ¿por qué podría llegar en silencio?</summary>
          <p>En iPhone, una aplicación web instalada no puede imponer un sonido personalizado ni forzar la vibración. Revisa Ajustes → Notificaciones → Orbit Tasks y activa Sonidos, si está disponible. Comprueba además Modos de concentración, el modo silencio y Ajustes → Sonidos y vibraciones.</p>
          <p>En Android, el navegador puede admitir patrones de vibración, pero las preferencias y permisos del sistema siempre tienen prioridad. Orbit Tasks solicita una vibración breve únicamente cuando el navegador la soporta.</p>
          <p><strong>Nota:</strong> mostrar una notificación no garantiza que el sistema reproduzca sonido o vibración.</p>
        </details>
      </section>
      {loading ? <p>Consultando preferencias…</p> : (
        <form onSubmit={(event) => void submit(event)} className="notification-settings-form">
          <section className="card">
            <h2>Tareas próximas a vencerse</h2>
            <p>Recibe avisos antes de la fecha límite de cada tarea.</p>
            <IntervalSelector label="Anticipación" values={settings.task_lead_minutes}
              onChange={(values) => change('task_lead_minutes', values)} />
          </section>
          <section className="card">
            <h2>Tareas vencidas</h2>
            <ToggleSwitch label="Activar avisos de tareas vencidas" checked={settings.overdue_enabled}
              onChange={(checked) => change('overdue_enabled', checked)} description="Recibe avisos cuando una tarea supere su fecha límite." />
            {settings.overdue_enabled && (
              <label>Repetir avisos
                <select value={String(settings.overdue_repeat_minutes)}
                  onChange={(event) => change('overdue_repeat_minutes', Number(event.target.value))}>
                  <option value="0">Una sola vez, al vencer</option>
                  <option value="60">Cada hora</option>
                  <option value="1440">Diariamente</option>
                  <option value="10080">Semanalmente</option>
                </select>
              </label>
            )}
          </section>
          <section className="card">
            <h2>Eventos de la agenda</h2>
            <p>Incluye la opción de avisar al comenzar el evento.</p>
            <IntervalSelector label="Anticipación" values={settings.event_lead_minutes}
              onChange={(values) => change('event_lead_minutes', values)} allowNow />
          </section>
          <section className="card">
            <h2>Horario de silencio</h2>
            <ToggleSwitch label="No molestar durante el horario configurado" checked={settings.quiet_hours_enabled}
              onChange={(checked) => change('quiet_hours_enabled', checked)} description="Durante estas horas el programador no enviará recordatorios." />
            {settings.quiet_hours_enabled && (
              <div className="notification-time-grid">
                <label>Desde <input type="time" value={settings.quiet_start.slice(0,5)}
                  onChange={(event) => change('quiet_start', event.target.value)} /></label>
                <label>Hasta <input type="time" value={settings.quiet_end.slice(0,5)}
                  onChange={(event) => change('quiet_end', event.target.value)} /></label>
              </div>
            )}
            <small>Zona horaria: America/Bogota</small>
          </section>
          {message && <p className={error ? 'error' : 'feedback'} role="status">{message}</p>}
          <button disabled={saving} type="submit">{saving ? 'Guardando…' : 'Guardar preferencias'}</button>
        </form>
      )}
    </section>
  );
}
