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
  const [categoryFilter, setCategoryFilter] = useState('all');
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
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categoryColor, setCategoryColor] = useState('#7658D8');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reminder, setReminder] = useState<ReminderSchedule>(NO_REMINDER);
  const [quickTitle, setQuickTitle] = useState('');

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

  const filtered = useMemo(() => notes.filter((note) => {
    if (statusTab === 'active' && note.completed) return false;
    if (statusTab === 'completed' && !note.completed) return false;
    if (categoryFilter !== 'all' && (categoryFilter === 'none'
      ? note.category_id !== null : note.category_id !== categoryFilter)) return false;
    return [note.title, note.description].join(' ').toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es').trim());
  }), [notes, search, categoryFilter, statusTab]);
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
    const payload = {
      kind: editId ? (notes.find(note => note.id === editId)?.kind ?? 'pending') : 'pending', title: cleaned,
      category_id: categoryId || null, reminder_at: reminder.at, recurrence_rule: reminder.rule,
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
  async function remove(note: Note) {
    if (!window.confirm(`¿Eliminar "${note.title}"?`)) return;
    await perform(async () => {
      const { error: deleteError } = await supabase.from('notes').delete().eq('id', note.id).eq('owner_id', userId);
      if (deleteError) throw deleteError;
    }, 'Registro eliminado.');
  }
  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = newCategory.trim();
    if (!cleaned || cleaned.length > 35) { setError('El nombre de la categoría admite de 1 a 35 caracteres.'); return; }
    if (await perform(async () => {
      const { error: insertError } = await supabase.from('note_categories')
        .insert({ owner_id: userId, name: cleaned, color: categoryColor });
      if (insertError) throw insertError;
    }, 'Categoría creada.')) setNewCategory('');
  }
  async function removeCategory(category: Category) {
    if (!window.confirm(`¿Eliminar la categoría "${category.name}"? Las notas quedarán sin categoría.`)) return;
    if (await perform(async () => {
      const { error: deleteError } = await supabase.from('note_categories').delete().eq('id', category.id).eq('owner_id', userId);
      if (deleteError) throw deleteError;
    }, 'Categoría eliminada.')) {
      if (categoryFilter === category.id) setCategoryFilter('all');
      if (categoryId === category.id) setCategoryId('');
    }
  }
  const categoryName = (id: string | null) => categories.find(category => category.id === id);

  return <section className="notes-board">
    <div className="heading notes-heading">
      <div><h1>Pendientes</h1><p>Notas rápidas, actividades personales y recordatorios, sin crear un proyecto.</p></div>
      <button type="button" onClick={() => openEditor()}><Plus size={17} aria-hidden="true"/> Nuevo pendiente</button>
    </div>
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
        <button className="outline quick-category-link" type="button" onClick={() => { setError(''); setCategoriesOpen(true); }}>
          <FolderPlus size={15}/> Crear categoría
        </button>
      </div>}
    </form>
    <div className="notes-toolbar">
      <label className="notes-search"><Search size={17} aria-hidden="true"/><input aria-label="Buscar notas y pendientes"
        value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pendientes o notas..."/></label>
      <button type="button" className="outline" onClick={() => setCategoriesOpen(true)}><FolderPlus size={16}/> Categorías</button>
    </div>
    <div className="notes-filters" aria-label="Filtrar por categoría">
      <button type="button" className={categoryFilter === 'all' ? 'active' : ''} onClick={() => setCategoryFilter('all')}>Todas</button>
      <button type="button" className={categoryFilter === 'none' ? 'active' : ''} onClick={() => setCategoryFilter('none')}>Sin categoría</button>
      {categories.map(category => <button key={category.id} type="button" className={categoryFilter === category.id ? 'active' : ''}
        onClick={() => setCategoryFilter(category.id)}><span className="note-category-dot" style={{background:category.color}}/>{category.name}</button>)}
    </div>
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
          {note.description && <span>{note.description}</span>}
          <small>
            <CalendarClock size={13} aria-hidden="true"/> Creado: {reminderLabel(note.created_at)}
            {note.category_id && <><span className="note-category-dot" style={{background: categoryName(note.category_id)?.color ?? '#7658D8'}}/>{categoryName(note.category_id)?.name ?? 'Sin categoría'} · </>}
            {note.reminder_at && <><CalendarClock size={13} aria-hidden="true"/>{reminderLabel(note.reminder_at)}</>}
            {note.completed && <><CheckCircle2 size={13} aria-hidden="true"/> Completado</>}
          </small>
        </button>
        <div className="note-actions">
          <button type="button" aria-label={`Editar ${note.title}`} title="Editar" onClick={() => openEditor(note)}><Pencil size={17}/></button>
          <button type="button" aria-label={`Eliminar ${note.title}`} title="Eliminar" onClick={() => void remove(note)} disabled={busy}><Trash2 size={17}/></button>
        </div>
      </article>)}
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/><h2>{statusTab === 'active' ? 'Sin pendientes activos' : 'Aún no hay completados'}</h2><p>{statusTab === 'active' ? 'No hay pendientes activos con estos filtros. Crea uno nuevo para comenzar.' : 'Aquí verás los pendientes que hayas marcado como completados.'}</p></div>}
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
            <button type="button" className="outline" onClick={() => setReminderTarget('editor')}>
              <CalendarClock size={17}/>{reminderSummary(reminder)}
            </button>
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
    {categoriesOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => {if(event.target === event.currentTarget) setCategoriesOpen(false);}}>
      <section className="modal orbit-detail-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="categories-title">
        <header className="orbit-modal-header"><span className="orbit-modal-icon"><FolderPlus size={22}/></span>
          <div className="orbit-modal-heading"><small>Organización personal</small><h2 id="categories-title">Mis categorías</h2></div>
          <button type="button" className="outline orbit-modal-close" aria-label="Cerrar" onClick={() => setCategoriesOpen(false)}><X size={19}/></button>
        </header>
        {error && <p role="alert" className="field-error">{error}</p>}
        <form className="note-category-form" onSubmit={(event) => void addCategory(event)}>
          <label>Nombre<input required maxLength={35} placeholder="Ej.: Familia" value={newCategory} onChange={event => setNewCategory(event.target.value)}/></label>
          <label>Color<input type="color" aria-label="Color de categoría" value={categoryColor} onChange={event => setCategoryColor(event.target.value)}/></label>
          <button type="submit" disabled={busy || !newCategory.trim()}><Plus size={17}/>Agregar</button>
        </form>
        {categories.map(category => <div key={category.id} className="note-category-manager">
          <span className="note-category-dot" style={{background: category.color}}/>{category.name}
          <button type="button" className="outline" aria-label={`Eliminar categoría ${category.name}`} onClick={() => void removeCategory(category)}><Trash2 size={15}/></button>
        </div>)}
        {!categories.length && <p className="muted">Todavía no has creado categorías. Son completamente opcionales.</p>}
      </section>
    </div>}
  </section>;
}
