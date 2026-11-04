import { useState, type FormEvent } from 'react';
import { REMINDER_OPTIONS, normalizeIntervals, saveReminderOverride } from '../infrastructure/notificationSettings';

interface Props {
  userId: string;
  itemId: string;
  type: 'tasks' | 'events';
  initial: number[] | null;
}

export function ReminderOverride({ userId, itemId, type, initial }: Props) {
  const [custom, setCustom] = useState(initial !== null);
  const [intervals, setIntervals] = useState<number[]>(initial ?? []);
  const [newAmount, setNewAmount] = useState('');
  const [newUnit, setNewUnit] = useState('1');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError(false);
    try {
      await saveReminderOverride(type, userId, itemId, custom ? intervals : null);
      setMessage('Configuración guardada.');
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  function addInterval() {
    const minutes = (newAmount.trim() ? Number(newAmount) : 0) * Number(newUnit);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 525600) {
      setMessage('El intervalo debe ser de entre 1 minuto y 1 año.');
      setError(true);
      return;
    }
    setError(false);
    setMessage('');
    setIntervals((previous) => normalizeIntervals([...previous, minutes]));
  }

  const presets = REMINDER_OPTIONS.filter((option) => type === 'events' || option.value !== 0);

  return (
    <details className="reminder-override">
      <summary>🔔 {type === 'tasks' ? 'Configurar avisos de la tarea' : 'Cambiar o agregar avisos del evento'}</summary>
      <form onSubmit={(event) => void save(event)}>
        <label className="notification-check">
          <input type="checkbox" checked={custom} onChange={(event) => setCustom(event.target.checked)} />
          Personalizar horarios de notificación
        </label>
        {!custom && <p className="muted">Se aplican las preferencias generales de Mi cuenta → Avisos.</p>}
        {custom && (
          <>
            <p className="muted">Elige uno o varios momentos para avisarte. Si no seleccionas ninguno, no se enviarán recordatorios de este registro.</p>
            <div className="notification-choice-grid">
              {presets.map((option) => (
                <label key={option.value} className="notification-check">
                  <input type="checkbox" checked={intervals.includes(option.value)}
                    onChange={(event) => setIntervals((previous) => event.target.checked
                      ? normalizeIntervals([...previous, option.value])
                      : previous.filter((value) => value !== option.value))} />
                  {option.label}
                </label>
              ))}
            </div>
            {intervals.filter((n) => !presets.some((option) => option.value === n)).map((n) => (
              <label className="notification-check" key={n}>
                <input type="checkbox" checked onChange={() => setIntervals((previous) => previous.filter((value) => value !== n))} />
                {n} minutos antes
              </label>
            ))}
            <details className="notification-advanced-interval">
              <summary>Opciones avanzadas: agregar otro aviso personalizado</summary>
              <p className="muted">Ejemplo: para recibir un aviso 2 horas antes, introduce 2 y selecciona Horas.</p>
              <div className="notification-custom">
                <label>Anticipación
                  <input aria-label="Cantidad de anticipación" placeholder="Ej.: 2" type="number" min="1" max="525600"
                    value={newAmount} onChange={(event) => setNewAmount(event.target.value)} />
                </label>
                <label>Unidad
                  <select aria-label="Unidad de anticipación" value={newUnit}
                    onChange={(event) => setNewUnit(event.target.value)}>
                    <option value="1">Minutos</option><option value="60">Horas</option>
                    <option value="1440">Días</option><option value="10080">Semanas</option>
                  </select>
                </label>
                <button type="button" className="outline" onClick={addInterval}>Añadir aviso</button>
              </div>
            </details>
          </>
        )}
        {message && <p role="status" className={error ? 'error' : 'feedback'}>{message}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar recordatorios'}</button>
      </form>
    </details>
  );
}
