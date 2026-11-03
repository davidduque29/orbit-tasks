import { useState, type FormEvent } from 'react';
import { supabase } from '../infrastructure/supabaseClient';

export function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');

    try {
      const { error } = registering
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          })
        : await supabase.auth.signInWithPassword({ email, password });

      if (error) throw error;
      if (registering) setFeedback('Cuenta solicitada. Revisa tu correo para confirmar el registro si corresponde.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Error de autenticación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="logo">✦</div>
        <h1>Orbit Tasks</h1>
        <p>Organiza proyectos, tareas y eventos desde cualquier dispositivo.</p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" minLength={6}
            autoComplete={registering ? 'new-password' : 'current-password'}
            value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button type="submit" disabled={busy}>
            {busy ? 'Procesando…' : registering ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </form>
        {feedback && <p className="feedback" role="status">{feedback}</p>}
        <button className="text-button" type="button"
          onClick={() => { setRegistering((value) => !value); setFeedback(''); }}>
          {registering ? 'Ya tengo una cuenta' : 'Crear una cuenta nueva'}
        </button>
      </section>
    </main>
  );
}
