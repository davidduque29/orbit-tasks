import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CalendarClock, Check, Repeat2, X } from 'lucide-react';
import {
  NO_REMINDER, WEEKDAY_LABELS, reminderSummary, toLocalDateTime,
  validateReminder, type RecurrenceRule, type ReminderSchedule,
  type RepeatFrequency,
} from '../domain/reminders';

type Mode = 'none' | 'once' | RepeatFrequency;
const FREQUENCIES: { mode: Mode; title: string }[] = [
  { mode: 'none', title: 'Sin recordatorio' },
  { mode: 'once', title: 'Una sola vez' },
  { mode: 'daily', title: 'Diariamente' },
  { mode: 'weekdays', title: 'Entre semana' },
  { mode: 'weekly', title: 'Semanalmente' },
  { mode: 'monthly', title: 'Mensualmente' },
  { mode: 'yearly', title: 'Anualmente' },
];

export function ReminderModal({
  schedule, variant, onSave, onClose,
}: {
  schedule: ReminderSchedule;
  variant: 'notes' | 'events';
  onSave: (schedule: ReminderSchedule) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(schedule.rule?.frequency ?? (schedule.at ? 'once' : 'none'));
  const [dateTime, setDateTime] = useState(() => schedule.at
    ? toLocalDateTime(new Date(schedule.at)) : toLocalDateTime(new Date(Date.now() + 3600000)));
  const [interval, setInterval] = useState(schedule.rule?.interval ?? 1);
  const [days, setDays] = useState<number[]>(schedule.rule?.days?.length ? [...schedule.rule.days] : [1,2,3,4,5]);
  const [until, setUntil] = useState(schedule.rule?.until ?? '');
  const [hasEnd, setHasEnd] = useState(Boolean(schedule.rule?.until));
  const [error, setError] = useState('');

  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') onClose(); }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const repeating = mode !== 'none' && mode !== 'once';
  function save() {
    if (mode === 'none') { onSave(NO_REMINDER); return; }
    if (repeating && hasEnd && !until) {
      setError('Selecciona una fecha final o desactiva la opción de finalización.');
      return;
    }
    const instant = dateTime ? new Date(dateTime) : new Date(Number.NaN);
    const rule: RecurrenceRule | null = repeating ? {
      frequency: mode, interval: mode === 'weekdays' ? 1 : interval,
      ...(mode === 'weekly' ? { days } : {}),
      ...(hasEnd && until ? { until } : {}),
    } : null;
    const next: ReminderSchedule = { at: Number.isFinite(instant.getTime()) ? instant.toISOString() : 'invalid', rule };
    const failure = validateReminder(next);
    if (failure) { setError(failure); return; }
    setError('');
    onSave(next);
  }
  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="modal orbit-detail-modal reminder-modal" role="dialog" aria-modal="true"
      aria-labelledby="orbit-reminder-title">
      <header className="orbit-modal-header">
        <span className="orbit-modal-icon"><Bell size={22} aria-hidden="true"/></span>
        <div className="orbit-modal-heading">
          <small>Fecha · Hora · Repetición</small>
          <h2 id="orbit-reminder-title">Configurar recordatorio</h2>
        </div>
        <button type="button" className="outline orbit-modal-close" onClick={onClose}
          aria-label="Cerrar"><X size={18}/></button>
      </header>
      <p className="muted">¿Cuándo quieres recibir el aviso? Las repeticiones mantienen la hora que elijas.</p>
      <div className="reminder-choice-grid" role="group" aria-label="Frecuencia del recordatorio">
        {FREQUENCIES.filter(option => variant === 'events' || option.mode !== 'yearly').map(option =>
          <button type="button" key={option.mode} className={mode === option.mode ? 'selected' : ''}
            aria-pressed={mode === option.mode} onClick={() => { setMode(option.mode); setError(''); }}>
            <Repeat2 size={15} aria-hidden="true"/>{option.title}
          </button>)}
      </div>
      {mode !== 'none' && <div className="reminder-field">
        <span><CalendarClock size={16} aria-hidden="true"/> Fecha y hora {repeating ? 'del primer aviso' : 'del aviso'}</span>
        <div className="event-date-time-controls">
          <input type="date" required aria-label="Fecha del primer aviso"
            min={toLocalDateTime(new Date()).slice(0, 10)} value={dateTime.slice(0, 10)}
            onChange={event => {
              setDateTime(`${event.target.value}T${dateTime.slice(11, 16) || '09:00'}`);
              setError('');
            }}/>
          <input type="time" required aria-label="Hora del primer aviso" value={dateTime.slice(11, 16)}
            onChange={event => {
              setDateTime(`${dateTime.slice(0, 10)}T${event.target.value}`);
              setError('');
            }}/>
        </div>
      </div>}
      {repeating && <>
        {mode !== 'weekdays' && <label className="reminder-field">
          <span>Repetir cada</span>
          <select value={interval} onChange={event => setInterval(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(n =>
              <option key={n} value={n}>{n} {mode === 'daily' ? 'día(s)' : mode === 'weekly' ?
                'semana(s)' : mode === 'monthly' ? 'mes(es)' : 'año(s)'}</option>)}
          </select>
        </label>}
        {mode === 'weekly' && <fieldset className="reminder-weekdays">
          <legend>Días de la semana</legend>
          <div>{WEEKDAY_LABELS.map((day, index) => {
            const value = index + 1;
            return <button type="button" key={value} aria-pressed={days.includes(value)}
              className={days.includes(value) ? 'selected' : ''}
              onClick={() => setDays(previous => previous.includes(value) ?
                previous.filter(d => d !== value) : [...previous, value].sort())}>{day}</button>;
          })}</div>
        </fieldset>}
        <label className="reminder-end-toggle">
          <input type="checkbox" checked={hasEnd} onChange={event => {
            setHasEnd(event.target.checked);
            setError('');
          }}/>
          <span>Establecer una fecha de finalización (opcional)</span>
        </label>
        {hasEnd ? <div className="reminder-field">
          <span>La repetición termina el</span>
          <div className="reminder-end-fields">
            <label>
              <span>Fecha final</span>
              <input type="date" required min={dateTime.slice(0, 10)} value={until}
                onChange={event => { setUntil(event.target.value); setError(''); }}/>
            </label>
            <label>
              <span>Hora del último aviso</span>
              <input type="time" readOnly value={dateTime.slice(11, 16)}
                aria-label="La hora final coincide con la del primer aviso"/>
            </label>
          </div>
          <p className="field-help">La repetición finalizará en la fecha indicada, manteniendo la misma hora de aviso.</p>
        </div> : <p className="field-help">Se repetirá indefinidamente hasta que cambies o elimines el recordatorio.</p>}
      </>}
      {error && <p role="alert" aria-live="assertive" className="field-error">{error}</p>}
      {mode !== 'none' && !error && <p className="reminder-preview">
        <Check size={15} aria-hidden="true"/> {reminderSummary({
          at: Number.isFinite(new Date(dateTime).getTime()) ? new Date(dateTime).toISOString() : null,
          rule: repeating ? { frequency: mode, interval, ...(mode === 'weekly' ? { days } : {}) } : null,
        })}
      </p>}
      <button type="button" className="reminder-confirm" onClick={save}>
        <Check size={17} aria-hidden="true"/> Aplicar recordatorio
      </button>
    </section>
  </div>, document.body);
}
