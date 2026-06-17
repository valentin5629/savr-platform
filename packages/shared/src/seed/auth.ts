/**
 * seed:auth — crée les comptes Supabase Auth (`auth.users`) des personas seedés
 * pour permettre la connexion email/mot de passe dans l'UI (dev only).
 *
 *   tsx packages/shared/src/seed/auth.ts        # branché sur `pnpm seed:auth`
 *
 * Le seed métier (`seed:minimal` / `seed:demo`) ne crée QUE les profils
 * `plateforme.users`. Le login passe par Supabase Auth (`signInWithPassword`),
 * qui exige une ligne `auth.users` portant le MÊME id que le profil — sinon le
 * hook JWT `fn_custom_access_token` ne trouve pas le profil et n'injecte aucun
 * claim `role`/`organisation_id`.
 *
 * Ce script crée/met à jour, pour chaque persona `@savr-test.local`, une ligne
 * `auth.users` (mot de passe = SEED_PASSWORD, email confirmé) + l'identité email
 * associée. Idempotent : relançable après chaque reset du seed.
 *
 * ⚠ Prérequis manuel (une seule fois, côté Dashboard Supabase) :
 *   Settings → Auth → Hooks → "Custom Access Token" →
 *   plateforme.fn_custom_access_token
 * Sans ce hook, la connexion fonctionne mais le JWT ne porte pas le rôle
 * (gating middleware + RLS KO).
 */

import { loadEnv, assertDev, connect } from './db.js';
import { SEED_PASSWORD, SEED_EMAIL_DOMAIN } from './constants.js';

async function main(): Promise<void> {
  const env = loadEnv();
  assertDev(env); // garde-fou prod bloquant

  const client = await connect(env);
  try {
    // 1. auth.users — un compte par profil seed, id aligné sur plateforme.users.
    //    crypt()/gen_salt() vivent dans le schéma `extensions` sur Supabase.
    //    confirmed_at est GENERATED ALWAYS → jamais inséré.
    const users = await client.query(
      // Les colonnes de tokens (confirmation_token, recovery_token, etc.) DOIVENT
      // valoir '' et non NULL : GoTrue les scanne en string → un NULL fait échouer
      // tout login avec « Database error querying schema ».
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at,
         confirmation_token, recovery_token, email_change,
         email_change_token_new, email_change_token_current,
         phone_change, phone_change_token, reauthentication_token
       )
       SELECT
         '00000000-0000-0000-0000-000000000000',
         u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt($1, extensions.gen_salt('bf')),
         now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('prenom', u.prenom, 'nom', u.nom),
         now(), now(),
         '', '', '', '', '', '', '', ''
       FROM plateforme.users u
       WHERE u.email LIKE '%@' || $2
       ON CONFLICT (id) DO UPDATE SET
         encrypted_password = EXCLUDED.encrypted_password,
         email              = EXCLUDED.email,
         email_confirmed_at = COALESCE(auth.users.email_confirmed_at, EXCLUDED.email_confirmed_at),
         updated_at         = now()`,
      [SEED_PASSWORD, SEED_EMAIL_DOMAIN],
    );

    // 2. auth.identities — identité email requise par signInWithPassword.
    //    `email` est une colonne GENERATED (lower(identity_data->>'email')) →
    //    jamais insérée explicitement.
    await client.query(
      `INSERT INTO auth.identities (
         provider_id, user_id, identity_data, provider,
         last_sign_in_at, created_at, updated_at
       )
       SELECT
         u.id::text, u.id,
         jsonb_build_object(
           'sub', u.id::text, 'email', u.email,
           'email_verified', true, 'phone_verified', false
         ),
         'email', now(), now(), now()
       FROM plateforme.users u
       WHERE u.email LIKE '%@' || $1
       ON CONFLICT (provider_id, provider) DO UPDATE SET
         identity_data = EXCLUDED.identity_data,
         updated_at    = now()`,
      [SEED_EMAIL_DOMAIN],
    );

    console.log(
      `[seed:auth] ${users.rowCount} comptes auth.users prêts (mot de passe : ${SEED_PASSWORD}) ✅`,
    );
    console.log(
      `[seed:auth] rappel : activer le hook JWT « plateforme.fn_custom_access_token » dans le Dashboard Supabase (Settings → Auth → Hooks).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed:auth] échec :', err.message);
  process.exit(1);
});
