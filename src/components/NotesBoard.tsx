import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlignLeft, Bell, CalendarClock, Check, CheckCircle2, ChevronDown, FolderPlus, ListTodo, NotebookPen, Pencil, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { supabase } from '../infrastructure/supabaseClient';
import { CharacterCounter } from './CharacterCounter';

type NoteKind = 'note' | 'pending';
type Note = {
  id: string; owner_id: string; category_id: string | null; kind: NoteKind;
  title: string; description: string; reminder_at: string | null; completed: boolean;
  completed_at: string | null; created_at: string; updated_at: string;
};
type Category = { id: string; name: string; color: string; owner_id: string };
const TITLE_MAX = 80, DESCRIPTION_MAX = 300;

function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
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
  const [showCompleted, setShowCompleted] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [categoryColor, setCategoryColor] = useState('#7658D8');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<NoteKind>('pending');
  const [categoryId, setCategoryId] = useState('');
  const [reminder, setReminder] = useState('');
  const [quickTitle, setQuickTitle] = useState('');

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
    if (!showCompleted && note.completed) return false;
    if (categoryFilter !== 'all' && (categoryFilter === 'none'
      ? note.category_id !== null : note.category_id !== categoryFilter)) return false;
    return [note.title, note.description].join(' ').toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es').trim());
  }), [notes, search, categoryFilter, showCompleted]);

  const openEditor = (note?: Note) => {
    setError('');
    setMessage('');
    setEditId(note?.id ?? null);
    setTitle(note?.title ?? '');
    setDescription(note?.description ?? '');
    setKind(note?.kind ?? 'pending');
    setCategoryId(note?.category_id ?? '');
    setReminder(localDateTime(note?.reminder_at ?? null));
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
    if (await perform(async () => {
      const { error: insertError } = await supabase.from('notes').insert({ owner_id: userId, kind: 'pending', title: cleaned });
      if (insertError) throw insertError;
    }, 'Pendiente creado.')) setQuickTitle('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = title.trim();
    if (cleaned.length < 2 || cleaned.length > TITLE_MAX || description.length > DESCRIPTION_MAX) {
      setError('Verifica los límites del título (80) y la descripción (300).'); return;
    }
    const date = reminder ? new Date(reminder) : null;
    if (date && !Number.isFinite(date.getTime())) { setError('Selecciona una fecha válida.'); return; }
    const payload = {
      kind, title: cleaned, description: description.trim(),
      category_id: categoryId || null, reminder_at: date?.toISOString() ?? null,
    };
    const done = await perform(async () => {
      const result = editId
        ? await supabase.from('notes').update({ ...payload, completed: kind === 'note' ? false : notes.find(note => note.id === editId)?.completed ?? false,
            completed_at: kind === 'note' ? null : notes.find(note => note.id === editId)?.completed_at ?? null,
            updated_at: new Date().toISOString() }).eq('id', editId).eq('owner_id', userId)
        : await supabase.from('notes').insert({ ...payload, owner_id: userId });
      if (result.error) throw result.error;
    }, editId ? 'Registro actualizado.' : 'Registro creado.');
    if (done) setEditorOpen(false);
  }
  async function toggle(note: Note) {
    if (note.kind !== 'pending') return;
    await perform(async () => {
      const completed = !note.completed;
      const { error: updateError } = await supabase.from('notes').update({
        completed, completed_at: completed ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
      }).eq('id', note.id).eq('owner_id', userId);
      if (updateError) throw updateError;
    }, note.completed ? 'Pendiente reactivado.' : 'Pendiente completado.');
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
    <form className="card quick-note-form" onSubmit={(event) => void quickAdd(event)}>
      <ListTodo size={20} aria-hidden="true"/>
      <input aria-label="Título del pendiente rápido" placeholder="¿Qué necesitas recordar?" minLength={2} maxLength={TITLE_MAX}
        value={quickTitle} onChange={event => setQuickTitle(event.target.value.slice(0, TITLE_MAX))} spellCheck lang="es" required/>
      <button type="submit" disabled={busy || quickTitle.trim().length < 2} aria-label="Agregar pendiente rápido"><Plus size={19}/></button>
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
    <label className="notes-show-completed"><input type="checkbox" checked={showCompleted} onChange={event => setShowCompleted(event.target.checked)}/> Mostrar completados</label>
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
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/><h2>Todo está al día</h2><p>No hay registros con los filtros actuales. Puedes crear uno sin asignarlo a ningún proyecto.</p></div>}
    </div>}
    {editorOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => {if(event.target === event.currentTarget) setEditorOpen(false);}}>
      <section className="modal orbit-detail-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="note-editor-title">
        <header className="orbit-modal-header"><span className="orbit-modal-icon"><NotebookPen size={23}/></span>
          <div className="orbit-modal-heading"><small>Pendientes personales</small><h2 id="note-editor-title">{editId ? 'Editar registro' : 'Nuevo registro'}</h2></div>
          <button type="button" className="outline orbit-modal-close" aria-label="Cerrar" onClick={() => setEditorOpen(false)}><X size={19}/></button>
        </header>
        <form className="orbit-validated-form" onSubmit={(event) => void save(event)}>
          <label>Tipo
            <select value={kind} onChange={event => setKind(event.target.value as NoteKind)}>
              <option value="pending">Pendiente — marcar al completar</option><option value="note">Nota — conservar información</option>
            </select></label>
          <label><span className="form-label-icon"><ListTodo size={16}/>Título *</span>
            <input required minLength={2} maxLength={TITLE_MAX} placeholder="Ej.: Llamar a mamá" value={title} spellCheck lang="es"
              onChange={event => setTitle(event.target.value.slice(0, TITLE_MAX))}/>
            <span className="field-counter">{title.length}/{TITLE_MAX} caracteres</span></label>
          <label><span className="form-label-icon"><AlignLeft size={16}/>Descripción opcional</span>
            <textarea rows={3} maxLength={DESCRIPTION_MAX} placeholder="Información adicional..." value={description} spellCheck lang="es"
              onChange={event => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}/>
            <span className="field-counter">{description.length}/{DESCRIPTION_MAX} caracteres</span></label>
          <label><span className="form-label-icon"><Tag size={16}/>Categoría opcional</span>
            <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
              <option value="">Sin categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
          <label><span className="form-label-icon"><Bell size={16}/>Recordatorio opcional</span>
            <input type="datetime-local" value={reminder} onChange={event => setReminder(event.target.value)}/>
            <small className="field-help">Para recibir avisos con la app cerrada, activa las notificaciones desde Mi cuenta → Avisos.</small></label>
          <button type="submit" disabled={busy}><Check size={17}/>{busy ? 'Guardando…' : editId ? 'Guardar cambios' : 'Guardar registro'}</button>
        </form>
      </section>
    </div>}
    {categoriesOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => {if(event.target === event.currentTarget) setCategoriesOpen(false);}}>
      <section className="modal orbit-detail-modal note-modal" role="dialog" aria-modal="true" aria-labelledby="categories-title">
        <header className="orbit-modal-header"><span className="orbit-modal-icon"><FolderPlus size={22}/></span>
          <div className="orbit-modal-heading"><small>Organización personal</small><h2 id="categories-title">Mis categorías</h2></div>
          <button type="button" className="outline orbit-modal-close" aria-label="Cerrar" onClick={() => setCategoriesOpen(false)}><X size={19}/></button>
        </header>
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
