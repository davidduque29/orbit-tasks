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
  const [newAmount, setNewAmount] = useState('2');
  const [newUnit, setNewUnit] = useState('60');
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
    const minutes = Number(newAmount) * Number(newUnit);
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
      <summary>🔔 Recordatorios de {type === 'tasks' ? 'la tarea' : 'este evento'}</summary>
      <form onSubmit={(event) => void save(event)}>
        <label className="notification-check">
          <input type="checkbox" checked={custom} onChange={(event) => setCustom(event.target.checked)} />
          Personalizar avisos de este registro
        </label>
        {!custom && <p className="muted">Se aplican las preferencias generales.</p>}
        {custom && (
          <>
            <p className="muted">Si no seleccionas intervalos, este registro no tendrá avisos anticipados.</p>
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
            <div className="notification-custom">
              <input aria-label="Cantidad de intervalo" type="number" min="1"
                value={newAmount} onChange={(event) => setNewAmount(event.target.value)} />
              <select aria-label="Unidad de intervalo" value={newUnit}
                onChange={(event) => setNewUnit(event.target.value)}>
                <option value="1">Minutos</option><option value="60">Horas</option>
                <option value="1440">Días</option><option value="10080">Semanas</option>
              </select>
              <button type="button" className="outline" onClick={addInterval}>Agregar</button>
            </div>
          </>
        )}
        {message && <p role="status" className={error ? 'error' : 'feedback'}>{message}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar recordatorios'}</button>
      </form>
    </details>
  );
}
