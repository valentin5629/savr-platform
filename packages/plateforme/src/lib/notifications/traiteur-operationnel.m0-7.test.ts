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
  instantReferenceAnnulation,
  notifierTraiteurOperationnel,
  notifierProgrammateurTiers,
  notifierAdminAnnulation,
  adresseLieu,
} from './traiteur-operationnel.js';
import { instantParis } from '@savr/shared/src/temps/index.js';

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
  comptes?: Record<string, Record<string, unknown>>; // users par id
  flux?: Array<Record<string, unknown>>;
}

let filtresIn: Array<[string, string, unknown]> = [];

function makeSupabase(fx: Fixture) {
  function builder(table: string) {
    let select = '';
    let id: unknown;
    const b = {
      select: (s: string) => {
        select = s;
        return b;
      },
      eq: (col: string, v: unknown) => {
        if (col === 'id') id = v;
        return b;
      },
      in: (col: string, v: unknown) => {
        filtresIn.push([table, col, v]);
        return b;
      },
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
          return Promise.resolve({
            data: fx.comptes?.[String(id)] ?? fx.userNom ?? null,
          });
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
    pax: 300,
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
    ville: 'Paris',
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
  filtresIn = [];
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
  it('tiers non-shadow → collecte_programmee_tiers aux seuls managers (Val 2026-10-29)', async () => {
    await notifierTraiteurOperationnel(
      makeSupabase({
        ...BASE,
        // La requête filtre sur le rôle : le mock rend ce que la base rendrait.
        equipe: [BASE.equipe![0]!],
        comptes: {
          'u-prog': { prenom: 'Zoé', nom: 'Durand', role: 'agence' },
        },
      }),
      {
        collecteId: 'col-1',
        acteurOrgId: 'org-agence',
        changement: { kind: 'programmation', programmeurUserId: 'u-prog' },
      },
    );
    expect(emails).toHaveLength(1);
    expect(emails[0]!.slug).toBe('collecte_programmee_tiers');
    expect(emails[0]!.to).toBe('manager@traiteur.fr');
    // La base ne rend que les managers : les commerciaux ne sont pas demandés.
    expect(filtresIn).toContainEqual(['users', 'role', ['traiteur_manager']]);
    const v = emails[0]!.variables;
    expect(v['organisation_programmatrice']).toBe('Agence Caromy');
    expect(v['programmeur_nom']).toBe('Zoé Durand');
    expect(v['type_collecte']).toBe('Zéro Déchet');
    expect(v['date_collecte']).toBe('20/07/2026');
    expect(v['horaire_collecte']).toBe('18:00');
    expect(v['lieu_adresse']).toBe('1 rue X, 75001 Paris');
    expect(v).not.toHaveProperty('flux_list');
    expect(v['lien_collecte']).toContain('/traiteur/collectes/col-1');
  });

  it('textes saisis neutralisés (nom du lieu, de l’organisation)', async () => {
    await notifierTraiteurOperationnel(
      makeSupabase({
        ...BASE,
        orgNom: { nom: 'A & <B>' },
        lieu: { ...BASE.lieu, nom: 'Salle <i>' },
      }),
      {
        collecteId: 'col-1',
        acteurOrgId: 'org-agence',
        changement: { kind: 'programmation' },
      },
    );
    const v = emails[0]!.variables;
    expect(v['organisation_programmatrice']).toBe('A &amp; &lt;B&gt;');
    expect(v['lieu_nom']).toBe('Salle &lt;i&gt;');
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

  it('aucun manager → aucun envoi', async () => {
    await notifierTraiteurOperationnel(makeSupabase({ ...BASE, equipe: [] }), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: { kind: 'programmation' },
    });
    expect(emails).toHaveLength(0);
  });
});

// Template 21 : le programmateur d'une agence ou d'un gestionnaire de lieux,
// plus personne côté traiteur (Val 2026-10-28).
const TIERS: Fixture = {
  ...BASE,
  evenement: {
    traiteur_operationnel_organisation_id: 'org-traiteur',
    lieu_id: 'lieu-1',
    nom_evenement: 'Gala <2026>',
    created_by: 'u-prog',
  },
  orgNom: { nom: 'Traiteur Réel' },
  comptes: {
    'u-prog': {
      email: 'zoe@agence.fr',
      prenom: 'Zoé',
      nom: 'Durand',
      role: 'agence',
      organisation_id: 'org-agence',
      actif: true,
      deleted_at: null,
    },
    'u-collegue': {
      prenom: 'Hugo',
      nom: 'Petit',
      role: 'agence',
      organisation_id: 'org-agence',
    },
    'u-traiteur': {
      prenom: 'Marie',
      nom: 'Leroy',
      role: 'traiteur_manager',
      organisation_id: 'org-traiteur',
    },
    'u-admin': { prenom: 'Val', nom: 'L', role: 'admin_savr' },
  },
};

describe('M0.7/bl-p2-22-emission-modification — template 21', () => {
  const LISTE = '<ul><li>Heure de collecte : de 18h00 à 19h00</li></ul>';

  it('modification par un collègue → le programmateur reçoit la liste avant / après', async () => {
    await notifierProgrammateurTiers(makeSupabase(TIERS), {
      collecteId: 'col-1',
      acteurUserId: 'u-collegue',
      listeModifications: LISTE,
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.slug).toBe('collecte_modifiee_tiers');
    expect(emails[0]!.to).toBe('zoe@agence.fr');
    const v = emails[0]!.variables;
    expect(v['type_changement_libelle']).toBe('modifiée');
    expect(v['est_modification']).toBe('true');
    expect(v['est_annulation']).toBe('');
    expect(v['liste_modifications']).toBe(LISTE);
    expect(v['nom_evenement']).toBe('Gala &lt;2026&gt;');
    expect(v['traiteur_nom']).toBe('Traiteur Réel');
    expect(v['auteur_nom']).toBe('Hugo Petit');
    expect(v['date_collecte']).toBe('20/07/2026');
    expect(v['heure_collecte']).toBe('18:00');
    expect(v['lien_collecte']).toContain('/agence/collectes/col-1');
  });

  it('modification par le programmateur lui-même → aucun envoi', async () => {
    await notifierProgrammateurTiers(makeSupabase(TIERS), {
      collecteId: 'col-1',
      acteurUserId: 'u-prog',
      listeModifications: LISTE,
    });
    expect(emails).toHaveLength(0);
  });

  it('programmateur côté traiteur → aucun envoi', async () => {
    await notifierProgrammateurTiers(
      makeSupabase({
        ...TIERS,
        comptes: {
          ...TIERS.comptes,
          'u-prog': {
            ...TIERS.comptes!['u-prog'],
            role: 'traiteur_commercial',
            organisation_id: 'org-traiteur',
          },
        },
      }),
      {
        collecteId: 'col-1',
        acteurUserId: 'u-collegue',
        listeModifications: LISTE,
      },
    );
    expect(emails).toHaveLength(0);
  });

  it('modification par l’équipe Savr : auteur « l’équipe Savr »', async () => {
    await notifierProgrammateurTiers(makeSupabase(TIERS), {
      collecteId: 'col-1',
      acteurUserId: 'u-admin',
      listeModifications: LISTE,
    });
    expect(emails[0]!.variables['auteur_nom']).toBe("l'équipe Savr");
  });

  it('liste vide (rien de visible n’a changé) → aucun envoi', async () => {
    await notifierProgrammateurTiers(makeSupabase(TIERS), {
      collecteId: 'col-1',
      acteurUserId: 'u-collegue',
      listeModifications: '',
    });
    expect(emails).toHaveLength(0);
  });
});

describe('adresseLieu (pure)', () => {
  it('adresse, code postal et ville', () => {
    expect(
      adresseLieu({
        adresse_acces: '1 rue X',
        code_postal: '75001',
        ville: 'Paris',
      }),
    ).toBe('1 rue X, 75001 Paris');
    expect(adresseLieu({ adresse_acces: null, ville: 'Lyon' })).toBe('Lyon');
  });
});

describe('M0.7/bl-p2-22-emission-admin-annulee — template 22', () => {
  it('envoi admin_collecte_annulee à contact@gosavr.io avec annulation_tardive calculée', async () => {
    // créneau très proche → tardive true
    await notifierAdminAnnulation(makeSupabase(BASE), {
      collecteId: 'col-1',
      organisationNom: 'Traiteur Réel',
      dateCollecte: '2026-07-20',
      heureCollecte: '18:00:00',
      lieuNom: 'Salle des fêtes',
      acteurUserId: 'user-x',
      acteurRole: 'agence',
      nowMs: instantParis('2026-07-20', '15:00').getTime(), // 3h avant (Paris) → tardive
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.slug).toBe('admin_collecte_annulee');
    expect(emails[0]!.to).toBe('contact@gosavr.io');
    const v = emails[0]!.variables;
    expect(v['annulation_tardive']).toBe('true');
    expect(v['delai_avant_creneau']).toBe('moins de 4 h');
    expect(v['organisation_nom']).toBe('Traiteur Réel');
    expect(v['lien_backoffice']).toContain('/admin/collectes/col-1');
    // Nombre de pax de la collecte (Val 2026-10-29).
    expect(v['nombre_pax']).toBe('300');
  });

  it('annulation à 8h du créneau : annulation_tardive false, délai « 4h ou plus »', async () => {
    await notifierAdminAnnulation(makeSupabase(BASE), {
      collecteId: 'col-1',
      organisationNom: 'Traiteur Réel',
      dateCollecte: '2026-07-20',
      heureCollecte: '18:00:00',
      acteurUserId: 'user-x',
      acteurRole: 'agence',
      nowMs: instantParis('2026-07-20', '10:00').getTime(), // 8h avant (Paris)
    });
    const v = emails[0]!.variables;
    expect(v['annulation_tardive']).toBe('');
    expect(v['delai_avant_creneau']).toBe('4 h ou plus');
  });

  it('demande du client à 8h du créneau, confirmée par l’Admin à 3h : jugée à la demande, pas tardive', async () => {
    await notifierAdminAnnulation(makeSupabase(BASE), {
      collecteId: 'col-1',
      organisationNom: 'Traiteur Réel',
      dateCollecte: '2026-07-20',
      heureCollecte: '18:00:00',
      acteurUserId: 'admin-1',
      acteurRole: 'admin_savr',
      statutAvant: 'annulation_demandee',
      annulationDemandeeAt: instantParis('2026-07-20', '10:00').toISOString(),
      nowMs: instantParis('2026-07-20', '15:00').getTime(),
    });
    const v = emails[0]!.variables;
    expect(v['annulation_tardive']).toBe('');
    expect(v['delai_avant_creneau']).toBe('4 h ou plus');
  });
});

// Décision Val 2026-10-15 : « le délai compte à partir du moment où le client
// l'a demandé, pas le moment où l'admin l'a annulé ».
describe('instantReferenceAnnulation (pure)', () => {
  const demande = '2026-07-20T08:00:00.000Z';
  const maintenant = Date.parse('2026-07-20T13:00:00.000Z');
  it('demande d’annulation confirmée → instant de la demande', () => {
    expect(
      instantReferenceAnnulation('annulation_demandee', demande, maintenant),
    ).toBe(Date.parse(demande));
  });
  it('annulation directe (autre statut quitté) → maintenant, même si une ancienne demande est datée', () => {
    expect(instantReferenceAnnulation('validee', demande, maintenant)).toBe(
      maintenant,
    );
  });
  it('demande sans heure enregistrée ou illisible → maintenant', () => {
    expect(
      instantReferenceAnnulation('annulation_demandee', null, maintenant),
    ).toBe(maintenant);
    expect(
      instantReferenceAnnulation(
        'annulation_demandee',
        'pas une date',
        maintenant,
      ),
    ).toBe(maintenant);
  });
});

describe('M0.7/bl-p2-22-annulation-tardive — estAnnulationTardive (pure)', () => {
  const creneau = '2026-07-20';
  const heure = '18:00:00';
  // Seuil 4h, strict (décision Val 2026-10-15), comme le trigger SQL de débit.
  it('3h59 avant le créneau → true', () => {
    expect(
      estAnnulationTardive(
        creneau,
        heure,
        instantParis('2026-07-20', '14:01').getTime(),
      ),
    ).toBe(true);
  });
  it('4h pile avant le créneau → false (strict)', () => {
    expect(
      estAnnulationTardive(
        creneau,
        heure,
        instantParis('2026-07-20', '14:00').getTime(),
      ),
    ).toBe(false);
  });
  it('8h avant le créneau (tardive sous l’ancien seuil de 12h) → false', () => {
    expect(
      estAnnulationTardive(
        creneau,
        heure,
        instantParis('2026-07-20', '10:00').getTime(),
      ),
    ).toBe(false);
  });
  it('date vide → false (jamais de faux positif)', () => {
    expect(estAnnulationTardive('', heure, Date.now())).toBe(false);
  });
});

// Régression du 2026-09-24 : le correctif « plus jamais de lien relatif » avait
// d'abord fait LEVER ces notifications quand `NEXT_PUBLIC_APP_URL` manque. Or
// leurs appelants les lancent en `void notifier…(…)` : l'exception serait
// devenue un rejet de promesse non géré, et une programmation de collecte serait
// tombée à cause d'une variable d'environnement absente. On trace, on ne lève pas.
describe('M0.7 — une variable d’environnement absente ne fait pas tomber une notification', () => {
  const ENV = process.env['NEXT_PUBLIC_APP_URL'];
  afterEach(() => {
    if (ENV === undefined) delete process.env['NEXT_PUBLIC_APP_URL'];
    else process.env['NEXT_PUBLIC_APP_URL'] = ENV;
  });

  it("sans NEXT_PUBLIC_APP_URL, l'email part quand même — c'est le LIEN qui est dégradé, pas l'envoi", async () => {
    delete process.env['NEXT_PUBLIC_APP_URL'];

    await expect(
      notifierTraiteurOperationnel(makeSupabase(BASE), {
        collecteId: 'col-1',
        acteurOrgId: 'org-agence',
        changement: { kind: 'programmation', programmeurUserId: null },
      }),
    ).resolves.not.toThrow();

    expect(emails).toHaveLength(2);
  });

  it('avec la variable, le lien de l’email est absolu', async () => {
    process.env['NEXT_PUBLIC_APP_URL'] = 'https://app.gosavr.io';

    await notifierTraiteurOperationnel(makeSupabase(BASE), {
      collecteId: 'col-1',
      acteurOrgId: 'org-agence',
      changement: { kind: 'programmation', programmeurUserId: null },
    });

    const variables = emails[0]?.variables ?? {};
    const lien = Object.values(variables).find((v) =>
      v.includes('/traiteur/collectes/col-1'),
    );
    expect(lien, `variables: ${Object.keys(variables).join(', ')}`).toBe(
      'https://app.gosavr.io/traiteur/collectes/col-1',
    );
  });
});
