// Politique de mot de passe (CDC §09 « Règles de mot de passe », l.84-85) :
//  - 10 caractères minimum
//  - 1 majuscule + 1 chiffre + 1 caractère spécial obligatoires
// Validation APPLICATIVE (le plancher GoTrue config.toml = filet seul, il ne vérifie pas
// la complexité). Appelée au signup avant createUser.

export const PASSWORD_MIN_LENGTH = 10;

export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; error: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`,
    };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      ok: false,
      error: 'Le mot de passe doit contenir au moins une majuscule.',
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      ok: false,
      error: 'Le mot de passe doit contenir au moins un chiffre.',
    };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      ok: false,
      error: 'Le mot de passe doit contenir au moins un caractère spécial.',
    };
  }
  return { ok: true };
}
