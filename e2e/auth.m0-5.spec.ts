/**
 * AUTH-E2E — Module 0.5 : Auth & Onboarding
 * Tests de la couche validation des routes API auth.
 * Ces scénarios n'exigent pas de connexion DB active : ils échouent
 * avant tout appel Supabase (validation + denylist en mémoire).
 */
import { test, expect } from '@playwright/test';

const SIGNUP_URL = '/api/auth/signup';
const LOGIN_URL = '/api/auth/login';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
const LOGOUT_URL = '/api/auth/logout';

const VALID_BODY = {
  email: 'contact@acme-traiteur.fr',
  mot_de_passe: 'MotDePasse123!',
  prenom: 'Alice',
  nom: 'Dupont',
  telephone: '+33600000000',
  type_profil: 'traiteur',
  raison_sociale: 'Acme Traiteur',
  acceptation_cgu: true,
};

// ── AUTH-E2E-1 : Email jetable → 422 ────────────────────────────────────────
test('AUTH-E2E-1 — signup email jetable retourne 422', async ({ request }) => {
  const res = await request.post(SIGNUP_URL, {
    data: { ...VALID_BODY, email: 'test@mailinator.com' },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error).toMatch(/jetable/i);
});

// ── AUTH-E2E-2 : Champ obligatoire manquant → 422 ───────────────────────────
test('AUTH-E2E-2 — signup sans prenom retourne 422', async ({ request }) => {
  const body = Object.fromEntries(
    Object.entries(VALID_BODY).filter(([k]) => k !== 'prenom'),
  );
  const res = await request.post(SIGNUP_URL, { data: body });
  expect(res.status()).toBe(422);
});

test('AUTH-E2E-2b — signup sans raison_sociale retourne 422', async ({
  request,
}) => {
  const body = Object.fromEntries(
    Object.entries(VALID_BODY).filter(([k]) => k !== 'raison_sociale'),
  );
  const res = await request.post(SIGNUP_URL, { data: body });
  expect(res.status()).toBe(422);
});

// ── AUTH-E2E-3 : CGU non acceptée → 422 ─────────────────────────────────────
test('AUTH-E2E-3 — signup sans acceptation CGU retourne 422', async ({
  request,
}) => {
  const res = await request.post(SIGNUP_URL, {
    data: { ...VALID_BODY, acceptation_cgu: false },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error).toMatch(/cgu/i);
});

// ── AUTH-E2E-4 : type_profil invalide → 422 ─────────────────────────────────
test('AUTH-E2E-4 — signup type_profil invalide retourne 422', async ({
  request,
}) => {
  const res = await request.post(SIGNUP_URL, {
    data: { ...VALID_BODY, type_profil: 'client_organisateur' },
  });
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error).toMatch(/type_profil/i);
});

// ── AUTH-E2E-5 : JSON malformé → 400 ────────────────────────────────────────
// Utilise fetch natif : request.post({ data: string }) sérialise en JSON valide,
// ce qui ne déclenche pas le catch de req.json(). Un corps réellement malformé
// (accolade non fermée) est nécessaire pour tester le 400.
test('AUTH-E2E-5 — signup JSON malformé retourne 400', async () => {
  const res = await fetch(`${BASE_URL}${SIGNUP_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  expect(res.status).toBe(400);
});

test('AUTH-E2E-5b — login JSON malformé retourne 400', async () => {
  const res = await fetch(`${BASE_URL}${LOGIN_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  expect(res.status).toBe(400);
});

// ── AUTH-E2E-6 : Login champs manquants → 422 ───────────────────────────────
test('AUTH-E2E-6 — login sans mot_de_passe retourne 422', async ({
  request,
}) => {
  const res = await request.post(LOGIN_URL, {
    data: { email: 'contact@acme-traiteur.fr' },
  });
  expect(res.status()).toBe(422);
});

// ── AUTH-E2E-7 : Logout sans session → 200 (idempotent) ─────────────────────
test('AUTH-E2E-7 — logout sans session retourne 200', async ({ request }) => {
  const res = await request.post(LOGOUT_URL);
  expect(res.status()).toBe(200);
});
