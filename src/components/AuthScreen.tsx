import { useState, type FormEvent } from 'react';
import { supabase } from '../infrastructure/supabaseClient';

type AuthMode = 'login' | 'register' | 'forgot';

interface AuthScreenProps {
  resetMode?: boolean;
  onPasswordReset?: () => Promise<void>;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message === 'Invalid login credentials') {
    return 'Correo o contraseña incorrectos. Comprueba los datos o recupera tu contraseña.';
  }

  return cause instanceof Error ? cause.message : 'No pudimos completar la solicitud.';
}

export function AuthScreen({ resetMode = false, onPasswordReset }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [notice, setNotice] = useState(false);

  const isResetting = resetMode;
  const isRecovering = mode === 'forgot' && !isResetting;
  const isRegistering = mode === 'register' && !isResetting;

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setFeedback('');
    setNotice(false);
    setShowPassword(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    setNotice(false);

    try {
      if (isResetting) {
        if (password !== confirmPassword) {
          throw new Error('Las contraseñas no coinciden.');
        }

        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        if (onPasswordReset) {
          await onPasswordReset();
        }
        setPassword('');
        setConfirmPassword('');
        setFeedback('Contraseña actualizada. Ya puedes iniciar sesión con tu nueva clave.');
        setNotice(true);
      } else if (isRecovering) {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + window.location.pathname,
        });
        if (error) throw error;
        setFeedback('Si existe una cuenta con ese correo, recibirás un enlace para cambiar la contraseña. Revisa también correo no deseado.');
        setNotice(true);
      } else if (isRegistering) {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        setFeedback('Revisa tu correo para confirmar tu registro, si corresponde.');
        setNotice(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (cause) {
      setFeedback(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="logo">✦</div>
        <h1>Orbit Tasks</h1>
        <p>{isResetting
          ? 'Crea una nueva contraseña para proteger tu cuenta.'
          : isRecovering
            ? 'Te enviaremos un enlace para recuperar el acceso.'
            : 'Organiza proyectos, tareas y eventos desde cualquier dispositivo.'}</p>

        <form onSubmit={(event) => void handleSubmit(event)}>
          {!isResetting && (
            <>
              <label htmlFor="email">Correo electrónico</label>
              <input id="email" type="email" autoComplete="email" value={email}
                onChange={(event) => setEmail(event.target.value)} required />
            </>
          )}

          {!isRecovering && (
            <>
              <label htmlFor="password">{isResetting ? 'Nueva contraseña' : 'Contraseña'}</label>
              <div style={{ position: 'relative' }}>
                <input id="password" type={showPassword ? 'text' : 'password'} minLength={8}
                  autoComplete={isResetting || isRegistering ? 'new-password' : 'current-password'}
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  style={{ paddingRight: '3.6rem', width: '100%' }} required />
                <button type="button" className="text-button"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%',
                    transform: 'translateY(-50%)', margin: 0, padding: '0.4rem',
                    width: '2.5rem', height: '2.5rem' }}>
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </>
          )}

          {isResetting && (
            <>
              <label htmlFor="confirm-password">Confirmar nueva contraseña</label>
              <input id="confirm-password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" minLength={8} value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)} required />
            </>
          )}

          <button type="submit" disabled={busy}>
            {busy ? 'Procesando…' : isResetting ? 'Guardar nueva contraseña'
              : isRecovering ? 'Enviar enlace de recuperación'
                : isRegistering ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </form>
        {feedback && <p className={notice ? 'feedback' : 'error'} role="status">{feedback}</p>}
        {!isResetting && (
          <>
            {mode === 'login' && (
              <button className="text-button" type="button"
                onClick={() => changeMode('forgot')}>¿Olvidaste tu contraseña?</button>
            )}
            <button className="text-button" type="button"
              onClick={() => changeMode(isRegistering || isRecovering ? 'login' : 'register')}>
              {isRegistering || isRecovering ? 'Volver a iniciar sesión' : 'Crear una cuenta nueva'}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
