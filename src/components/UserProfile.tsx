import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, UploadCloud, ChevronDown, UserRound } from 'lucide-react';
import { supabase } from '../infrastructure/supabaseClient';
import { DeviceManager } from './DeviceManager';

interface UserProfileProps {
  userId: string;
  email: string;
  embedded?: boolean;
  onAccountClick?: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || 'U').toLocaleUpperCase();
}

export function UserProfile({ userId, email, embedded = false, onAccountClick }: UserProfileProps) {
  const fallback = email.split('@')[0] || 'Usuario';
  const [displayName, setDisplayName] = useState(fallback);
  const [draftName, setDraftName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.from('profiles').select('display_name,avatar_path').eq('user_id', userId).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setFeedback('No se pudo cargar el perfil.');
        } else {
          if (data?.display_name && data.display_name !== 'Usuario') setDisplayName(data.display_name);
          const path = typeof data?.avatar_path === 'string' ? data.avatar_path : null;
          setAvatarPath(path);
          if (path) void supabase.storage.from('profile-avatars').createSignedUrl(path, 3600)
            .then(({data: signed,error: signError}) => {
              if (active && !signError && signed?.signedUrl) setAvatarUrl(signed.signedUrl);
            });
        }
      });
    return () => { active = false; };
  }, [userId]);

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const formats: Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    const extension = formats[file.type];
    if (!extension || file.size > 3 * 1024 * 1024 || file.size === 0) {
      setFeedback('Selecciona una foto JPG, PNG o WebP de hasta 3 MB.');
      return;
    }
    setUploadingAvatar(true);
    setFeedback('');
    const nextPath = `${userId}/${crypto.randomUUID()}.${extension}`;
    try {
      const storage = supabase.storage.from('profile-avatars');
      const {error: uploadError} = await storage.upload(nextPath, file, {contentType: file.type, upsert:false});
      if (uploadError) throw uploadError;
      const {data: updated, error: profileError} = await supabase.from('profiles')
        .update({avatar_path:nextPath,updated_at:new Date().toISOString()})
        .eq('user_id',userId).select('user_id').maybeSingle();
      if (profileError || !updated) {
        await storage.remove([nextPath]);
        throw profileError ?? new Error('No se encontró el perfil para guardar la foto.');
      }
      const {data: signed, error: signError} = await storage.createSignedUrl(nextPath,3600);
      if (signError) throw signError;
      const oldPath = avatarPath;
      setAvatarPath(nextPath);
      setAvatarUrl(signed.signedUrl);
      setFeedback('Fotografía actualizada.');
      if (oldPath && oldPath !== nextPath) void storage.remove([oldPath]);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : 'No se pudo cargar la fotografía.');
    } finally {setUploadingAvatar(false);}
  }

  const avatar = (large: boolean) => (
    <span className={large ? 'profile-avatar large' : 'profile-avatar'} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(displayName)}
    </span>
  );

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
    <div className={embedded ? "profile-root profile-embedded" : "profile-root"}>
      {!embedded && <button type="button" className="profile-trigger" aria-label={`Perfil de ${displayName}`} aria-haspopup="true" aria-expanded={menuOpen}
        onClick={() => setMenuOpen((current) => !current)}>
        {avatar(false)}
        <span className="profile-trigger-identity"><strong className="profile-trigger-name" title={displayName}>{displayName}</strong><small><UserRound size={13} aria-hidden="true"/> Mi cuenta</small></span>
        <ChevronDown size={16} className="profile-trigger-chevron" aria-hidden="true"/>
      </button>}
      {(embedded || menuOpen) && (
        <div className={embedded ? "profile-dropdown profile-inline" : "profile-dropdown"}>
          <div className="profile-heading">
            {avatar(true)}
            <div><strong>{displayName}</strong><small>{email}</small></div>
          </div>
          {(embedded || !onAccountClick) && <>
          <label className="profile-upload-action">
            <Camera size={17} aria-hidden="true" />
            {uploadingAvatar ? 'Cargando fotografía…' : 'Subir o cambiar fotografía'}
            <input aria-label="Subir fotografía de perfil" type="file" accept="image/jpeg,image/png,image/webp"
              disabled={uploadingAvatar} onChange={(event) => void uploadAvatar(event)} />
          </label>
          <small className="profile-upload-hint"><UploadCloud size={13} aria-hidden="true" /> JPG, PNG o WebP · Máximo 3 MB</small>
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
          </>}
          {!embedded && onAccountClick && <button type="button" className="outline profile-action" onClick={() => {setMenuOpen(false); onAccountClick();}}>⚙️ Mi cuenta</button> }
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
