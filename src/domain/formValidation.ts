/** Business limits for the Orbit Tasks forms (client-side UX validation). */
export const FIELD_LIMITS = {
  email: 50,
  password: 256,
  eventTitle: 50,
  eventDescription: 200,
  taskTitle: 50,
  taskDescription: 200,
  projectName: 80,
  projectDescription: 300,
} as const;

const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Ingresa tu correo electrónico.';
  if (email.length > FIELD_LIMITS.email) return `El correo no puede superar ${FIELD_LIMITS.email} caracteres.`;
  if (/\s/.test(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return 'Ingresa un correo válido, por ejemplo, nombre@correo.com.';
  }
  const [local, domain] = email.split('@');
  if (local.length > 64 || !domain || domain.length > 253 || domain.split('.').some(part => !part || part.length > 63)) {
    return 'Revisa la longitud y el dominio del correo electrónico.';
  }
  return null;
}

export function validateRequiredText(value: string, label: string, max: number, min = 2): string | null {
  const text = value.trim();
  if (CONTROL_CHARACTER.test(text)) return `El campo ${label} contiene caracteres no permitidos.`;
  if (text.length < min) return `El campo ${label} debe tener al menos ${min} caracteres.`;
  if (text.length > max) return `El campo ${label} admite máximo ${max} caracteres.`;
  return null;
}

export function validateOptionalText(value: string, label: string, max: number): string | null {
  if (CONTROL_CHARACTER.test(value)) return `El campo ${label} contiene caracteres no permitidos.`;
  if (value.trim().length > max) return `El campo ${label} admite máximo ${max} caracteres.`;
  return null;
}

export function validateEventFields(title: string, description: string, date: string, now: Date = new Date(), allowWeekend = true): string | null {
  return validateRequiredText(title, 'título', FIELD_LIMITS.eventTitle, 4)
    ?? validateOptionalText(description, 'descripción', FIELD_LIMITS.eventDescription)
    ?? (!date || !Number.isFinite(new Date(date).getTime()) ? 'Selecciona una fecha y hora válidas.' : null)
    ?? (new Date(date).getTime() <= now.getTime() ? 'El evento debe programarse para una fecha y hora futuras.' : null)
    ?? (!allowWeekend && [0, 6].includes(new Date(date).getDay()) ? 'El día seleccionado es sábado o domingo. Confirma que quieres programarlo en fin de semana.' : null);
}
