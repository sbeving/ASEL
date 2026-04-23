import { z } from 'zod';

/**
 * Enterprise password policy — enforced wherever a user-chosen password
 * enters the system (seed, create-user, change-password).
 *
 *   - at least 10 characters
 *   - at least 3 of: lowercase, uppercase, digit, symbol
 *   - no whitespace at start/end (accidental paste)
 */
export const passwordSchema = z
  .string()
  .min(10, 'Le mot de passe doit faire au moins 10 caractères')
  .max(200, 'Le mot de passe est trop long')
  .refine((v) => v === v.trim(), 'Le mot de passe ne doit pas commencer/finir par un espace')
  .refine((v) => classCount(v) >= 3, {
    message: 'Le mot de passe doit contenir au moins 3 des 4 classes : minuscules, majuscules, chiffres, symboles',
  });

function classCount(v: string): number {
  let n = 0;
  if (/[a-z]/.test(v)) n++;
  if (/[A-Z]/.test(v)) n++;
  if (/[0-9]/.test(v)) n++;
  if (/[^A-Za-z0-9]/.test(v)) n++;
  return n;
}
