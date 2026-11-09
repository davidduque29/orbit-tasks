import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock3, Pencil, Trash2 } from 'lucide-react';
import type { OrbitEvent } from '../domain/models';

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  return result;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function WeeklyAgenda({ events, onEdit, onDelete }: { events: OrbitEvent[]; onEdit: (event: OrbitEvent) => void; onDelete: (event: OrbitEvent) => void }) {
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const week = useMemo(() => {
    const monday = startOfWeek(new Date());
    monday.setDate(monday.getDate() + offset * 7);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + index);
      return date;
    });
  }, [offset]);
  const dayEvents = useMemo(() => events.filter((event) =>
    dateKey(new Date(event.starts_at)) === selectedDay && event.status !== 'Cancelado'
  ).sort((a,b) => a.starts_at.localeCompare(b.starts_at)), [events, selectedDay]);
  const formatter = new Intl.DateTimeFormat('es-CO', { month: 'short', day: 'numeric' });
  const title = `${formatter.format(week[0])} – ${formatter.format(week[6])}`;
  const moveWeek = (direction: number) => {
    setExpanded(false);
    setOffset((current) => current + direction);
    const next = new Date(week[0]);
    next.setDate(next.getDate() + 7 * direction);
    setSelectedDay(dateKey(next));
  };
  return <section className="card weekly-agenda" aria-labelledby="weekly-agenda-title">
    <div className="weekly-heading">
      <div><h2 id="weekly-agenda-title"><CalendarDays size={17} aria-hidden="true"/> Semana en tu agenda</h2><small>{title}</small></div>
      <div className="weekly-controls">
        <button type="button" className="outline" aria-label="Semana anterior" onClick={() => moveWeek(-1)}><ChevronLeft size={18}/></button>
        <button type="button" className="outline" aria-label="Volver a la semana actual" onClick={() => { setExpanded(false); setOffset(0); setSelectedDay(dateKey(new Date())); }}>Hoy</button>
        <button type="button" className="outline" aria-label="Semana siguiente" onClick={() => moveWeek(1)}><ChevronRight size={18}/></button>
      </div>
    </div>
    <div className="week-strip" role="group" aria-label="Seleccionar día de la semana">
      {week.map((date) => {
        const key = dateKey(date);
        const count = events.filter((event) => dateKey(new Date(event.starts_at)) === key && event.status !== 'Cancelado').length;
        const selected = key === selectedDay;
        return <button className={selected ? 'week-day selected' : 'week-day'} type="button" key={key}
          aria-pressed={selected} aria-label={`${date.toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}, ${count} eventos`}
          onClick={() => { setSelectedDay(key); setExpanded(false); }}>
          <small>{date.toLocaleDateString('es-CO',{weekday:'short'}).replace('.','')}</small>
          <strong>{date.getDate()}</strong><span className={count ? 'week-dot has-event' : 'week-dot'} aria-hidden="true"/>
        </button>;
      })}
    </div>
    <div className="week-events">
      <button type="button" className="week-events-toggle" aria-expanded={expanded}
        aria-controls="weekly-agenda-event-list" onClick={() => setExpanded(value => !value)}>
        <span><CalendarDays size={18} aria-hidden="true"/><strong>{new Date(selectedDay + 'T12:00:00').toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'long'})}</strong></span>
        <span className="week-events-toggle-meta">{dayEvents.length} {dayEvents.length === 1 ? 'evento' : 'eventos'} {expanded ? <ChevronUp size={18} aria-hidden="true"/> : <ChevronDown size={18} aria-hidden="true"/>}</span>
      </button>
      {expanded && <div id="weekly-agenda-event-list" className="week-events-list">
        {dayEvents.length ? dayEvents.map((event) => <div key={event.id} className="week-event">
          <div className="week-event-info">
            <Clock3 size={15} aria-hidden="true"/>
            <span>{new Date(event.starts_at).toLocaleTimeString('es-CO',{hour:'numeric',minute:'2-digit'})}</span>
            <strong>{event.title}</strong>
          </div>
          <div className="orbit-action-pair week-event-actions">
            <button type="button" className="orbit-action-edit" aria-label={`Editar ${event.title}`} onClick={() => onEdit(event)}><Pencil size={17} aria-hidden="true"/></button>
            <button type="button" className="orbit-action-delete" aria-label={`Eliminar ${event.title}`} onClick={() => onDelete(event)}><Trash2 size={17} aria-hidden="true"/></button>
          </div>
        </div>) : <p className="week-empty">No hay eventos programados para este día.</p>}
      </div>}
    </div>
  </section>;
}
