/**
 * Single source of truth for password rules across signup, sign-in,
 * password reset and invitation acceptance.
 *
 * Length only — no character-class requirements, so "family1" is valid.
 */
export const PASSWORD_MIN_LENGTH = 6;

export const PASSWORD_HINT = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_HINT;
  return null;
}
