/**
 * M0.7 / BL-P2-22 — Émission tiers → traiteur opérationnel (templates 20/21/22).
 * =============================================================================
 * Garde tiers-non-shadow (CDC §06.02 l.529/556) + choix du bon code au bon
 * déclencheur + non-envoi si garde KO. sendEmail capturé (sink) ; le contexte
 * (collecte→événement→traiteur op→lieu→équipe) vient d'un mock Supabase.
 * =============================================================================
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import {
  estTiersNonShadow,
  estAnnulationTardive,
  notifierTraiteurOperationnel,
  notifierAdminAnnulation,
} from './traiteur-operationnel.js';

// ── Mock Supabase chaînable ────────────────────────────────────────────────
// Répond selon (table, select). Les requêtes tableau (équipe, flux) sont
// résolues en awaitant le builder ; les mono-lignes via .maybeSingle().
interface Fixture {
  collecte?: Record<string, unknown> | null;
  evenement?: Record<string, unknown> | null;
  orgShadow?: Record<string, unknown> | null; // organisations select 'est_shadow'
  orgNom?: Record<string, unknown> | null; // organisations select 'nom'
  lieu?: Record<string, unknown> | null;
  equipe?: Array<Record<string, unknown>>; // users select incl. 'actif'
  userNom?: Record<string, unknown> | null; // users select 'prenom, nom'
  flux?: Array<Record<string, unknown>>;
}

function makeSupabase(fx: Fixture) {
  function builder(table: string) {
    let select = '';
    const b = {
      select: (s: string) => {
        select = s;
        return b;
      },
      eq: () => b,
      in: () => b,
      maybeSingle: () => {
        if (table === 'collectes')
          return Promise.resolve({ data: fx.collecte });
        if (table === 'evenements')
          return Promise.resolve({ data: fx.evenement });
        if (table === 'organisations')
          return Promise.resolve({
            data: select.includes('est_shadow') ? fx.orgShadow : fx.orgNom,
          });
        if (table === 'lieux') return Promise.resolve({ data: fx.lieu });
        if (table === 'users')
          return Promise.resolve({ data: fx.userNom ?? null });
        return Promise.resolve({ data: null });
      },
      // thenable pour les requêtes tableau (await direct)
      then: (resolve: (v: { data: unknown }) => void) => {
        if (table === 'users') return resolve({ data: fx.equipe ?? [] });
        if (table === 'collecte_flux') return resolve({ data: fx.flux ?? [] });
        return resolve({ data: [] });
      },
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as never;
}

const BASE: Fixture = {
  collecte: {
    date_collecte: '2026-07-20',
    heure_collecte: '18:00:00',
    type: 'zero_dechet',
    evenement_id: 'evt-1',
  },
  evenement: {
    traiteur_operationnel_organisation_id: 'org-traiteur',
    lieu_id: 'lieu-1',
  },
  orgShadow: { est_shadow: false },
  orgNom: { nom: 'Agence Caromy' },
  lieu: {
    nom: 'Salle des fêtes',
    adresse_acces: '1 rue X',
    code_postal: '75001',
  },
  equipe: [
    {
      email: 'manager@traiteur.fr',
      prenom: 'Marie',
      actif: true,
      deleted_at: null,
      role: 'traiteur_manager',
    },
    {
      email: 'com@traiteur.fr',
      prenom: 'Léo',
      actif: true,
      deleted_at: null,
      role: 'traiteur_commercial',
    },
  ],
  flux: [{ flux: { nom: 'Biodéchets' } }],
};

let emails: CapturedEmail[] = [];
beforeEach(() => {
  emails = [];
  setEmailCaptureSink((e) => emails.push(e));
});
afterEach(() => setEmailCaptureSink(null));

describe('M0.7/bl-p2-22-emission-garde — estTiersNonShadow (pure)', () => {
  it('tiers réel (org != traiteur op, non-shadow) → true', () => {
    expect(
      estTiersNonShadow({
        traiteurOpOrgId: 'T',
        acteurOrgId: 'A',
        traiteurOpEstShadow: false,
      }),
    ).toBe(true);
  });
  it('même org → false', () => {
    expect(
      estTiersNonShadow({
        traiteurOpOrgId: 'T',
        acteurOrgId: 'T',
        traiteurOpEstShadow: false,
      }),
    ).toBe(false);
  });
  it('traiteur op shadow → false', () => {
    expect(
      estTiersNonShadow({
        traiteurOpOrgId: 'T',
        acteurOrgId: 'A',
        traiteurOpEstShadow: true,
      }),
    ).toBe(false);
  });
  it('org manquante → false', () => {
    expect(
      estTiersNonShadow({
        traiteurOpOrgId: null,
        acteurOrgId: 'A',
        traiteurOpEstShadow: false,
      }),
    ).toBe(false);
  });
});

describe('M0.7/bl-p2-22-emission-programmation — template 20', () => {
  it('tiers non-shadow → envoi collecte_programmee_tiers à toute l’équipe', async () => {
    await notifierTraiteurOperationnel(makeSupabase(BASE), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: { kind: 'programmation', programmeurUserId: null },
    });
    expect(emails).toHaveLength(2);
    expect(emails.every((e) => e.slug === 'collecte_programmee_tiers')).toBe(
      true,
    );
    expect(emails.map((e) => e.to).sort()).toEqual([
      'com@traiteur.fr',
      'manager@traiteur.fr',
    ]);
    const v = emails[0]!.variables;
    expect(v['organisation_programmatrice']).toBe('Agence Caromy');
    expect(v['type_collecte']).toBe('Zéro Déchet');
    expect(v['flux_list']).toBe('Biodéchets');
    expect(v['lien_collecte']).toContain('/traiteur/collectes/col-1');
  });

  it('même org (traiteur programme sa propre collecte) → aucun envoi', async () => {
    await notifierTraiteurOperationnel(makeSupabase(BASE), {
      collecteId: 'col-1',
      acteurOrgId: 'org-traiteur', // == traiteur op
      changement: { kind: 'programmation' },
    });
    expect(emails).toHaveLength(0);
  });

  it('traiteur op shadow → aucun envoi (silencieux)', async () => {
    await notifierTraiteurOperationnel(
      makeSupabase({ ...BASE, orgShadow: { est_shadow: true } }),
      {
        collecteId: 'col-1',
        acteurOrgId: 'org-agence',
        changement: { kind: 'programmation' },
      },
    );
    expect(emails).toHaveLength(0);
  });

  it('équipe vide → aucun envoi', async () => {
    await notifierTraiteurOperationnel(makeSupabase({ ...BASE, equipe: [] }), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: { kind: 'programmation' },
    });
    expect(emails).toHaveLength(0);
  });
});

describe('M0.7/bl-p2-22-emission-modification — template 21', () => {
  it('modification par tiers → collecte_modifiee_tiers, branche modification', async () => {
    await notifierTraiteurOperationnel(makeSupabase(BASE), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: {
        kind: 'modification',
        champsModifies: ['date_collecte', 'pax'],
      },
    });
    expect(emails).toHaveLength(2);
    const v = emails[0]!.variables;
    expect(emails[0]!.slug).toBe('collecte_modifiee_tiers');
    expect(v['type_changement']).toBe('modification');
    expect(v['est_modification']).toBe('true');
    expect(v['est_annulation']).toBe('false');
    expect(v['type_changement_libelle']).toBe('modifiée');
    expect(v['diff_list']).toBe('date collecte, pax');
  });

  it('annulation par tiers → collecte_modifiee_tiers, branche annulation', async () => {
    await notifierTraiteurOperationnel(makeSupabase(BASE), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: { kind: 'annulation' },
    });
    expect(emails).toHaveLength(2);
    const v = emails[0]!.variables;
    expect(emails[0]!.slug).toBe('collecte_modifiee_tiers');
    expect(v['type_changement']).toBe('annulation');
    expect(v['est_annulation']).toBe('true');
    expect(v['est_modification']).toBe('false');
    expect(v['type_changement_libelle']).toBe('annulée');
  });
});

describe('M0.7/bl-p2-22-emission-admin-annulee — template 22', () => {
  it('envoi admin_collecte_annulee à hello@gosavr.io avec annulation_tardive calculée', async () => {
    // créneau très proche → tardive true
    await notifierAdminAnnulation(makeSupabase(BASE), {
      collecteId: 'col-1',
      collecteRef: 'col-1',
      organisationNom: 'Traiteur Réel',
      dateCollecte: '2026-07-20',
      heureCollecte: '18:00:00',
      lieuNom: 'Salle des fêtes',
      acteurUserId: 'user-x',
      acteurRole: 'agence',
      nowMs: new Date('2026-07-20T10:00:00').getTime(), // 8h avant → tardive
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.slug).toBe('admin_collecte_annulee');
    expect(emails[0]!.to).toBe('hello@gosavr.io');
    const v = emails[0]!.variables;
    expect(v['annulation_tardive']).toBe('true');
    expect(v['organisation_nom']).toBe('Traiteur Réel');
    expect(v['lien_backoffice']).toContain('/admin/collectes/col-1');
  });
});

describe('M0.7/bl-p2-22-annulation-tardive — estAnnulationTardive (pure)', () => {
  const creneau = '2026-07-20';
  const heure = '18:00:00';
  it('< 12h avant le créneau → true', () => {
    expect(
      estAnnulationTardive(
        creneau,
        heure,
        new Date('2026-07-20T10:00:00').getTime(),
      ),
    ).toBe(true);
  });
  it('> 12h avant le créneau → false', () => {
    expect(
      estAnnulationTardive(
        creneau,
        heure,
        new Date('2026-07-19T10:00:00').getTime(),
      ),
    ).toBe(false);
  });
  it('date vide → false (jamais de faux positif)', () => {
    expect(estAnnulationTardive('', heure, Date.now())).toBe(false);
  });
});
