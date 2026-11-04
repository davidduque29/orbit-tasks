import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS, validateEmail, validateRequiredText,
  validateOptionalText, validateEventFields,
} from './formValidation';

describe('Orbit Tasks form validation', () => {
  it('uses the same compact limits for task and event text', () => {
    expect(FIELD_LIMITS.taskTitle).toBe(50);
    expect(FIELD_LIMITS.eventTitle).toBe(50);
    expect(FIELD_LIMITS.taskDescription).toBe(200);
    expect(FIELD_LIMITS.eventDescription).toBe(200);
  });
  it('accepts a normal email and rejects malformed and overlong input', () => {
    expect(validateEmail('  persona@correo.com  ')).toBeNull();
    expect(FIELD_LIMITS.email).toBe(50);
    expect(validateEmail(`${'a'.repeat(43)}@test.com`)).toMatch(/50 caracteres/);
    expect(validateEmail('sin-arroba')).toMatch(/correo válido/);
    expect(validateEmail('alguien@@correo.com')).not.toBeNull();
    expect(validateEmail('abc@correo..com')).not.toBeNull();
    expect(validateEmail('a'.repeat(245) + '@test.com')).not.toBeNull();
  });

  it('requires a meaningful title, max 50 for events', () => {
    expect(validateRequiredText(' ', 'título', FIELD_LIMITS.eventTitle)).not.toBeNull();
    expect(validateRequiredText('Reunión', 'título', FIELD_LIMITS.eventTitle)).toBeNull();
    expect(validateRequiredText('a'.repeat(51), 'título', FIELD_LIMITS.eventTitle)).toMatch(/máximo 50/);
  });

  it('enforces event description max 200, including pasted values', () => {
    expect(validateOptionalText('', 'descripción', FIELD_LIMITS.eventDescription)).toBeNull();
    expect(validateOptionalText('a'.repeat(200), 'descripción', FIELD_LIMITS.eventDescription)).toBeNull();
    expect(validateOptionalText('a'.repeat(201), 'descripción', FIELD_LIMITS.eventDescription)).toMatch(/máximo 200/);
  });

  it('rejects invalid dates and forbidden control chars', () => {
    expect(validateEventFields('Reunión', 'Nota', 'not-a-date')).toMatch(/fecha/);
    expect(validateEventFields('Reunión', 'Nota', '2026-11-04T10:30', new Date('2026-11-03T10:00:00'))).toBeNull();
    expect(validateEventFields('dd', '', '2026-11-04T10:30', new Date('2026-11-03T10:00:00'))).toMatch(/al menos 4/);
    expect(validateEventFields('Reunión', '', '2026-11-01T10:30', new Date('2026-11-03T10:00:00'))).toMatch(/futuras/);
    expect(validateEventFields('Reunión', '', '2026-11-07T10:30', new Date('2026-11-03T10:00:00'), false)).toMatch(/sábado o domingo/);
    expect(validateEventFields('Reunión', '', '2026-11-07T10:30', new Date('2026-11-03T10:00:00'), true)).toBeNull();
    expect(validateRequiredText('Prueba\u0001', 'título', 50)).toMatch(/no permitidos/);
  });
});
