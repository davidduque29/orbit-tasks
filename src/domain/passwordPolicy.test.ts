import { describe, expect, it } from 'vitest';
import { assessPassword, MIN_PASSWORD_LENGTH } from './passwordPolicy';

describe('password policy', () => {
  it('requires at least 15 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(15);
    expect(assessPassword('short-password').valid).toBe(false);
  });

  it('accepts a long passphrase without mandatory symbols', () => {
    expect(assessPassword('cuatro palabras poco habituales').valid).toBe(true);
  });

  it('blocks common credentials', () => {
    expect(assessPassword('123456789012345').valid).toBe(false);
  });

  it('rejects the account name in the password', () => {
    expect(assessPassword('miusuario-clave-larga', 'miusuario@example.com').valid).toBe(false);
  });

  it('accepts long random-looking passwords', () => {
    expect(assessPassword('Zy7!k2-Bv9#hR4@q').valid).toBe(true);
  });
});
