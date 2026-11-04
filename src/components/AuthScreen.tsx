import { useState, type FormEvent } from 'react';
import { supabase } from '../infrastructure/supabaseClient';
import { assessPassword, MIN_PASSWORD_LENGTH } from '../domain/passwordPolicy';
import { CalendarDays, ClipboardCheck, Eye, EyeOff, FolderKanban, LockKeyhole, Mail, UserRoundPlus, ArrowLeft, KeyRound, UserRound } from 'lucide-react';
import { FIELD_LIMITS, validateEmail } from '../domain/formValidation';

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
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [notice, setNotice] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);

  const isResetting = resetMode;
  const isRecovering = mode === 'forgot' && !isResetting;
  const isRegistering = mode === 'register' && !isResetting;
  const isCreatingPassword = isRegistering || isResetting;
  const passwordAssessment = assessPassword(password, email);
  const emailError = emailTouched ? validateEmail(email) : null;
  const confirmError = confirmPassword.length > 0 && password !== confirmPassword;
  const passwordError = passwordTouched && isCreatingPassword && password.length > 0 && !passwordAssessment.valid;
  const passwordProgress = passwordAssessment.valid ? 100 : Math.min(80, Math.round((password.length / MIN_PASSWORD_LENGTH) * 65));

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword('');
    setConfirmPassword('');
    setFeedback('');
    setNotice(false);
    setShowPassword(false);
    setEmailTouched(false);
    setPasswordTouched(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    setNotice(false);
    setEmailTouched(true);
    setPasswordTouched(true);

    try {
      if (!isResetting) {
        const emailValidationError = validateEmail(email);
        if (emailValidationError) throw new Error(emailValidationError);
      }
      if (!isRecovering && password.length > FIELD_LIMITS.password) {
        throw new Error(`La contraseña supera el límite de ${FIELD_LIMITS.password} caracteres.`);
      }
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
        if (fullName.trim().length < 2 || fullName.trim().length > 50) throw new Error('Escribe tu nombre (2 a 50 caracteres).');
        if (password !== confirmPassword) {
          throw new Error('Las contraseñas no coinciden.');
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin + window.location.pathname, data: { display_name: fullName.trim() } },
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

  const formTitle = isResetting ? 'Nueva contraseña' : isRecovering ? 'Recuperar contraseña'
    : isRegistering ? 'Crear cuenta' : 'Iniciar sesión';
  const subtitle = isResetting ? 'Define una contraseña nueva para recuperar el acceso.'
    : isRecovering ? 'Te enviaremos un enlace de recuperación a tu correo electrónico.'
    : isRegistering ? 'Crea tu cuenta y comienza a organizar tus pendientes y proyectos.'
    : 'Organiza tus pendientes y proyectos desde cualquier dispositivo.';

  return (
    <main className={`auth-page auth-mode-${isResetting ? 'reset' : mode}`}>
      <section className={feedback && !notice ? 'auth-card auth-error-shake' : 'auth-card'}>
        {isRecovering || isRegistering || isResetting ? (
          <>
            <button type="button" className="auth-back" onClick={() => changeMode('login')}
              disabled={isResetting} aria-label="Volver al inicio de sesión"><ArrowLeft size={20}/></button>
            <div className="auth-mode-icon" aria-hidden="true">
              {isRecovering ? <Mail size={31}/> : isResetting ? <KeyRound size={31}/> : <UserRoundPlus size={31}/>}
            </div>
          </>
        ) : (
          <img className="auth-brand-logo" src="/orbit-tasks/orbit-approved.webp" alt="Logo Orbit Tasks" />
        )}
        <h1>{formTitle}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {mode === 'login' && !isResetting && <div className="auth-feature-icons" aria-hidden="true">
          <CalendarDays/><ClipboardCheck/><FolderKanban/>
        </div>}
        <form onSubmit={(event) => void handleSubmit(event)}>
          {isRegistering && <div className="auth-control">
            <label htmlFor="full-name">Nombre</label>
            <div className="auth-field"><UserRound size={18} aria-hidden="true"/>
              <input id="full-name" value={fullName} maxLength={50} minLength={2} required autoComplete="name"
                placeholder="Tu nombre" spellCheck={true}
                onChange={(event) => setFullName(event.target.value.slice(0,50))}/></div>
            <small className="auth-character-counter">{fullName.length}/50 caracteres</small>
          </div>}
          {!isResetting && (
            <div className="auth-control">
              <label htmlFor="email">Correo electrónico</label>
              <div className="auth-field"><Mail size={18} aria-hidden="true"/>
                <input id="email" type="email" inputMode="email" autoCapitalize="none" spellCheck={false}
                  placeholder="nombre@correo.com" autoComplete="email" maxLength={FIELD_LIMITS.email}
                  aria-invalid={!!emailError} aria-describedby="email-help" value={email}
                  onBlur={() => setEmailTouched(true)}
                  onChange={(event) => { setEmail(event.target.value.slice(0,FIELD_LIMITS.email)); setFeedback(''); }} required/>
              </div>
              <div className="auth-email-feedback">
                <span id="email-help" className={emailError ? 'field-error' : 'field-help'} role={emailError ? 'alert' : undefined}>
                  {emailError || `Máximo ${FIELD_LIMITS.email} caracteres.`}
                </span>
                <span className="auth-character-counter">{email.length}/{FIELD_LIMITS.email}</span>
              </div>
            </div>
          )}
          {!isRecovering && (
            <div className="auth-control">
              <label htmlFor="password">{isResetting ? 'Nueva contraseña' : 'Contraseña'}</label>
              <div className="auth-field auth-password-field">
                <LockKeyhole size={18} aria-hidden="true"/><input id="password" type={showPassword ? 'text' : 'password'}
                  minLength={isCreatingPassword ? MIN_PASSWORD_LENGTH : undefined}
                  maxLength={FIELD_LIMITS.password}
                  placeholder={isCreatingPassword ? 'Mínimo 15 caracteres' : 'Ingresa tu contraseña'}
                  autoComplete={isResetting || isRegistering ? 'new-password' : 'current-password'}
                  aria-invalid={!!passwordError} aria-describedby={isCreatingPassword ? 'password-requirements' : undefined}
                  value={password} onBlur={() => setPasswordTouched(true)}
                  onChange={(event) => { setPassword(event.target.value); setFeedback(''); }}
                  style={{ paddingRight: '3.6rem', width: '100%' }} required/>
                <button type="button" className="auth-password-toggle"
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={19} aria-hidden="true"/> : <Eye size={19} aria-hidden="true"/>}
                </button>
              </div>
            </div>
          )}
          {isCreatingPassword && <>
            <div id="password-requirements" className="password-strength" aria-label="Requisitos de contraseña">
              <div className="password-strength-track"><div className={passwordAssessment.valid ? 'password-strength-value valid' : 'password-strength-value'}
                style={{width: `${passwordProgress}%`}}/></div>
              <small>{passwordAssessment.valid ? 'Requisitos cumplidos' : 'La contraseña debe tener al menos 15 caracteres.'}</small>
            </div>
            <p className="muted auth-password-hint" role="status">{passwordAssessment.length} caracteres · {passwordAssessment.message}
              {' '}No reutilices contraseñas de otros servicios.</p>
            <div className="auth-control">
              <label htmlFor="confirm-password">Confirmar contraseña</label>
              <div className="auth-field"><LockKeyhole size={18} aria-hidden="true"/>
                <input id="confirm-password" placeholder="Repite tu contraseña"
                  type={showPassword ? 'text' : 'password'} maxLength={FIELD_LIMITS.password}
                  aria-invalid={confirmError} aria-describedby="confirm-password-help"
                  autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)} required/>
              </div>
              <p id="confirm-password-help" className={confirmError ? 'field-error' : 'field-help'} role={confirmError ? 'alert' : undefined}>
                {confirmError ? 'Las contraseñas no coinciden.' : 'Confirma la misma contraseña para continuar.'}
              </p>
            </div>
          </>}
          <button className={`auth-submit auth-submit-${isResetting ? 'reset' : mode}`}
            type="submit" disabled={busy || (isCreatingPassword && (!passwordAssessment.valid || password !== confirmPassword))}>
            {busy ? 'Procesando…' : isResetting ? 'Guardar nueva contraseña'
              : isRecovering ? 'Enviar enlace de recuperación' : isRegistering ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </form>
        {feedback && <p className={notice ? 'feedback' : 'error'} role="status">{feedback}</p>}
        {!isResetting && <>
          {mode === 'login' && <>
            <button type="button" className="auth-create-button" onClick={() => changeMode('register')}>
              <UserRoundPlus size={17} aria-hidden="true"/> Crear cuenta
            </button>
            <button className="text-button" type="button" onClick={() => changeMode('forgot')}>¿Olvidaste tu contraseña?</button>
          </>}
          {mode !== 'login' && <button className="text-button" type="button"
            onClick={() => changeMode('login')}>Volver a iniciar sesión</button>}
        </>}
      </section>
    </main>
  );
}
