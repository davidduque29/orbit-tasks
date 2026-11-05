import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Bell, CalendarClock, Check, CheckCircle2, FolderPlus, ListTodo, NotebookPen, Pencil, Plus, Search, Tag, Trash2, X, Mic, MicOff, Volume2, VolumeX, SlidersHorizontal, CheckSquare, Circle } from 'lucide-react';
import { supabase } from '../infrastructure/supabaseClient';
import { ReminderModal } from './ReminderModal';
import { NO_REMINDER, reminderSummary, validateReminder, type ReminderSchedule, type RecurrenceRule } from '../domain/reminders';

type NoteKind = 'note' | 'pending';
type Note = {
  id: string; owner_id: string; category_id: string | null; kind: NoteKind;
  title: string; description: string; reminder_at: string | null; completed: boolean;
  completed_at: string | null; created_at: string; updated_at: string;
  recurrence_rule: RecurrenceRule | null;
  recurrence_series_id: string | null; recurrence_next_created: boolean;
};
type Category = { id: string; name: string; color: string; owner_id: string };
const TITLE_MAX = 80;

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognizer = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type SpeechConstructor = new () => SpeechRecognizer;
type SpeechWindow = Window & { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };

function getSpeechConstructor(): SpeechConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

function completionTone(): void {
  const compatibleWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = window.AudioContext ?? compatibleWindow.webkitAudioContext;
  if (!AudioContextConstructor) return;
  const audio = new AudioContextConstructor();
  void audio.resume().then(() => {
    const now = audio.currentTime;
    for (const [index, pitch] of [523.25, 659.25].entries()) {
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = pitch;
      volume.gain.setValueAtTime(0.0001, now + index * .105);
      volume.gain.exponentialRampToValueAtTime(.11, now + index * .105 + .015);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + index * .105 + .16);
      tone.connect(volume).connect(audio.destination);
      tone.start(now + index * .105);
      tone.stop(now + index * .105 + .17);
    }
    window.setTimeout(() => { void audio.close(); }, 550);
  }).catch(() => { void audio.close(); });
}

function reminderLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'No pudimos completar la operación.';
}

