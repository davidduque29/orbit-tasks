import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../infrastructure/supabaseClient';
import { DeviceManager } from './DeviceManager';

interface UserProfileProps {
  userId: string;
  email: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || 'U').toLocaleUpperCase();
}

export function UserProfile({ userId, email }: UserProfileProps) {
  const fallback = email.split('@')[0] || 'Usuario';
  const [displayName, setDisplayName] = useState(fallback);
  const [draftName, setDraftName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    void supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setFeedback('No se pudo cargar el perfil.');
        } else if (data?.display_name && data.display_name !== 'Usuario') {
          setDisplayName(data.display_name);
        }
      });
    return () => { active = false; };
  }, [userId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim();
    if (name.length < 2 || name.length > 80) {
      setFeedback('Escribe un nombre de 2 a 80 caracteres.');
      return;
    }
    setSaving(true);
    setFeedback('');
    try {
      const { error } = await supabase.from('profiles').upsert({
        user_id: userId,
        display_name: name,
        timezone: 'America/Bogota',
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setDisplayName(name);
      setEditing(false);
      setFeedback('Perfil guardado.');
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'No se pudo actualizar el perfil.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-root">
      <button type="button" className="profile-trigger" aria-haspopup="true" aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}>
        <span className="profile-avatar" aria-hidden="true">{initials(displayName)}</span>
        <span className="profile-trigger-name">{displayName}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {menuOpen && (
        <div className="profile-dropdown">
          <div className="profile-heading">
            <span className="profile-avatar large" aria-hidden="true">{initials(displayName)}</span>
            <div><strong>{displayName}</strong><small>{email}</small></div>
          </div>
          {editing ? (
            <form onSubmit={(event) => void save(event)}>
              <label htmlFor="profile-name">Nombre para mostrar</label>
              <input id="profile-name" autoComplete="name" minLength={2} maxLength={80}
                value={draftName} onChange={(event) => setDraftName(event.target.value)} required />
              <div className="profile-actions">
                <button type="submit" disabled={saving}>Guardar</button>
                <button type="button" className="outline" onClick={() => setEditing(false)}>Cancelar</button>
              </div>
            </form>
          ) : (
            <button type="button" className="outline profile-action" onClick={() => {
              setDraftName(displayName === fallback ? '' : displayName);
              setEditing(true);
              setFeedback('');
            }}>✎ Editar nombre</button>
          )}
          <button type="button" className="outline profile-action" onClick={() => { setMenuOpen(false); setDevicesOpen(true); }}>📱 Mis dispositivos</button>
          {feedback && <p className="profile-feedback" role="status">{feedback}</p>}
          <button type="button" className="profile-logout" onClick={() => void supabase.auth.signOut()}>
            Cerrar sesión
          </button>
        </div>
      )}
      {devicesOpen && <DeviceManager userId={userId} onClose={() => setDevicesOpen(false)} />}
    </div>
  );
}
