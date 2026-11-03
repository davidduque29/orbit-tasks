export const MIN_PASSWORD_LENGTH = 15;

const BLOCKED_PASSWORDS = new Set([
  'password', 'password123', '123456789012345', 'qwerty123456789',
  'contraseña', 'contraseña123', 'administrador', 'admin123456789',
  'orbit-tasks', 'orbittasks', 'iloveyou', 'letmein',
]);

export interface PasswordAssessment {
  length: number;
  valid: boolean;
  message: string;
}

export function assessPassword(password: string, email = ''): PasswordAssessment {
  const length = Array.from(password).length;
  if (length < MIN_PASSWORD_LENGTH) {
    return { length, valid: false, message: `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }

  const lowercase = password.toLocaleLowerCase();
  const normalized = lowercase.replace(/[\s._-]/g, '');
  const emailPrefix = email.split('@')[0]?.toLocaleLowerCase().replace(/[\s._-]/g, '');

  if (BLOCKED_PASSWORDS.has(lowercase) || BLOCKED_PASSWORDS.has(normalized)) {
    return { length, valid: false, message: 'Esta contraseña es demasiado conocida o predecible.' };
  }

  if (emailPrefix && emailPrefix.length >= 4 && normalized.includes(emailPrefix)) {
    return { length, valid: false, message: 'No incluyas tu nombre de usuario o correo en la contraseña.' };
  }

  return {
    length,
    valid: true,
    message: 'Longitud válida. Usa una contraseña única, preferiblemente generada por un gestor.',
  };
}
