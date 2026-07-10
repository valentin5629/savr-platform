/**
 * R23c — Config auth explicite (BL-P3-09) + slug reset_password (BL-P3-11).
 * =============================================================================
 * BL-P3-09 : les 3 paramètres CDC §09 (refresh 30j, OTP reset 1h, rate-limit 3/h)
 * étaient laissés au défaut Supabase implicite → on les fige explicitement dans
 * supabase/config.toml. Lecture du fichier (pas de DB) + assertions de chaînes.
 *
 * BL-P3-11 : le slug CDC §06.02 « reset_password » est aligné (ex
 * reinitialisation_mot_de_passe) et l'email de reset porte le contenu Savr brandé
 * via le recovery template GoTrue (config.toml + supabase/templates/recovery.html),
 * la délivrance restant GoTrue-native (§09). Arbitrage Val R23c.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function repoFile(rel: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)),
    'utf8',
  );
}

const CONFIG = repoFile('supabase/config.toml');
const RECOVERY = repoFile('supabase/templates/recovery.html');
const MIGRATION = repoFile(
  'supabase/migrations/20260710120000_plateforme_r23c_reset_password_slug.sql',
);

describe('M0.8-57 — Config auth : refresh 30j / OTP reset 1h / rate-limit 3/h figés (BL-P3-09)', () => {
  it('refresh token 30j : rotation activée + time-box session 720h (CDC §09 l.87/931)', () => {
    expect(CONFIG).toContain('enable_refresh_token_rotation = true');
    expect(CONFIG).toContain('[auth.sessions]');
    expect(CONFIG).toContain('timebox = "720h"');
  });

  it('OTP / lien de réinitialisation valide 1 heure = 3600 s (CDC §09 l.95)', () => {
    expect(CONFIG).toContain('otp_expiry = 3600');
  });

  it('rate-limit reset : 3 emails d’auth max par heure (CDC §09 l.96)', () => {
    expect(CONFIG).toContain('[auth.rate_limit]');
    expect(CONFIG).toContain('email_sent = 3');
  });

  it('la session JWT (access token) reste à 1 heure (non régressé)', () => {
    expect(CONFIG).toContain('jwt_expiry = 3600');
  });
});

describe('M0.8-59 — reset_password : recovery template GoTrue brandé + slug catalogue (BL-P3-11)', () => {
  it('config.toml : recovery template GoTrue avec objet Savr §06.02', () => {
    expect(CONFIG).toContain('[auth.email.template.recovery]');
    expect(CONFIG).toContain(
      'subject = "Réinitialisez votre mot de passe Savr"',
    );
    expect(CONFIG).toContain(
      'content_path = "./supabase/templates/recovery.html"',
    );
  });

  it('recovery.html : contenu Savr brandé §06.02, délivrance GoTrue (ConfirmationURL), sans prénom', () => {
    expect(RECOVERY).toContain(
      'Vous avez demandé la réinitialisation de votre mot de passe Savr.',
    );
    expect(RECOVERY).toContain('Ce lien est valide pendant 1 heure.');
    expect(RECOVERY).toContain('{{ .ConfirmationURL }}'); // variable GoTrue native
    expect(RECOVERY).toContain("L'équipe Savr");
    // Arbitrage Val : pas de personnalisation prénom (GoTrue n'a pas la variable).
    expect(RECOVERY).not.toContain('{{prenom}}');
    expect(RECOVERY).not.toContain('{{ .prenom }}');
  });

  it('migration : slug catalogue aligné reset_password (ex reinitialisation_mot_de_passe)', () => {
    expect(MIGRATION).toContain("code = 'reset_password'");
    expect(MIGRATION).toContain("WHERE code = 'reinitialisation_mot_de_passe'");
    expect(MIGRATION).toContain(
      "sujet = 'Réinitialisez votre mot de passe Savr'",
    );
  });
});