export function NotesBoard({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<'pending' | 'search' | 'categories'>('pending');
  const [statusTab, setStatusTab] = useState<'active' | 'completed'>('active');
  const [quickOptionsOpen, setQuickOptionsOpen] = useState(false);
  const [quickCategory, setQuickCategory] = useState('');
  const [quickReminder, setQuickReminder] = useState<ReminderSchedule>(NO_REMINDER);
  const [reminderTarget, setReminderTarget] = useState<'quick' | 'editor' | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => window.localStorage.getItem('orbit-completion-sound') !== 'off');
  const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const speechAvailable = Boolean(getSpeechConstructor());
  const [editId, setEditId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [categoryColor, setCategoryColor] = useState('#7658D8');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reminder, setReminder] = useState<ReminderSchedule>(NO_REMINDER);
  const [quickTitle, setQuickTitle] = useState('');
  const [historySeriesId, setHistorySeriesId] = useState<string | null>(null);

  useEffect(() => () => { recognizer.current?.stop(); recognizer.current = null; }, []);

  function toggleSound() {
    setSoundEnabled((previous) => {
      window.localStorage.setItem('orbit-completion-sound', previous ? 'off' : 'on');
      return !previous;
    });
  }

  function toggleVoice() {
    if (recognizer.current) {
      recognizer.current.stop();
      recognizer.current = null;
      setListening(false);
      return;
    }
    const Constructor = getSpeechConstructor();
    if (!Constructor) {
      setError('Este navegador no ofrece dictado desde la app. Usa el micrófono del teclado de tu celular.');
      return;
    }
    const speech = new Constructor();
    speech.lang = 'es-CO';
    speech.interimResults = false;
    speech.continuous = false;
    speech.onresult = (result) => {
      const transcript = result.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) setQuickTitle((previous) => [previous.trim(), transcript].filter(Boolean).join(' ').slice(0, TITLE_MAX));
      setError('');
    };
    speech.onerror = (result) => {
      setListening(false);
      recognizer.current = null;
      if (result.error !== 'aborted') setError('No se pudo reconocer la voz. Revisa el permiso de micrófono o usa el dictado del teclado.');
    };
    speech.onend = () => { setListening(false); recognizer.current = null; };
    recognizer.current = speech;
    try { speech.start(); setListening(true); setError(''); }
    catch { recognizer.current = null; setListening(false); setError('El dictado no se pudo iniciar en este navegador.'); }
  }

  const load = useCallback(async () => {
    const [notesResponse, categoriesResponse] = await Promise.all([
      supabase.from('notes').select('*').eq('owner_id', userId).order('created_at', { ascending: false }),
      supabase.from('note_categories').select('*').eq('owner_id', userId).order('name'),
    ]);
    if (notesResponse.error) throw notesResponse.error;
    if (categoriesResponse.error) throw categoriesResponse.error;
    setNotes((notesResponse.data || []) as Note[]);
    setCategories((categoriesResponse.data || []) as Category[]);
  }, [userId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  // Scheduled occurrences are created by Supabase, even if this PWA stays open.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void load().catch(() => { /* Keep the last usable list if temporarily offline. */ });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const intervalId = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(intervalId);
    };
  }, [load]);

  const filtered = useMemo(() => notes.filter(note => {
    if (section === 'pending') return statusTab === 'active' ? !note.completed : note.completed;
    return section === 'search' && note.title.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'));
  }), [notes, section, statusTab, search]);
  const seriesKey = (note: Note) => note.recurrence_series_id ?? note.id;
  const recurringSeries = useMemo(() => new Set(notes.filter(note =>
    note.recurrence_rule || note.recurrence_series_id
  ).map(note => note.recurrence_series_id ?? note.id)), [notes]);
  const historyRows = useMemo(() => historySeriesId
    ? notes.filter(note => seriesKey(note) === historySeriesId)
      .sort((a, b) => (b.reminder_at ?? '').localeCompare(a.reminder_at ?? ''))
    : [], [historySeriesId, notes]);
  const historyCompleted = historyRows.filter(note => note.completed).length;
  const historyOverdue = historyRows.filter(note => !note.completed &&
    note.reminder_at && new Date(note.reminder_at).getTime() < Date.now()).length;
  const historyUpcoming = historyRows.length - historyCompleted - historyOverdue;
  const completedCount = notes.filter((note) => note.completed).length;
  const activeCount = notes.length - completedCount;

  const openEditor = (note?: Note) => {
    setError('');
    setMessage('');
    setEditId(note?.id ?? null);
    setTitle(note?.title ?? '');
    setCategoryId(note?.category_id ?? '');
    setReminder({ at: note?.reminder_at ?? null, rule: note?.recurrence_rule ?? null });
    setEditorOpen(true);
  };
  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await load(); setMessage(success); return true; }
    catch (cause) { setError(errorText(cause)); return false; }
    finally { setBusy(false); }
  }
  async function quickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = quickTitle.trim();
    if (cleaned.length < 2 || cleaned.length > TITLE_MAX) { setError('El título debe tener entre 2 y 80 caracteres.'); return; }
    const reminderError = validateReminder(quickReminder);
    if (reminderError) { setError(reminderError); return; }
    if (await perform(async () => {
      const { error: insertError } = await supabase.from('notes').insert({
        owner_id: userId, kind: 'pending', title: cleaned,
        category_id: quickCategory || null, reminder_at: quickReminder.at,
        recurrence_rule: quickReminder.rule,
      });
      if (insertError) throw insertError;
    }, 'Pendiente creado.')) {
      setQuickTitle(''); setQuickReminder(NO_REMINDER); setStatusTab('active');
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = title.trim();
    if (cleaned.length < 2 || cleaned.length > TITLE_MAX) {
      setError('El título debe tener entre 2 y 80 caracteres.'); return;
    }
    const reminderError = validateReminder(reminder);
    if (reminderError) { setError(reminderError); return; }
    const previousNote = editId ? notes.find(note => note.id === editId) : undefined;
    const scheduleChanged = previousNote && (
      previousNote.reminder_at !== reminder.at ||
      JSON.stringify(previousNote.recurrence_rule) !== JSON.stringify(reminder.rule)
    );
    if (previousNote?.recurrence_next_created && scheduleChanged) {
      setError('Esta ocurrencia ya generó la siguiente. Edita la ocurrencia más reciente para cambiar el horario de repetición.');
      return;
    }
    const payload = {
      kind: previousNote?.kind ?? 'pending', title: cleaned,
      category_id: categoryId || null, reminder_at: reminder.at, recurrence_rule: reminder.rule,
      ...(scheduleChanged ? { recurrence_next_created: false } : {}),
    };
    const done = await perform(async () => {
      const result = editId
        ? await supabase.from('notes').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId).eq('owner_id', userId)
        : await supabase.from('notes').insert({ ...payload, owner_id: userId });
      if (result.error) throw result.error;
    }, editId ? 'Registro actualizado.' : 'Registro creado.');
    if (done) setEditorOpen(false);
  }
  async function toggle(note: Note) {
    if (note.kind !== 'pending') return;
    const completed = !note.completed;
    // Unlock audio on the user gesture: iOS Safari may block sound after async work.
    const sound = soundEnabled && completed;
    if (sound) completionTone();
    await perform(async () => {
      const { error: updateError } = await supabase.from('notes').update({
        completed, completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('id', note.id).eq('owner_id', userId);
      if (updateError) throw updateError;
    }, completed ? 'Pendiente completado.' : 'Pendiente reactivado.');
  }
  async function stopSeries() {
    const upcoming = historyRows.find(note => note.recurrence_rule && !note.recurrence_next_created);
    if (!upcoming || !window.confirm('¿Detener las próximas repeticiones? Conservaremos las ocurrencias y el historial existentes.')) return;
    const done = await perform(async () => {
      const { data, error: updateError } = await supabase.from('notes')
        .update({ recurrence_rule: null, updated_at: new Date().toISOString() })
        .eq('id', upcoming.id).eq('owner_id', userId)
        .eq('recurrence_next_created', false).not('recurrence_rule', 'is', null)
        .select('id');
      if (updateError) throw updateError;
      if (!data?.length) throw new Error('La repetición ya fue procesada. Actualiza la lista e inténtalo de nuevo.');
    }, 'Repetición detenida. Se conserva el historial.');
    if (done) setHistorySeriesId(null);
  }
  async function remove(note: Note) {
    const isLastScheduled = Boolean(note.recurrence_rule && !note.recurrence_next_created);
    const warning = isLastScheduled ? ' Al eliminar esta ocurrencia se detendrán las próximas repeticiones.' : '';
    if (!window.confirm(`¿Eliminar "${note.title}"?${warning}`)) return;
    await perform(async () => {
      const { error: deleteError } = await supabase.from('notes').delete().eq('id', note.id).eq('owner_id', userId);
      if (deleteError) throw deleteError;
    }, 'Registro eliminado.');
  }
  function editCategory(category: Category) {
    setEditingCategoryId(category.id);
    setNewCategory(category.name);
    setCategoryColor(category.color);
    setError('');
  }
  function resetCategory() {
    setEditingCategoryId(null);
    setNewCategory('');
    setCategoryColor('#7658D8');
  }
  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = newCategory.trim();
    if (!cleaned || cleaned.length > 35) { setError('El nombre admite de 1 a 35 caracteres.'); return; }
    if (categories.some(category => category.id !== editingCategoryId &&
      category.name.trim().toLocaleLowerCase('es') === cleaned.toLocaleLowerCase('es'))) {
      setError('Ya existe una categoría con ese nombre.'); return;
    }
    const done = await perform(async () => {
      const { error: categoryError } = editingCategoryId
        ? await supabase.from('note_categories').update({ name: cleaned, color: categoryColor })
            .eq('id', editingCategoryId).eq('owner_id', userId)
        : await supabase.from('note_categories').insert({ owner_id: userId, name: cleaned, color: categoryColor });
      if (categoryError) throw categoryError;
    }, editingCategoryId ? 'Categoría actualizada.' : 'Categoría creada.');
    if (done) resetCategory();
  }
  async function removeCategory(category: Category) {
    const count = notes.filter(note => note.category_id === category.id).length;
    if (!window.confirm(`¿Eliminar "${category.name}"? ${count} registro(s) quedarán sin categoría.`)) return;
    const done = await perform(async () => {
      const { error: deleteError } = await supabase.from('note_categories').delete().eq('id', category.id).eq('owner_id', userId);
      if (deleteError) throw deleteError;
    }, 'Categoría eliminada.');
    if (done) {
      if (categoryId === category.id) setCategoryId('');
      if (quickCategory === category.id) setQuickCategory('');
      if (editingCategoryId === category.id) resetCategory();
    }
  }
  const categoryName = (id: string | null) => categories.find(category => category.id === id);

  return <section className="notes-board">
    <div className="heading notes-heading"><div><h1>Pendientes</h1><p>Captura rápidamente tus actividades personales.</p></div>
    </div>
    <nav className="notes-section-tabs" aria-label="Secciones de pendientes">
      <button type="button" className={section === 'pending' ? 'selected' : ''} aria-current={section === 'pending' ? 'page' : undefined} onClick={() => setSection('pending')}><ListTodo size={17}/> Pendientes</button>
      <button type="button" className={section === 'search' ? 'selected' : ''} aria-current={section === 'search' ? 'page' : undefined} onClick={() => setSection('search')}><Search size={17}/> Buscar</button>
      <button type="button" className={section === 'categories' ? 'selected' : ''} aria-current={section === 'categories' ? 'page' : undefined} onClick={() => setSection('categories')}><FolderPlus size={17}/> Categorías</button>
    </nav>
    {section === 'pending' && <>
    <p className="quick-capture-label">Registra aquí tu pendiente o tarea</p>
    <form className="card quick-capture" onSubmit={(event) => void quickAdd(event)}>
      <div className="quick-capture-main">
        <ListTodo size={20} aria-hidden="true"/>
        <input aria-label="Título del pendiente rápido" placeholder="¿Qué necesitas recordar?" minLength={2} maxLength={TITLE_MAX}
          value={quickTitle} onChange={event => setQuickTitle(event.target.value.slice(0, TITLE_MAX))} spellCheck lang="es" required/>
        <button type="button" className={listening ? 'quick-voice is-listening' : 'quick-voice'}
          aria-label={listening ? 'Detener dictado' : 'Dictar pendiente por voz'}
          aria-pressed={listening} onClick={toggleVoice} title={speechAvailable ? 'Dictar en español' : 'Usa el micrófono del teclado'}>
          {listening ? <MicOff size={19}/> : <Mic size={19}/>}
        </button>
        <button type="submit" className="quick-create" disabled={busy || quickTitle.trim().length < 2}
          aria-label="Agregar pendiente rápido"><Plus size={19}/></button>
      </div>
      {listening && <p className="quick-listening" role="status">Escuchando… di tu pendiente en voz alta.</p>}
      {!speechAvailable && <small className="quick-voice-hint">Para dictar, utiliza el micrófono de tu teclado.</small>}
      <div className="quick-capture-bottom">
        <button type="button" className="quick-options-toggle" aria-expanded={quickOptionsOpen}
          onClick={() => setQuickOptionsOpen(!quickOptionsOpen)}>
          <SlidersHorizontal size={16}/> {quickOptionsOpen ? 'Ocultar detalles' : 'Categoría y recordatorio'}
        </button>
        <span className="quick-preview">
          {quickCategory && categories.find(category => category.id === quickCategory)?.name}
          {quickReminder.at && <><CalendarClock size={13}/> {reminderSummary(quickReminder)}</>}
        </span>
      </div>
      {quickOptionsOpen && <div className="quick-capture-options">
        <label><Tag size={15} aria-hidden="true"/> Categoría
          <select value={quickCategory} onChange={event => setQuickCategory(event.target.value)}>
            <option value="">Sin categoría</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <div className="quick-reminder-field">
          <span><CalendarClock size={15} aria-hidden="true"/> Recordatorio</span>
          <button type="button" className="outline" onClick={() => setReminderTarget('quick')}>
            {reminderSummary(quickReminder)}
          </button>
        </div>
        <button className="outline quick-category-link" type="button" onClick={() => { setError(''); setSection('categories'); }}>
          <FolderPlus size={15}/> Crear categoría
        </button>
      </div>}
    </form>
    <div className="notes-status-row">
      <div className="notes-status-tabs" role="tablist" aria-label="Estado de pendientes">
        <button type="button" role="tab" aria-selected={statusTab === 'active'} className={statusTab === 'active' ? 'selected' : ''}
          onClick={() => setStatusTab('active')}><Circle size={15}/> Activos <span>{activeCount}</span></button>
        <button type="button" role="tab" aria-selected={statusTab === 'completed'} className={statusTab === 'completed' ? 'selected' : ''}
          onClick={() => setStatusTab('completed')}><CheckSquare size={15}/> Completados <span>{completedCount}</span></button>
      </div>
      <button type="button" className="note-sound-toggle" aria-label={soundEnabled ? 'Silenciar sonido al completar' : 'Activar sonido al completar'}
        aria-pressed={soundEnabled} onClick={toggleSound}>
        {soundEnabled ? <Volume2 size={17}/> : <VolumeX size={17}/>}
        <span>{soundEnabled ? 'Sonido activado' : 'Sin sonido'}</span>
      </button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {loading && <p className="muted">Cargando tus pendientes…</p>}
    {!loading && <div className="notes-list">
      {filtered.map(note => <article className="card note-list-item" key={note.id}>
        <div className="note-check">
          {note.kind === 'pending'
            ? <input type="checkbox" aria-label={`Marcar como ${note.completed ? 'pendiente' : 'completado'}: ${note.title}`}
                checked={note.completed} disabled={busy} onChange={() => void toggle(note)}/>
            : <NotebookPen size={21} aria-label="Nota" />}
        </div>
        <button type="button" className="note-summary" onClick={() => openEditor(note)}>
          <strong className={note.completed ? 'note-done' : ''}>{note.title}</strong>
          {recurringSeries.has(seriesKey(note)) && <span className="notes-recurrence-indicator">
            <CalendarClock size={13} aria-hidden="true"/> Recurrente · {note.reminder_at ? reminderLabel(note.reminder_at) : 'Sin fecha'}
          </span>}
          {note.description && <span>{note.description}</span>}
          <small>
            <CalendarClock size={13} aria-hidden="true"/> Creado: {reminderLabel(note.created_at)}
            {note.category_id && <><span className="note-category-dot" style={{background: categoryName(note.category_id)?.color ?? '#7658D8'}}/>{categoryName(note.category_id)?.name ?? 'Sin categoría'} · </>}
            {note.reminder_at && <><CalendarClock size={13} aria-hidden="true"/>{reminderLabel(note.reminder_at)}</>}
            {note.completed && <><CheckCircle2 size={13} aria-hidden="true"/> Completado</>}
          </small>
        </button>
        <div className="note-actions">
          {recurringSeries.has(seriesKey(note)) && <button type="button" className="note-history-button"
            aria-label={`Ver historial de ${note.title}`} title="Historial de repeticiones"
            onClick={() => setHistorySeriesId(seriesKey(note))}><CalendarClock size={17}/></button>}
          <button type="button" aria-label={`Editar ${note.title}`} title="Editar" onClick={() => openEditor(note)}><Pencil size={17}/></button>
          <button type="button" aria-label={`Eliminar ${note.title}`} title="Eliminar" onClick={() => void remove(note)} disabled={busy}><Trash2 size={17}/></button>
        </div>
      </article>)}
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/>
        <h2>{statusTab === 'active' ? 'Sin pendientes activos' : 'Aún no hay completados'}</h2>
        <p>No hay registros en esta sección.</p>
      </div>}
    </div>}
    </>}
    {section === 'search' && <div className="notes-search-pane">
      <h2>Buscar</h2>
      <label className="notes-search"><Search size={19}/><input aria-label="Buscar pendientes por título" placeholder="Buscar pendientes por título..." value={search} onChange={event => setSearch(event.target.value)}/></label>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {loading && <p className="muted">Cargando tus pendientes…</p>}
    {!loading && <div className="notes-list">
      {filtered.map(note => <article className="card note-list-item" key={note.id}>
        <div className="note-check">
          {note.kind === 'pending'
            ? <input type="checkbox" aria-label={`Marcar como ${note.completed ? 'pendiente' : 'completado'}: ${note.title}`}
                checked={note.completed} disabled={busy} onChange={() => void toggle(note)}/>
            : <NotebookPen size={21} aria-label="Nota" />}
        </div>
        <button type="button" className="note-summary" onClick={() => openEditor(note)}>
          <strong className={note.completed ? 'note-done' : ''}>{note.title}</strong>
          {recurringSeries.has(seriesKey(note)) && <span className="notes-recurrence-indicator">
            <CalendarClock size={13} aria-hidden="true"/> Recurrente · {note.reminder_at ? reminderLabel(note.reminder_at) : 'Sin fecha'}
          </span>}
          {note.description && <span>{note.description}</span>}
          <small>
            <CalendarClock size={13} aria-hidden="true"/> Creado: {reminderLabel(note.created_at)}
            {note.category_id && <><span className="note-category-dot" style={{background: categoryName(note.category_id)?.color ?? '#7658D8'}}/>{categoryName(note.category_id)?.name ?? 'Sin categoría'} · </>}
            {note.reminder_at && <><CalendarClock size={13} aria-hidden="true"/>{reminderLabel(note.reminder_at)}</>}
            {note.completed && <><CheckCircle2 size={13} aria-hidden="true"/> Completado</>}
          </small>
        </button>
        <div className="note-actions">
          {recurringSeries.has(seriesKey(note)) && <button type="button" className="note-history-button"
            aria-label={`Ver historial de ${note.title}`} title="Historial de repeticiones"
            onClick={() => setHistorySeriesId(seriesKey(note))}><CalendarClock size={17}/></button>}
          <button type="button" aria-label={`Editar ${note.title}`} title="Editar" onClick={() => openEditor(note)}><Pencil size={17}/></button>
          <button type="button" aria-label={`Eliminar ${note.title}`} title="Eliminar" onClick={() => void remove(note)} disabled={busy}><Trash2 size={17}/></button>
        </div>
      </article>)}
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/>
        <h2>{section === 'search' ? 'Sin resultados' : statusTab === 'active' ? 'Sin pendientes activos' : 'Aún no hay completados'}</h2>
        <p>{section === 'search' ? 'No hay pendientes con ese título.' : 'No hay registros en esta sección.'}</p>
      </div>}
    </div>}
    </div>}
    {section === 'categories' && <div className="notes-categories-pane">
      <h2>Categorías</h2>
      <form className="note-category-form" onSubmit={event => void saveCategory(event)}>
        <label>Nombre<input required maxLength={35} value={newCategory} placeholder="Ej.: Droguería" onChange={event => setNewCategory(event.target.value)}/></label>
        <label>Color<input type="color" aria-label="Color de categoría" value={categoryColor} onChange={event => setCategoryColor(event.target.value)}/></label>
        <button type="submit" disabled={busy || !newCategory.trim()}>{editingCategoryId ? <Check size={17}/> : <Plus size={17}/>}{editingCategoryId ? 'Guardar' : 'Agregar'}</button>
        {editingCategoryId && <button type="button" className="outline" onClick={resetCategory}>Cancelar</button>}
      </form>
          {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="feedback" role="status">{message}</p>}

      {categories.map(category => <div className="note-category-manager" key={category.id}>
        <span className="note-category-dot" style={{background:category.color}}/>
        <span className="notes-category-label">{category.name}<small>{notes.filter(note => note.category_id === category.id).length} registros</small></span>
        <button type="button" className="outline" disabled={busy} aria-label={`Editar categoría ${category.name}`} onClick={() => editCategory(category)}><Pencil size={16}/></button>
        <button type="button" className="outline" disabled={busy} aria-label={`Eliminar categoría ${category.name}`} onClick={() => void removeCategory(category)}><Trash2 size={16}/></button>
      </div>)}
      {!categories.length && <p className="muted">Aún no hay categorías.</p>}
    </div>}
    {historySeriesId && <div className="modal-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) setHistorySeriesId(null); }}>
      <section className="modal orbit-detail-modal note-modal notes-history-modal" role="dialog"
        aria-modal="true" aria-labelledby="notes-history-title">
        <header className="orbit-modal-header">
          <span className="orbit-modal-icon"><CalendarClock size={22}/></span>
          <div className="orbit-modal-heading"><small>Seguimiento de repeticiones</small>
            <h2 id="notes-history-title">Historial del pendiente</h2></div>
          <button type="button" className="outline orbit-modal-close" aria-label="Cerrar historial"
            onClick={() => setHistorySeriesId(null)}><X size={19}/></button>
        </header>
        <p className="notes-history-name">{historyRows[0]?.title ?? 'Pendiente recurrente'}</p>
        <div className="notes-history-stats" aria-label="Resumen de ocurrencias">
          <span><strong>{historyCompleted}</strong> Completados</span>
          <span><strong>{historyOverdue}</strong> Pendientes vencidos</span>
          <span><strong>{historyUpcoming}</strong> Próximos</span>
        </div>
        <p className="field-help">Cada fecha es independiente. Los vencidos no se marcan automáticamente como completados.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {historyRows.some(note => note.recurrence_rule && !note.recurrence_next_created) &&
          <button type="button" className="outline notes-stop-recurrence" disabled={busy}
            onClick={() => void stopSeries()}><X size={16}/> Detener repeticiones futuras</button>}
        <div className="notes-history-list">
          {historyRows.map(note => <div className="notes-history-item" key={note.id}>
            {note.completed ? <CheckCircle2 size={18} aria-hidden="true" className="notes-history-success"/> :
              <Circle size={18} aria-hidden="true"/>}
            <div><strong>{note.reminder_at ? reminderLabel(note.reminder_at) : 'Sin fecha programada'}</strong>
              <small>{note.completed
                ? `Completado: ${reminderLabel(note.completed_at)}`
                : note.reminder_at && new Date(note.reminder_at).getTime() < Date.now()
                  ? 'Pendiente vencido' : 'Próxima ocurrencia'}</small></div>
          </div>)}
        </div>
      </section>
    </div>}
    {editorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => {if(event.target === event.currentTarget) setEditorOpen(false);}}>
      <section className="modal orbit-detail-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
        <header className="orbit-modal-header"><span className="orbit-modal-icon"><NotebookPen size={23}/></span>
          <div className="orbit-modal-heading"><small>Pendientes personales</small><h2 id="note-editor-title">{editId ? 'Editar pendiente' : 'Nuevo pendiente'}</h2></div>
          <button type="button" className="outline orbit-modal-close" aria-label="Cerrar" onClick={() => setEditorOpen(false)}><X size={19}/></button>
        </header>
        {error && <p role="alert" className="field-error">{error}</p>}
        {editId && <p className="note-created-at">Fecha de creación: {reminderLabel(notes.find(note => note.id === editId)?.created_at ?? null)}</p>}
        <form className="orbit-validated-form" onSubmit={(event) => void save(event)}>
          <label><span className="form-label-icon"><ListTodo size={16}/>Título *</span>
            <input required minLength={2} maxLength={TITLE_MAX} placeholder="Ej.: Llamar a mamá" value={title} spellCheck lang="es"
              onChange={event => setTitle(event.target.value.slice(0, TITLE_MAX))}/>
            <span className="field-counter">{title.length}/{TITLE_MAX} caracteres</span></label>
          <label><span className="form-label-icon"><Tag size={16}/>Categoría opcional</span>
            <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
              <option value="">Sin categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
          <div className="reminder-editor-field">
            <span className="form-label-icon"><Bell size={16}/>Recordatorio opcional</span>
            <button type="button" className="outline"
              disabled={Boolean(editId && notes.find(note => note.id === editId)?.recurrence_next_created)}
              onClick={() => setReminderTarget('editor')}>
              <CalendarClock size={17}/>{reminderSummary(reminder)}
            </button>
            {editId && notes.find(note => note.id === editId)?.recurrence_next_created &&
              <small className="field-help">Esta fecha ya generó otra ocurrencia. Modifica la más reciente para cambiar la repetición.</small>}
            <small className="field-help">Para recibir avisos con la app cerrada, activa las notificaciones desde Mi cuenta → Avisos.</small>
          </div>
          <button type="submit" disabled={busy}><Check size={17}/>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Guardar registro'}</button>
        </form>
      </section>
    </div>}
    {reminderTarget && <ReminderModal variant="notes" schedule={reminderTarget === 'quick' ? quickReminder : reminder}
      onClose={() => setReminderTarget(null)} onSave={value => {
        if (reminderTarget === 'quick') setQuickReminder(value); else setReminder(value);
        setReminderTarget(null);
      }}/>}
  </section>;
}
