import { useState, type FormEvent } from 'react';
import { supabase } from '../infrastructure/supabaseClient';
import { assessPassword, MIN_PASSWORD_LENGTH } from '../domain/passwordPolicy';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';

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
  const isCreatingPassword = isRegistering || isResetting;
  const passwordAssessment = assessPassword(password, email);
  const passwordProgress = passwordAssessment.valid ? 100 : Math.min(80, Math.round((password.length / MIN_PASSWORD_LENGTH) * 65));

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
      if (isCreatingPassword && !passwordAssessment.valid) {
        throw new Error(passwordAssessment.message);
      }
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
        if (password !== confirmPassword) {
          throw new Error('Las contraseñas no coinciden.');
        }
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
      <section className={feedback && !notice ? 'auth-card auth-error-shake' : 'auth-card'}>
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
              <div className="auth-field"><Mail size={18} aria-hidden="true"/><input id="email" type="email" autoComplete="email" value={email}
                onChange={(event) => setEmail(event.target.value)} required /></div>
            </>
          )}

          {!isRecovering && (
            <>
              <label htmlFor="password">{isResetting ? 'Nueva contraseña' : 'Contraseña'}</label>
              <div className="auth-field auth-password-field">
                <LockKeyhole size={18} aria-hidden="true"/><input id="password" type={showPassword ? 'text' : 'password'} minLength={isCreatingPassword ? MIN_PASSWORD_LENGTH : undefined}
                  autoComplete={isResetting || isRegistering ? 'new-password' : 'current-password'}
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  style={{ paddingRight: '3.6rem', width: '100%' }} required />
                <button type="button" className="auth-password-toggle"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={19} aria-hidden="true"/> : <Eye size={19} aria-hidden="true"/>}
                </button>
              </div>
            </>
          )}

          {isCreatingPassword && (
            <div className="password-strength" aria-label="Progreso de requisitos de contraseña">
              <div className="password-strength-track"><div className={passwordAssessment.valid ? 'password-strength-value valid' : 'password-strength-value'} style={{width: `${passwordProgress}%`}} /></div>
              <small>{passwordAssessment.valid ? 'Requisitos de contraseña cumplidos' : 'Completa los requisitos de contraseña'}</small>
            </div>
          )}

          {isCreatingPassword && (
            <p className="muted" role="status" style={{ marginTop: '0.4rem', marginBottom: '0.8rem' }}>
              {passwordAssessment.length} caracteres · {passwordAssessment.message}
              {' '}No reutilices contraseñas de otros servicios.
            </p>
          )}

          {isCreatingPassword && (
            <>
              <label htmlFor="confirm-password">Confirmar contraseña</label>
              <input id="confirm-password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)} required />
              {confirmPassword && password !== confirmPassword && (
                <p className="error" role="alert">Las contraseñas no coinciden.</p>
              )}
            </>
          )}

          <button type="submit" disabled={busy || (isCreatingPassword && (!passwordAssessment.valid || password !== confirmPassword))}>
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
