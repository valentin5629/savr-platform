/**
 * seed:jwt — génère un JWT de test par persona (dev only, jamais commité).
 *
 * Les tokens sont signés HS256 avec SUPABASE_JWT_SECRET (Dashboard Supabase →
 * Settings → API → JWT Secret) et portent exactement les claims lus par la RLS
 * (`role`, `organisation_id`, `organisation_type`, `app_domain`). Ils sont
 * équivalents à un token émis par le hook fn_custom_access_token, et acceptés
 * par PostgREST/supabase-js pour les tests E2E/HTTP.
 *
 * Sortie : `.env.seed-jwt` à la racine (couvert par .gitignore `.env.*`).
 */

import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadEnv, assertDev, connect } from './db.js';
import { seedUuid } from './uuid.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..');

// persona → slug user seedé
const PERSONAS: Record<string, string> = {
  jwt_admin: 'user_admin',
  jwt_ops1: 'user_ops1',
  jwt_ops2: 'user_ops2',
  jwt_commercial: 'user_commercial',
  jwt_manager_kaspia: 'user_manager_kaspia',
  jwt_collab_kaspia: 'user_collab_kaspia',
  jwt_manager_fleurdemets: 'user_manager_fleurdemets',
  jwt_gest_viparis: 'user_gest_viparis',
  jwt_gest_artsforains: 'user_gest_artsforains',
  jwt_agence_caromy: 'user_agence_caromy',
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const enc = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = b64url(createHmac('sha256', secret).update(enc).digest());
  return `${enc}.${sig}`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  assertDev(env);

  const secret = env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error(
      'seed:jwt — SUPABASE_JWT_SECRET manquant.\n' +
        'Ajoute-le à .env.local (Dashboard Supabase → Settings → API → JWT Secret) puis relance.',
    );
    process.exit(1);
  }

  const c = await connect(env);
  const lines: string[] = [
    '# Généré par `pnpm seed:jwt` — JAMAIS commité (.gitignore .env.*).',
    `# Personas seed_minimal — régénérer après reset du seed.`,
  ];
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + 60 * 60 * 24 * 30; // 30 jours
    for (const [persona, slug] of Object.entries(PERSONAS)) {
      const res = await c.query(
        `select u.id, u.role::text role, u.organisation_id, o.type::text otype
         from plateforme.users u join plateforme.organisations o on o.id = u.organisation_id
         where u.id = $1`,
        [seedUuid(slug)],
      );
      if (res.rowCount !== 1) {
        console.error(
          `  ⚠ persona ${persona} : user ${slug} introuvable (seed manquant ?)`,
        );
        continue;
      }
      const { id, role, organisation_id, otype } = res.rows[0];
      const token = signJwt(
        {
          sub: id,
          aud: 'authenticated',
          // `role` reste le rôle Postgres (PostgREST SET ROLE) ; le rôle métier
          // lu par la RLS va dans `user_role` (auth.jwt()->>'user_role'), comme le hook.
          role: 'authenticated',
          user_role: role,
          organisation_id,
          organisation_type: otype,
          app_domain: 'plateforme',
          iss: 'savr-seed',
          iat: nowSec,
          exp,
        },
        secret,
      );
      lines.push(`${persona.toUpperCase()}=${token}`);
      console.log(`  ✅ ${persona} (${role})`);
    }
  } finally {
    await c.end();
  }

  const out = resolve(REPO_ROOT, '.env.seed-jwt');
  writeFileSync(out, lines.join('\n') + '\n', 'utf8');
  console.log(
    `\nseed:jwt — ${Object.keys(PERSONAS).length} personas → .env.seed-jwt ✅`,
  );
}

main().catch((err) => {
  console.error('[seed:jwt] erreur :', err.message);
  process.exit(1);
});
