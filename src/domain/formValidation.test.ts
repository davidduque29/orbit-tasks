import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS, validateEmail, validateRequiredText,
  validateOptionalText, validateEventFields,
} from './formValidation';

describe('Orbit Tasks form validation', () => {
  it('accepts a normal email and rejects malformed and overlong input', () => {
    expect(validateEmail('  persona@correo.com  ')).toBeNull();
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
    expect(validateEventFields('Reunión', 'Nota', '2026-11-04T10:30')).toBeNull();
    expect(validateRequiredText('Prueba\u0001', 'título', 50)).toMatch(/no permitidos/);
  });
});
