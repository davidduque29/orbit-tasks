import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Bell, CalendarClock, Check, CheckCircle2, ListTodo, NotebookPen, Pencil, Plus, Search, Tag, Trash2, X, Mic, MicOff, Volume2, VolumeX, CheckSquare, Circle, ChevronDown, ChevronUp, Pin } from 'lucide-react';
import { supabase } from '../infrastructure/supabaseClient';
import { parsePendingItems } from '../domain/pendingChecklist';
import { ReminderModal } from './ReminderModal';
import { NO_REMINDER, reminderSummary, validateReminder, type ReminderSchedule, type RecurrenceRule } from '../domain/reminders';

type NoteKind = 'note' | 'pending';
type Note = {
  id: string; owner_id: string; category_id: string | null; kind: NoteKind;
  title: string; description: string; reminder_at: string | null; completed: boolean;
  completed_at: string | null; created_at: string; updated_at: string;
  recurrence_rule: RecurrenceRule | null;
  recurrence_series_id: string | null; recurrence_next_created: boolean;
  deleted_at: string | null; is_pinned: boolean; sort_order: number | null;
};
type NoteItem = { id: string; note_id: string; owner_id: string; content: string; position: number; completed: boolean };
type Category = { id: string; name: string; color: string; owner_id: string };
const TITLE_MAX = 120;

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

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

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
  const [noteItems, setNoteItems] = useState<NoteItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const pageSize = 5;
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [orderNotice, setOrderNotice] = useState(false);
  const [createdNotice, setCreatedNotice] = useState(false);
  const suppressCardClickUntil = useRef(0);
  const orderNoticeTimer = useRef<number | null>(null);
  const createdNoticeTimer = useRef<number | null>(null);
  useEffect(() => () => { if (orderNoticeTimer.current !== null) window.clearTimeout(orderNoticeTimer.current); if (createdNoticeTimer.current !== null) window.clearTimeout(createdNoticeTimer.current); }, []);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<'pending' | 'search' | 'categories'>('pending');
  const [statusTab, setStatusTab] = useState<'active' | 'completed'>('active');
  const [quickOptionsOpen, setQuickOptionsOpen] = useState(false);
  const [quickReminder, setQuickReminder] = useState<ReminderSchedule>(NO_REMINDER);
  const [reminderTarget, setReminderTarget] = useState<'quick' | 'editor' | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => window.localStorage.getItem('orbit-completion-sound') !== 'off');
  const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognizer | null>(null);
  const voiceTimeout = useRef<number | null>(null);
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  const [voiceHint, setVoiceHint] = useState('');
  const appleMobile = isAppleMobile();
  const speechAvailable = Boolean(getSpeechConstructor()) && !appleMobile;
  const [editId, setEditId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');
  const [categoryColor, setCategoryColor] = useState('#7658D8');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [reminder, setReminder] = useState<ReminderSchedule>(NO_REMINDER);
  const [quickTitle, setQuickTitle] = useState('');
  const quickListPreview = useMemo(() => parsePendingItems(quickTitle), [quickTitle]);
  const editorListPreview = useMemo(() => parsePendingItems(title), [title]);
  const [historySeriesId, setHistorySeriesId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [dragNoteId, setDragNoteId] = useState<string | null>(null);
  const [swipeNoteId, setSwipeNoteId] = useState<string | null>(null);
  const [swipeDirection,setSwipeDirection] = useState<"left"|"right">("right");
  const noteVisual=useRef<{ghost:HTMLElement;source:HTMLElement;offsetY:number;offsetX:number}|null>(null);
  function startNoteVisual(event:React.PointerEvent<HTMLElement>) {
    const source=event.currentTarget.closest<HTMLElement>('.orbit-reorder-note');if(!source)return;
    const rect=source.getBoundingClientRect(),ghost=source.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style,{position:'fixed',left:'0',top:'0',width:rect.width+'px',height:rect.height+'px',margin:'0',zIndex:'99999',pointerEvents:'none',transform:`translate3d(${rect.left}px,${rect.top}px,0)`});
    ghost.classList.add('orbit-touch-ghost');document.body.appendChild(ghost);
    source.classList.add('orbit-touch-source');
    noteVisual.current={ghost,source,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top};
  }
  function moveNoteVisual(event:React.PointerEvent<HTMLElement>) {
    const v=noteVisual.current;if(!v)return;
    v.ghost.style.transform=`translate3d(${event.clientX-v.offsetX}px,${event.clientY-v.offsetY}px,0)`;
  }
  function stopNoteVisual() {
    const v=noteVisual.current;noteVisual.current=null;if(!v)return;
    v.source.classList.remove('orbit-touch-source');
    v.ghost.style.transition='opacity 150ms ease';v.ghost.style.opacity='0';
    window.setTimeout(()=>v.ghost.remove(),170);
  }
  const swipeStart = useRef<{id:string;x:number;y:number;direction?: "horizontal"|"vertical";base:number}|null>(null);
  // Long press on the card body enables reorder without sacrificing ordinary scrolling.
  // A non-passive touchmove listener is needed on iOS Safari after the hold activates.
  const longPress = useRef<{id:string;x:number;y:number;timer:number;active:boolean;lastX:number;lastY:number}|null>(null);
  const reorderRef = useRef(reorderNotes);
  reorderRef.current = reorderNotes;
  useEffect(() => {
    const onMove = (event: TouchEvent) => {
      const gesture = longPress.current;
      if (!event.touches.length) return;
      const touch = event.touches[0];
      const swipe = swipeStart.current;
      if (swipe && !gesture?.active) {
        const dx=touch.clientX-swipe.x,dy=touch.clientY-swipe.y;
        if (!swipe.direction && Math.max(Math.abs(dx),Math.abs(dy))>9) swipe.direction=Math.abs(dx)>Math.abs(dy)*1.3?'horizontal':'vertical';
        if(swipe.direction==='horizontal'){
          if(event.cancelable)event.preventDefault();
          const card=document.querySelector<HTMLElement>(`[data-note-drop="${swipe.id}"]`);
          if(card){card.style.transition='none';card.style.transform=`translate3d(${Math.max(-92,Math.min(92,swipe.base+dx))}px,0,0)`;}
        }
      }
      if (!gesture) return;
      gesture.lastX = touch.clientX; gesture.lastY = touch.clientY;
      if (!gesture.active) {
        if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 9) {
          window.clearTimeout(gesture.timer);
          longPress.current = null;
        }
        return;
      }
      if (event.cancelable) event.preventDefault();
      const visual = noteVisual.current;
      if (visual) visual.ghost.style.transform = `translate3d(${touch.clientX - visual.offsetX}px,${touch.clientY - visual.offsetY}px,0)`;
    };
    const finish = (event: TouchEvent) => {
      const gesture = longPress.current;
      const swipe = swipeStart.current; swipeStart.current=null;
      if(swipe && !gesture?.active){
        const card=document.querySelector<HTMLElement>(`[data-note-drop="${swipe.id}"]`);
        if(card){card.style.transform='';card.style.transition='';}
        if(event.type!=='touchcancel' && swipe.direction==='horizontal'){
          const touch=event.changedTouches[0],offset=swipe.base+(touch?touch.clientX-swipe.x:0);
          if(offset>44){setSwipeNoteId(swipe.id);setSwipeDirection('right');}
          else if(offset< -44){setSwipeNoteId(swipe.id);setSwipeDirection('left');}
          else setSwipeNoteId(null);
        }
      }
      if (!gesture) return;
      window.clearTimeout(gesture.timer);
      longPress.current = null;
      if (!gesture.active) return;
      if (event.type === 'touchcancel') { stopNoteVisual(); setDragNoteId(null); return; }
      const cards = [...document.querySelectorAll<HTMLElement>('[data-note-drop]')].filter(card => card.dataset.noteDrop !== gesture.id);
      const target = cards.find(card => { const rect = card.getBoundingClientRect(); return gesture.lastY >= rect.top && gesture.lastY <= rect.bottom; });
      if (target?.dataset.noteDrop) void reorderRef.current(gesture.id, target.dataset.noteDrop);
      stopNoteVisual();
      setDragNoteId(null);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', finish);
    document.addEventListener('touchcancel', finish);
    return () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', finish);
      if (longPress.current) window.clearTimeout(longPress.current.timer);
    };
  }, []);
  function beginCardHold(event: React.TouchEvent<HTMLElement>, id: string) {
    if (busy || event.touches.length !== 1 || (event.target as HTMLElement).closest('button:not(.orbit-note-grip):not(.note-summary),input,select,textarea,a,label')) return;
    const touch = event.touches[0], source = event.currentTarget;
    const x = touch.clientX, y = touch.clientY;
    swipeStart.current={id,x,y,base:swipeNoteId===id?(swipeDirection==='right'?92:-92):0};
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    const gesture = {id,x,y,lastX:x,lastY:y,active:false,timer:0};
    gesture.timer = window.setTimeout(() => {
      if (longPress.current !== gesture) return;
      gesture.active = true;
      suppressCardClickUntil.current = Date.now() + 900;
      swipeStart.current = null;
      source.style.transform = '';
      source.style.transition = '';
      setSwipeNoteId(null);
      setDragNoteId(id);
      const rect = source.getBoundingClientRect(), ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add('orbit-touch-ghost');
      Object.assign(ghost.style,{position:'fixed',left:'0',top:'0',width:rect.width+'px',height:rect.height+'px',margin:'0',zIndex:'99999',pointerEvents:'none',transform:`translate3d(${rect.left}px,${rect.top}px,0)`});
      document.body.appendChild(ghost);
      source.classList.add('orbit-touch-source');
      noteVisual.current = {ghost,source,offsetX:x-rect.left,offsetY:y-rect.top};
    }, 320);
    longPress.current = gesture;
  }


  async function pinNote(note: Note) {
    await perform(async () => {
      const {error: updateError} = await supabase.from('notes').update({is_pinned:!note.is_pinned}).eq('id',note.id).eq('owner_id',userId);
      if (updateError) throw updateError;
    }, note.is_pinned ? 'Pendiente desfijado.' : 'Pendiente fijado arriba.');
    setSwipeNoteId(null);
  }
  async function reorderNotes(sourceId:string,targetId:string) {
    if (sourceId===targetId || busy) return;
    const source=filtered.find(note=>note.id===sourceId), target=filtered.find(note=>note.id===targetId);
    if (!source || !target || source.is_pinned!==target.is_pinned) {setError('Ordena los fijados entre sí y los demás por separado.');return;}
    const group=filtered.filter(note=>note.is_pinned===source.is_pinned);
    const from=group.findIndex(note=>note.id===sourceId),to=group.findIndex(note=>note.id===targetId);
    if(from<0||to<0)return;
    const ordered=[...group];ordered.splice(to,0,ordered.splice(from,1)[0]);
    // Update the visible order immediately; persist independent rows concurrently.
    const previousNotes = notes;
    const positions = new Map(ordered.map((note,index) => [note.id,index+1]));
    setNotes(current => current.map(note => positions.has(note.id) ? {...note,sort_order:positions.get(note.id)!} : note));
    setBusy(true); setError(''); setMessage('');
    try {
      const results = await Promise.all(ordered.map((note,index) =>
        supabase.from('notes').update({sort_order:index+1}).eq('id',note.id).eq('owner_id',userId)
      ));
      const failed = results.find(result => result.error);
      if (failed?.error) throw failed.error;
      setOrderNotice(true);
      if (orderNoticeTimer.current !== null) window.clearTimeout(orderNoticeTimer.current);
      orderNoticeTimer.current = window.setTimeout(() => setOrderNotice(false), 2500);
    } catch (cause) {
      setNotes(previousNotes);
      setError(errorText(cause));
      void load(); // Reconcile if some writes succeeded before another failed.
    } finally {
      setBusy(false);
      setDragNoteId(null);
    }
  }
  function releaseNote(event: React.PointerEvent<HTMLElement>,id:string) {
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-note-drop]');
    if(target?.dataset.noteDrop) void reorderNotes(id,target.dataset.noteDrop);
    stopNoteVisual();setDragNoteId(null);
  }
  const [expandedLists, setExpandedLists] = useState<Set<string>>(() => new Set());
  const toggleListExpansion = (id: string) => setExpandedLists(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => () => {
    if (voiceTimeout.current !== null) window.clearTimeout(voiceTimeout.current);
    recognizer.current?.stop();
    recognizer.current = null;
  }, []);

  function clearVoiceTimeout() {
    if (voiceTimeout.current !== null) window.clearTimeout(voiceTimeout.current);
    voiceTimeout.current = null;
  }

  function toggleSound() {
    setSoundEnabled((previous) => {
      window.localStorage.setItem('orbit-completion-sound', previous ? 'off' : 'on');
      return !previous;
    });
  }

  function toggleVoice() {
    setError('');
    if (appleMobile) {
      // Safari's SpeechRecognition opens a system recording sheet that may need
      // manual dismissal. Prefer iOS keyboard dictation for a reliable PWA flow.
      setVoiceHint(quickTitle.trim() ? '' : 'Usa el micrófono del teclado de iPhone para dictar.');
      quickInputRef.current?.focus();
      return;
    }
    if (recognizer.current) {
      clearVoiceTimeout();
      recognizer.current.stop();
      recognizer.current = null;
      setListening(false);
      return;
    }
    const Constructor = getSpeechConstructor();
    if (!Constructor) {
      setVoiceHint(quickTitle.trim() ? '' : 'Toca el campo y utiliza el micrófono de tu teclado para dictar.');
      quickInputRef.current?.focus();
      return;
    }
    const speech = new Constructor();
    speech.lang = 'es-CO';
    speech.interimResults = false;
    speech.continuous = false;
    speech.onresult = (result) => {
      const transcript = result.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) {
        setQuickTitle((previous) => [previous.trim(), transcript].filter(Boolean).join(' ').slice(0, TITLE_MAX));
        setVoiceHint('');
        setError('');
      }
      clearVoiceTimeout();
      speech.stop();
    };
    speech.onerror = (result) => {
      clearVoiceTimeout();
      setListening(false);
      if (recognizer.current === speech) recognizer.current = null;
      if (result.error === 'aborted') return;
      if (result.error === 'not-allowed' || result.error === 'service-not-allowed') {
        setError('El micrófono está bloqueado. Habilita el permiso del navegador o usa el dictado del teclado.');
      } else if (result.error === 'no-speech') {
        setVoiceHint('No escuché ninguna frase. Puedes intentarlo otra vez.');
      } else {
        setError('No se completó el dictado. Puedes escribir o usar el micrófono del teclado.');
      }
    };
    speech.onend = () => {
      clearVoiceTimeout();
      setListening(false);
      if (recognizer.current === speech) recognizer.current = null;
    };
    recognizer.current = speech;
    try {
      speech.start();
      setListening(true);
      setVoiceHint('Escuchando… habla ahora. Se detendrá al reconocer la frase.');
      // Defensive cutoff when the browser never fires onresult/onend.
      voiceTimeout.current = window.setTimeout(() => {
        if (recognizer.current !== speech) return;
        speech.stop();
        setVoiceHint('Dictado finalizado. Puedes volver a pulsar el micrófono.');
      }, 15000);
    } catch {
      clearVoiceTimeout();
      recognizer.current = null;
      setListening(false);
      setError('No se pudo iniciar el dictado. Usa el micrófono del teclado.');
    }
  }

  const load = useCallback(async () => {
    const [notesResponse, categoriesResponse, itemsResponse] = await Promise.all([
      supabase.from('notes').select('*').eq('owner_id', userId).order('created_at', { ascending: false }),
      supabase.from('note_categories').select('*').eq('owner_id', userId).order('name'),
      supabase.from('note_items').select('*').eq('owner_id', userId).order('position'),
    ]);
    if (notesResponse.error) throw notesResponse.error;
    if (categoriesResponse.error) throw categoriesResponse.error;
    if (itemsResponse.error) throw itemsResponse.error;
    const loadedNotes = (notesResponse.data || []) as Note[];
    let loadedItems = (itemsResponse.data || []) as NoteItem[];
    // One-time, automatic conversion of existing comma-separated pending titles.
    // The RPC inserts items only when the note has no checklist yet.
    const existingChecklistIds = new Set(loadedItems.map(item => item.note_id));
    const legacyLists = loadedNotes.filter(note =>
      note.kind === 'pending' && !note.deleted_at &&
      !existingChecklistIds.has(note.id) && parsePendingItems(note.title).length >= 2
    );
    if (legacyLists.length) {
      let changed = false;
      for (const note of legacyLists) {
        const { error: conversionError } = await supabase.rpc('save_pending_with_items', {
          p_title: note.title, p_category_id: note.category_id,
          p_reminder_at: note.reminder_at, p_recurrence_rule: note.recurrence_rule,
          p_items: parsePendingItems(note.title), p_note_id: note.id,
          p_reset_recurrence: false,
        });
        if (!conversionError) changed = true;
      }
      if (changed) {
        const refreshed = await supabase.from('note_items').select('*').eq('owner_id', userId).order('position');
        if (!refreshed.error) loadedItems = (refreshed.data || []) as NoteItem[];
      }
    }
    setNotes(loadedNotes);
    setCategories((categoriesResponse.data || []) as Category[]);
    setNoteItems(loadedItems);
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

  const visibleNotes = useMemo(() => notes.filter(note => !note.deleted_at), [notes]);
  const trashedNotes = useMemo(() => notes.filter(note => Boolean(note.deleted_at)), [notes]);
  const filtered = useMemo(() => visibleNotes.filter(note => {
    if (section === 'pending') return statusTab === 'active' ? !note.completed : note.completed;
    return section === 'search' && note.title.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'));
  }).sort((a,b) => Number(b.is_pinned)-Number(a.is_pinned) || (a.sort_order??Number.MAX_SAFE_INTEGER)-(b.sort_order??Number.MAX_SAFE_INTEGER) || new Date(b.created_at).getTime()-new Date(a.created_at).getTime()), [visibleNotes, section, statusTab, search]);
  useEffect(() => { setPage(1); }, [section, statusTab, search]);
  const displayPageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / displayPageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedNotes = filtered.slice((currentPage - 1) * displayPageSize, currentPage * displayPageSize);
  const trashPages = Math.max(1, Math.ceil(trashedNotes.length / pageSize));
  const currentTrashPage = Math.min(trashPage, trashPages);
  const pagedTrash = trashedNotes.slice((currentTrashPage - 1) * pageSize, currentTrashPage * pageSize);
  const pagination = (current: number, total: number, count: number, change: (value: number) => void) => total > 1 ? <nav className="orbit-pagination" aria-label="Páginas de registros"><small>Mostrando {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, count)} de {count}</small><div><button type="button" className="outline" disabled={current === 1} onClick={() => change(current - 1)}>Anterior</button><span>Página {current} de {total}</span><button type="button" className="outline" disabled={current === total} onClick={() => change(current + 1)}>Siguiente</button></div></nav> : null;
  const itemsFor = (id: string) => noteItems.filter(item => item.note_id === id);
  const seriesKey = (note: Note) => note.recurrence_series_id ?? note.id;
  const recurringSeries = useMemo(() => new Set(visibleNotes.filter(note =>
    note.recurrence_rule || note.recurrence_series_id
  ).map(note => note.recurrence_series_id ?? note.id)), [visibleNotes]);
  const activeSeries = useMemo(() => new Set(visibleNotes.filter(note =>
    note.recurrence_rule !== null && !note.recurrence_next_created
  ).map(note => note.recurrence_series_id ?? note.id)), [visibleNotes]);
  const recurrenceStatus = (note: Note) => !recurringSeries.has(seriesKey(note))
    ? null : activeSeries.has(seriesKey(note)) ? 'Repetición activa' : 'Repetición detenida';
  const historyRows = useMemo(() => historySeriesId
    ? visibleNotes.filter(note => seriesKey(note) === historySeriesId)
      .sort((a, b) => (b.reminder_at ?? '').localeCompare(a.reminder_at ?? ''))
    : [], [historySeriesId, visibleNotes]);
  const historyCompleted = historyRows.filter(note => note.completed).length;
  const historyOverdue = historyRows.filter(note => !note.completed &&
    note.reminder_at && new Date(note.reminder_at).getTime() < Date.now()).length;
  const historyUpcoming = historyRows.length - historyCompleted - historyOverdue;
  const completedCount = visibleNotes.filter((note) => note.completed).length;
  const activeCount = visibleNotes.length - completedCount;

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
    if (cleaned.length < 2 || cleaned.length > TITLE_MAX) { setError('El título debe tener entre 2 y 120 caracteres.'); return; }
    const reminderError = validateReminder(quickReminder);
    if (reminderError) { setError(reminderError); return; }
    if (await perform(async () => {
      const existingIds = new Set(notes.map(note => note.id));
      const { error: saveError } = await supabase.rpc('save_pending_with_items', {
        p_title: cleaned, p_category_id: null, p_reminder_at: quickReminder.at,
        p_recurrence_rule: quickReminder.rule, p_items: quickListPreview,
      });
      if (saveError) throw saveError;
      const { data: candidates, error: lookupError } = await supabase.from('notes')
        .select('id').eq('owner_id', userId).eq('kind','pending').eq('title',cleaned)
        .order('created_at',{ascending:false}).limit(20);
      if (lookupError) throw lookupError;
      const created = candidates?.find(candidate => !existingIds.has(candidate.id));
      if (!created) throw new Error('No se pudo identificar el pendiente recién creado para ordenarlo.');
      const minOrder = Math.min(0,...notes.filter(note => !note.deleted_at && !note.completed && !note.is_pinned).map(note => note.sort_order ?? 0));
      const { error: positionError } = await supabase.from('notes')
        .update({sort_order:minOrder-1}).eq('owner_id',userId).eq('id',created.id);
      if (positionError) throw positionError;
    }, 'Pendiente creado.')) {
      setQuickTitle(''); setVoiceHint(''); setQuickReminder(NO_REMINDER); setStatusTab('active'); setPage(1);
      setCreatedNotice(true);
      if (createdNoticeTimer.current !== null) window.clearTimeout(createdNoticeTimer.current);
      createdNoticeTimer.current = window.setTimeout(() => setCreatedNotice(false), 2500);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = title.trim();
    if (cleaned.length < 2 || cleaned.length > TITLE_MAX) {
      setError('El título debe tener entre 2 y 120 caracteres.'); return;
    }
    const previousNote = editId ? notes.find(note => note.id === editId) : undefined;
    const scheduleChanged = previousNote && (
      previousNote.reminder_at !== reminder.at ||
      JSON.stringify(previousNote.recurrence_rule) !== JSON.stringify(reminder.rule)
    );
    const reminderError = scheduleChanged || !previousNote ? validateReminder(reminder) : null;
    if (reminderError) { setError(reminderError); return; }
    if (previousNote?.recurrence_next_created && scheduleChanged) {
      setError('Esta ocurrencia ya generó la siguiente. Edita la ocurrencia más reciente para cambiar el horario de repetición.');
      return;
    }
    const done = await perform(async () => {
      const { error: saveError } = await supabase.rpc('save_pending_with_items', {
        p_title: cleaned, p_category_id: categoryId || null,
        p_reminder_at: reminder.at, p_recurrence_rule: reminder.rule,
        p_items: editorListPreview, p_note_id: editId,
        p_reset_recurrence: Boolean(scheduleChanged),
      });
      if (saveError) throw saveError;
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
  async function deleteOccurrence(note: Note) {
    const done = await perform(async () => {
      const { error: updateError } = await supabase.from('notes')
        .update({deleted_at: new Date().toISOString()}).eq('id', note.id).eq('owner_id', userId);
      if (updateError) throw updateError;
    }, 'Pendiente enviado a la papelera.');
    if (done) { setDeleteTarget(null); setHistorySeriesId(null); }
  }
  async function deleteEntireSeries(note: Note) {
    const key = seriesKey(note);
    if (!window.confirm('¿Enviar toda la serie a la papelera?')) return;
    const done = await perform(async () => {
      const {error: updateError} = await supabase.from('notes')
        .update({deleted_at: new Date().toISOString()}).eq('owner_id', userId)
        .or(`id.eq.${key},recurrence_series_id.eq.${key}`);
      if (updateError) throw updateError;
    }, 'Serie enviada a la papelera.');
    if (done) {setDeleteTarget(null);setHistorySeriesId(null);}
  }
  async function restoreNote(note: Note) {
    await perform(async () => {
      const {error: updateError} = await supabase.from('notes').update({deleted_at: null}).eq('id',note.id).eq('owner_id',userId);
      if(updateError) throw updateError;
    }, 'Pendiente recuperado.');
  }
  async function permanentlyDelete(note: Note) {
    if (!window.confirm(`¿Eliminar definitivamente "${note.title}"? No se podrá recuperar.`)) return;
    await perform(async () => {
      const {error: deleteError} = await supabase.from('notes').delete().eq('id',note.id).eq('owner_id',userId).not('deleted_at','is',null);
      if(deleteError) throw deleteError;
    }, 'Pendiente eliminado definitivamente.');
  }
  async function toggleItem(item: NoteItem) {
    await perform(async () => {
      const {error: updateError} = await supabase.from('note_items').update({completed: !item.completed,updated_at:new Date().toISOString()}).eq('id',item.id).eq('owner_id',userId);
      if(updateError) throw updateError;
    }, 'Lista actualizada.');
  }
  async function addListItem(noteId: string) {
    const value = window.prompt('Nuevo elemento de la lista:')?.trim();
    if (!value) return;
    if (value.length > 500) { setError('El elemento no puede superar 500 caracteres.'); return; }
    const existing = itemsFor(noteId);
    await perform(async () => {
      const {error: insertError} = await supabase.from('note_items').insert({
        note_id: noteId, owner_id: userId, content: value,
        position: existing.length ? Math.max(...existing.map(item => item.position)) + 1 : 0,
      });
      if (insertError) throw insertError;
    }, 'Elemento agregado.');
  }
  async function editListItem(item: NoteItem) {
    const value = window.prompt('Editar elemento:', item.content)?.trim();
    if (!value || value === item.content) return;
    if (value.length > 500) { setError('El elemento no puede superar 500 caracteres.'); return; }
    await perform(async () => {
      const {error: updateError} = await supabase.from('note_items')
        .update({content: value, updated_at: new Date().toISOString()})
        .eq('id', item.id).eq('owner_id', userId);
      if (updateError) throw updateError;
    }, 'Elemento actualizado.');
  }
  async function deleteListItem(item: NoteItem) {
    if (!window.confirm(`¿Eliminar "${item.content}" de la lista?`)) return;
    await perform(async () => {
      const {error: deleteError} = await supabase.from('note_items').delete().eq('id', item.id).eq('owner_id', userId);
      if (deleteError) throw deleteError;
    }, 'Elemento eliminado.');
  }
  function remove(note: Note) {
    setMessage('');
    setError('');
    setDeleteTarget(note);
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
      if (editingCategoryId === category.id) resetCategory();
    }
  }
  const categoryName = (id: string | null) => categories.find(category => category.id === id);

  return <section className="notes-board">
    <div className="heading notes-heading"><div><h1>Pendientes</h1></div>
      <button type="button" className="note-sound-toggle" aria-label={soundEnabled ? 'Silenciar sonido al completar' : 'Activar sonido al completar'}
        aria-pressed={soundEnabled} onClick={toggleSound}>
        {soundEnabled ? <Volume2 size={17}/> : <VolumeX size={17}/>}
        <span>{soundEnabled ? 'Sonido activado' : 'Sin sonido'}</span>
      </button>
    </div>
    {trashOpen && <section className="card notes-trash"><button type="button" className="outline" onClick={() => setTrashOpen(false)} aria-label="Volver a pendientes">← Volver a pendientes</button><h2>Papelera</h2<p>Recupera tus pendientes o elimínalos definitivamente.</p>{pagedTrash.map(note => <div key={note.id} className="notes-trash-item"><strong>{note.title}</strong><button type="button" className="outline" disabled={busy} onClick={() => void restoreNote(note)}>Restaurar</button><button type="button" disabled={busy} onClick={() => void permanentlyDelete(note)}>Eliminar definitivamente</button></div>)}{!trashedNotes.length && <p>No hay pendientes eliminados.</p>}{pagination(currentTrashPage, trashPages, trashedNotes.length, setTrashPage)}</section>}
    {!trashOpen && <>
    <nav className="notes-section-tabs" aria-label="Secciones de pendientes">
      <button type="button" className={section === 'pending' ? 'selected' : ''} aria-current={section === 'pending' ? 'page' : undefined} onClick={() => setSection('pending')}><ListTodo size={17}/> Pendientes</button>
      <button type="button" className={section === 'search' ? 'selected' : ''} aria-current={section === 'search' ? 'page' : undefined} onClick={() => setSection('search')}><Search size={17}/> Buscar</button>
      <button type="button" className={trashOpen ? 'selected notes-trash-tab' : 'notes-trash-tab'} aria-expanded={trashOpen} onClick={() => setTrashOpen(v => !v)}><Trash2 size={17}/> {trashOpen ? 'Cerrar papelera' : `Papelera (${trashedNotes.length})`}</button>
    </nav>
    {section === 'pending' && <>
    <form className="card quick-capture quick-capture-highlight" onSubmit={(event) => void quickAdd(event)}>
      <div className="quick-capture-heading" id="quick-capture-heading">
        <span className="quick-capture-heading-icon"><Plus size={20} aria-hidden="true"/></span>
        <strong>Registrar nuevo pendiente</strong>
      </div>
      <div className="quick-capture-body">
      <div className="quick-capture-main">
        <ListTodo size={20} aria-hidden="true"/>
        <input ref={quickInputRef} aria-label="Título del pendiente rápido" placeholder="¿Qué necesitas recordar?" minLength={2} maxLength={TITLE_MAX}
          value={quickTitle} onChange={event => { setQuickTitle(event.target.value.slice(0, TITLE_MAX)); setVoiceHint(''); }} spellCheck lang="es" required/>
        <button type="button" className={listening ? 'quick-voice is-listening' : 'quick-voice'}
          aria-label={listening ? 'Detener dictado' : 'Dictar pendiente por voz'}
          aria-pressed={listening} onClick={toggleVoice} title={listening ? 'Detener dictado' : speechAvailable ? 'Dictar en español' : 'Activar dictado del teclado'}>
          {listening ? <MicOff size={19}/> : <Mic size={19}/>}
        </button>
        <button type="submit" className="quick-create" disabled={busy || quickTitle.trim().length < 2}
          aria-label="Agregar pendiente rápido"><Plus size={19}/></button>
      </div>
      {listening && <p className="quick-listening is-active" role="status" aria-live="polite"><span className="voice-live-dot" aria-hidden="true"/> Escuchando… Toca el micrófono para detener.</p>}
      {!listening && voiceHint && <p className="quick-listening" role="status">{voiceHint}</p>}
      <small className="field-help">Separa varios elementos con comas y los convertiremos automáticamente en una lista.</small>
      {quickListPreview.length > 0 && <div className="pending-list-preview" role="status"><strong>Vista previa de lista ({quickListPreview.length})</strong><ul>{quickListPreview.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul><small>Al guardar, cada elemento tendrá su propia casilla para marcarlo.</small></div>}
      <div className="quick-capture-bottom reminder-capture-bottom">
        <button type="button" className="quick-options-toggle reminder-options-toggle"
          aria-expanded={quickOptionsOpen} aria-controls="quick-reminder-details"
          onClick={() => setQuickOptionsOpen((previous) => !previous)}>
          <CalendarClock size={17} aria-hidden="true"/>
          <strong>Recordatorio</strong>
          <span className="reminder-inline-summary">{quickReminder.at ? reminderSummary(quickReminder) : "Configurar recordatorio"}</span>
          {quickOptionsOpen ? <ChevronUp size={17} aria-hidden="true"/> : <ChevronDown size={17} aria-hidden="true"/>}
        </button>
      </div>
      {quickOptionsOpen && <div className="quick-reminder-details" id="quick-reminder-details">
        <p>Configura la fecha, la hora y la repetición de este pendiente.</p>
        <button type="button" className="outline quick-reminder-configure" onClick={() => setReminderTarget('quick')}>
          <CalendarClock size={16} aria-hidden="true"/>
          {quickReminder.at ? 'Modificar recordatorio' : 'Configurar recordatorio'}
        </button>
      </div>}
      </div>
    </form>
    <section className="notes-notebook">
    <div className="notes-status-row">
      <div className="notes-status-tabs" role="tablist" aria-label="Estado de pendientes">
        <button type="button" role="tab" aria-selected={statusTab === 'active'} className={statusTab === 'active' ? 'selected' : ''}
          onClick={() => setStatusTab('active')}><Circle size={15}/> Activos <span>{activeCount}</span></button>
        <button type="button" role="tab" aria-selected={statusTab === 'completed'} className={statusTab === 'completed' ? 'selected' : ''}
          onClick={() => setStatusTab('completed')}><CheckSquare size={15}/> Completados <span>{completedCount}</span></button>
      </div>

    </div>

    {loading && <p className="muted">Cargando tus pendientes…</p>}
    {!loading && <>
    <h2 className="notes-list-heading"><ListTodo size={19} aria-hidden="true"/> <span>Pendientes ({filtered.length})</span>{(error || (message && message !== 'Pendiente creado.') || createdNotice || orderNotice) && <span className={`orbit-order-inline-notice${error ? ' orbit-inline-error' : ''}`} role={error ? 'alert' : 'status'} title={error || message || ''}>{error || (createdNotice ? 'Pendiente creado' : orderNotice ? 'Orden guardado' : message)}</span>}</h2>
    <div className="notes-list">
      {pagedNotes.map(note => <div className="orbit-swipe-shell" key={note.id}>
        {section==="pending" && statusTab==="active" && <div className="orbit-swipe-underlay" aria-hidden="true">
          <span className="orbit-swipe-pin"><Pin size={20}/>{note.is_pinned?"Desfijar":"Fijar"}</span>
          <span className="orbit-swipe-delete"><Trash2 size={20}/>Eliminar</span>
        </div>}
        <article className={`card note-list-item orbit-reorder-note ${swipeNoteId===note.id?(swipeDirection==="right"?"orbit-swiped-right":"orbit-swiped-left"):""}`}
          data-note-drop={note.id} draggable={false}
          onTouchStart={event=>beginCardHold(event,note.id)}
          onPointerDown={event=>{if(event.pointerType==='mouse' && event.button===0 && !(event.target as HTMLElement).closest('button,input,select,textarea,a,label')){setDragNoteId(note.id);startNoteVisual(event);}}}
          onPointerMove={event=>{if(event.pointerType==='mouse')moveNoteVisual(event);}}
          onPointerUp={event=>{if(event.pointerType==='mouse' && dragNoteId)releaseNote(event,note.id);}}
          onPointerCancel={event=>{if(event.pointerType==='mouse'){stopNoteVisual();setDragNoteId(null);}}}
          onClickCapture={event=>{if(Date.now()<suppressCardClickUntil.current){event.preventDefault();event.stopPropagation();}}}
          onDragStart={event=>{event.dataTransfer.setData("text/plain",note.id);setDragNoteId(note.id);}}
          onDragEnd={()=>setDragNoteId(null)}
          onDragOver={event=>{if(dragNoteId)event.preventDefault();}}
          onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData("text/plain")||dragNoteId;if(id)void reorderNotes(id,note.id);}}
>
        {note.is_pinned && <Pin size={15} className="orbit-note-pin" aria-label="Fijado"/>}
        <div className="note-check">
          {note.kind === 'pending'
            ? <input type="checkbox" aria-label={`Marcar como ${note.completed ? 'pendiente' : 'completado'}: ${note.title}`}
                checked={note.completed} disabled={busy} onChange={() => void toggle(note)}/>
            : <NotebookPen size={21} aria-label="Nota" />}
        </div>
        <button type="button" className="note-summary" onClick={() => openEditor(note)}>
          <strong className={note.completed ? 'note-done note-title-compact' : 'note-title-compact'} title={note.title}>{note.title}</strong>
          {recurrenceStatus(note) && <span className={activeSeries.has(seriesKey(note))
            ? 'notes-recurrence-indicator' : 'notes-recurrence-indicator is-stopped'}>
            <CalendarClock size={13} aria-hidden="true"/> {recurrenceStatus(note)}
          </span>}
          {note.description && <span>{note.description}</span>}
          <small>
            {note.reminder_at
              ? <><CalendarClock size={13} aria-hidden="true"/> Programado: {reminderLabel(note.reminder_at)}</>
              : <><CalendarClock size={13} aria-hidden="true"/> Creado: {reminderLabel(note.created_at)}</>}
            {note.category_id && <><span className="note-category-dot" style={{background: categoryName(note.category_id)?.color ?? '#7658D8'}}/>{categoryName(note.category_id)?.name ?? 'Sin categoría'}</>}
            {note.completed && <><CheckCircle2 size={13} aria-hidden="true"/> Completado</>}
          </small>
        </button>
        {itemsFor(note.id).length > 0 && <div className="pending-checklist-disclosure">
          <button type="button" className="outline pending-checklist-toggle" aria-expanded={expandedLists.has(note.id)}
            aria-controls={`pending-list-${note.id}`} onClick={() => toggleListExpansion(note.id)}>
            <ListTodo size={15}/> {expandedLists.has(note.id) ? 'Ocultar' : 'Ver lista'}
            {expandedLists.has(note.id) ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
          <small>{itemsFor(note.id).filter(item => item.completed).length} de {itemsFor(note.id).length} completados</small>
          {expandedLists.has(note.id) && <ul id={`pending-list-${note.id}`} className="pending-checklist-items">
            {itemsFor(note.id).map(item => <li key={item.id}><label><input type="checkbox" checked={item.completed} disabled={busy} onChange={() => void toggleItem(item)}/><span style={{textDecoration:item.completed?'line-through':'none'}}>{item.content}</span></label><button type="button" className="outline" disabled={busy} aria-label={`Editar ${item.content}`} onClick={() => void editListItem(item)}><Pencil size={14}/></button><button type="button" className="outline" disabled={busy} aria-label={`Eliminar ${item.content}`} onClick={() => void deleteListItem(item)}><X size={14}/></button></li>)}<li><button type="button" className="outline" disabled={busy} onClick={() => void addListItem(note.id)}><Plus size={14}/> Agregar elemento</button></li>
          </ul>}
        </div>}
        
        <div className="note-actions">
          {recurringSeries.has(seriesKey(note)) && <button type="button" className="note-history-button"
            aria-label={`Ver historial de ${note.title}`} title="Historial de repeticiones"
            onClick={() => setHistorySeriesId(seriesKey(note))}><CalendarClock size={17}/></button>}
          <button type="button" className="orbit-action-edit" aria-label={`Editar ${note.title}`} title="Editar" onClick={() => openEditor(note)}><Pencil size={17} aria-hidden="true"/><span>Editar</span></button>
          <button type="button" className="orbit-action-delete" aria-label={`Eliminar ${note.title}`} title="Eliminar" onClick={() => remove(note)} disabled={busy}><Trash2 size={17} aria-hidden="true"/><span>Eliminar</span></button>
        </div>
      </article>
        {swipeNoteId===note.id && <div className={`orbit-swipe-action ${swipeDirection==="right"?"orbit-swipe-action-left":"orbit-swipe-action-right"}`}>
          {swipeDirection==="right" ? <button type="button" onClick={()=>void pinNote(note)}><Pin size={17}/>{note.is_pinned?"Desfijar":"Fijar"}</button> : <button type="button" className="orbit-action-delete" onClick={()=>{setDeleteTarget(note);setSwipeNoteId(null);}}><Trash2 size={17}/>Eliminar</button>}
        </div>}
      </div>)}
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/>
        <h2>{statusTab === 'active' ? 'Sin pendientes activos' : 'Aún no hay completados'}</h2>
        <p>No hay registros en esta sección.</p>
      </div>}
    </div>{pagination(currentPage, totalPages, filtered.length, setPage)}</>}
    </section>
    </>}
    {section === 'search' && <div className="notes-search-pane">
      <div className="notes-search-highlight">
        <div className="quick-capture-heading">
          <span className="quick-capture-heading-icon"><Search size={20} aria-hidden="true"/></span>
          <strong>Buscar pendientes</strong>
        </div>
        <div className="notes-search-body">
          <label className="notes-search"><Search size={19} aria-hidden="true"/><input aria-label="Buscar pendientes por título" placeholder="Buscar pendientes por título..." value={search} onChange={event => setSearch(event.target.value)}/></label>
        </div>
      </div>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="feedback" role="status">{message}</p>}
    {loading && <p className="muted">Cargando tus pendientes…</p>}
    {!loading && <>
    <h2 className="notes-list-heading"><Search size={19} aria-hidden="true"/> Resultados de búsqueda ({filtered.length})</h2>
    <div className="notes-list">
      {pagedNotes.map(note => <article className="card note-list-item" key={note.id}>
        <div className="note-check">
          {note.kind === 'pending'
            ? <input type="checkbox" aria-label={`Marcar como ${note.completed ? 'pendiente' : 'completado'}: ${note.title}`}
                checked={note.completed} disabled={busy} onChange={() => void toggle(note)}/>
            : <NotebookPen size={21} aria-label="Nota" />}
        </div>
        <button type="button" className="note-summary" onClick={() => openEditor(note)}>
          <strong className={note.completed ? 'note-done note-title-compact' : 'note-title-compact'} title={note.title}>{note.title}</strong>
          {recurrenceStatus(note) && <span className={activeSeries.has(seriesKey(note))
            ? 'notes-recurrence-indicator' : 'notes-recurrence-indicator is-stopped'}>
            <CalendarClock size={13} aria-hidden="true"/> {recurrenceStatus(note)}
          </span>}
          {note.description && <span>{note.description}</span>}
          <small>
            {note.reminder_at
              ? <><CalendarClock size={13} aria-hidden="true"/> Programado: {reminderLabel(note.reminder_at)}</>
              : <><CalendarClock size={13} aria-hidden="true"/> Creado: {reminderLabel(note.created_at)}</>}
            {note.category_id && <><span className="note-category-dot" style={{background: categoryName(note.category_id)?.color ?? '#7658D8'}}/>{categoryName(note.category_id)?.name ?? 'Sin categoría'}</>}
            {note.completed && <><CheckCircle2 size={13} aria-hidden="true"/> Completado</>}
          </small>
        </button>
        {itemsFor(note.id).length > 0 && <div className="pending-checklist-disclosure">
          <button type="button" className="outline pending-checklist-toggle" aria-expanded={expandedLists.has(note.id)}
            aria-controls={`pending-list-${note.id}`} onClick={() => toggleListExpansion(note.id)}>
            <ListTodo size={15}/> {expandedLists.has(note.id) ? 'Ocultar' : 'Ver lista'}
            {expandedLists.has(note.id) ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
          </button>
          <small>{itemsFor(note.id).filter(item => item.completed).length} de {itemsFor(note.id).length} completados</small>
          {expandedLists.has(note.id) && <ul id={`pending-list-${note.id}`} className="pending-checklist-items">
            {itemsFor(note.id).map(item => <li key={item.id}><label><input type="checkbox" checked={item.completed} disabled={busy} onChange={() => void toggleItem(item)}/><span style={{textDecoration:item.completed?'line-through':'none'}}>{item.content}</span></label><button type="button" className="outline" disabled={busy} aria-label={`Editar ${item.content}`} onClick={() => void editListItem(item)}><Pencil size={14}/></button><button type="button" className="outline" disabled={busy} aria-label={`Eliminar ${item.content}`} onClick={() => void deleteListItem(item)}><X size={14}/></button></li>)}<li><button type="button" className="outline" disabled={busy} onClick={() => void addListItem(note.id)}><Plus size={14}/> Agregar elemento</button></li>
          </ul>}
        </div>}
        <div className="note-actions">
          {recurringSeries.has(seriesKey(note)) && <button type="button" className="note-history-button"
            aria-label={`Ver historial de ${note.title}`} title="Historial de repeticiones"
            onClick={() => setHistorySeriesId(seriesKey(note))}><CalendarClock size={17}/></button>}
          <button type="button" className="orbit-action-edit" aria-label={`Editar ${note.title}`} title="Editar" onClick={() => openEditor(note)}><Pencil size={17} aria-hidden="true"/><span>Editar</span></button>
          <button type="button" className="orbit-action-delete" aria-label={`Eliminar ${note.title}`} title="Eliminar" onClick={() => remove(note)} disabled={busy}><Trash2 size={17} aria-hidden="true"/><span>Eliminar</span></button>
        </div>
      </article>)}
      {filtered.length === 0 && <div className="card notes-empty"><NotebookPen size={30} aria-hidden="true"/>
        <h2>{section === 'search' ? 'Sin resultados' : statusTab === 'active' ? 'Sin pendientes activos' : 'Aún no hay completados'}</h2>
        <p>{section === 'search' ? 'No hay pendientes con ese título.' : 'No hay registros en esta sección.'}</p>
      </div>}
    </div>{pagination(currentPage, totalPages, filtered.length, setPage)}</>}
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
        <button type="button" className="orbit-action-edit" disabled={busy} aria-label={`Editar categoría ${category.name}`} onClick={() => editCategory(category)}><Pencil size={16}/></button>
        <button type="button" className="orbit-action-delete" disabled={busy} aria-label={`Eliminar categoría ${category.name}`} onClick={() => void removeCategory(category)}><Trash2 size={16}/></button>
      </div>)}
      {!categories.length && <p className="muted">Aún no hay categorías.</p>}
    </div>}
    </>}
    {deleteTarget && <div className="modal-backdrop" role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}>
      <section className="modal orbit-detail-modal note-modal notes-delete-modal" role="dialog"
        aria-modal="true" aria-labelledby="note-delete-title">
        <header className="orbit-modal-header">
          <span className="orbit-modal-icon"><Trash2 size={21}/></span>
          <div className="orbit-modal-heading">
            <small>Confirmar eliminación</small>
            <h2 id="note-delete-title">Eliminar pendiente</h2>
          </div>
          <button type="button" className="outline orbit-modal-close" disabled={busy}
            aria-label="Cancelar eliminación" onClick={() => setDeleteTarget(null)}><X size={18}/></button>
        </header>
        <p><strong>{deleteTarget.title}</strong></p>
        <p className="field-help">{deleteTarget.reminder_at
          ? `Ocurrencia: ${reminderLabel(deleteTarget.reminder_at)}`
          : 'Pendiente sin recordatorio'}</p>
        {recurringSeries.has(seriesKey(deleteTarget)) ? <>
          <p>Elige qué quieres eliminar:</p>
          <div className="notes-delete-actions">
            <button type="button" className="outline" disabled={busy}
              onClick={() => void deleteOccurrence(deleteTarget)}>
              <Trash2 size={16}/> Solo esta ocurrencia
            </button>
            <small>Conserva las demás fechas. Si esta es la última ocurrencia programada, la serie dejará de repetirse.</small>
            <button type="button" className="notes-delete-all" disabled={busy}
              onClick={() => void deleteEntireSeries(deleteTarget)}>
              <Trash2 size={16}/> Toda la serie y su historial
            </button>
            <small>Elimina definitivamente todas las ocurrencias de esta serie.</small>
          </div>
        </> : <button type="button" className="notes-delete-all" disabled={busy}
          onClick={() => void deleteOccurrence(deleteTarget)}>
          <Trash2 size={16}/> Eliminar este pendiente
        </button>}
        {error && <p className="error" role="alert">{error}</p>}
        <button type="button" className="outline notes-delete-cancel" disabled={busy}
          onClick={() => setDeleteTarget(null)}>Cancelar</button>
      </section>
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
        <p className="notes-history-series-status">{historyRows.some(note => note.recurrence_rule && !note.recurrence_next_created)
          ? 'Repetición activa' : 'Repetición detenida'}</p>
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
            <span className="field-counter">{title.length}/{TITLE_MAX} caracteres</span>
            <small className="field-help">Separa varios elementos con comas y los convertiremos automáticamente en una lista.</small></label>
          {editorListPreview.length > 0 && <div className="pending-list-preview" role="status"><strong>Vista previa de lista ({editorListPreview.length})</strong><ul>{editorListPreview.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul><small>Al guardar, estos elementos tendrán casillas independientes.</small></div>}
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
