/**
 * M3.1 / §06.02 n°19 — email de modification d'une collecte (email_modification_*).
 * =============================================================================
 * Constat E2E de Val, 2026-10-09 : un traiteur change la date, le pax et le
 * contact d'une collecte ; l'email reçu par l'équipe Savr ne citait que
 * « date_collecte ». Vérifie, sans DB (corps lu dans la migration + moteur
 * d'interpolation réel) :
 *   - une ligne par champ réellement modifié, ancienne puis nouvelle valeur ;
 *   - l'email rendu pour le cas de Val, mot pour mot ;
 *   - les blocs conditionnels (pax, lieu, programmateur, ligne ATTENTION, lien
 *     vers la fiche) ;
 *   - l'échappement de tout texte saisi par un utilisateur ;
 *   - la relecture, dans le journal d'audit, de ce que le même utilisateur
 *     vient d'enregistrer sur l'événement (second essai compris) ;
 *   - qu'une notification en échec ne remonte jamais à l'appelant.
 * Le contrôle « en base » est le pgTAP
 * supabase/tests/email_template_modification_collecte.test.sql.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findMissingVariables,
  interpolate,
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import {
  CHAMPS_COLLECTE_EDITABLES,
  CHAMPS_EVENEMENT_EDITABLES,
} from './champs-editables';
import {
  lignesModifications,
  notifierEquipeModificationCollecte,
} from './email-modification';
import { modificationUrgente } from './urgence-modification';

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SQL = lire(
  '../../../../../supabase/migrations/20261009190000_plateforme_email_modification_collecte_lieu_lien.sql',
);
const CORPS = SQL.match(/\$tpl\$([\s\S]*?)\$tpl\$/)![1]!;
// Les instructions seules : le bloc de retour arrière, en commentaire, cite les
// anciennes variables.
const INSTRUCTIONS = SQL.split('\n')
  .filter((ligne) => !ligne.trimStart().startsWith('--'))
  .join('\n');
const VARIABLES = [
  ...INSTRUCTIONS.match(/variables = ARRAY\[([^\]]*)\]/)![1]!.matchAll(
    /'(\w+)'/g,
  ),
].map((m) => m[1]!);

type Admin = Parameters<typeof notifierEquipeModificationCollecte>[0];

// La requête en cours ne sert qu'au lien vers la fiche ; le domaine vient de la
// variable d'environnement, fixée ici pour un lien déterministe.
const REQ = new NextRequest('http://localhost/api/v1/traiteur/collectes/c1');
beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.exemple.test'));
afterEach(() => vi.unstubAllEnvs());
const LIEN_FICHE = 'https://app.exemple.test/admin/collectes/c1';
type Appel = [table: string, methode: string, ...args: unknown[]];

// Faux client : chaque table rend la ligne (ou l'erreur) qu'on lui a donnée, et
// chaque filtre posé est enregistré avec sa table.
function fauxAdmin(
  tables: Record<string, unknown>,
  erreurs: Record<string, string> = {},
) {
  const appels: Appel[] = [];
  const client = {
    from(table: string) {
      appels.push([table, 'from']);
      const erreur = erreurs[table];
      const reponse = {
        data: erreur ? null : (tables[table] ?? null),
        error: erreur ? { message: erreur } : null,
      };
      const chaine: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve(reponse),
        then: (suite: (r: typeof reponse) => unknown) => suite(reponse),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'order'])
        chaine[m] = (...args: unknown[]) => {
          appels.push([table, m, ...args]);
          return chaine;
        };
      return chaine;
    },
  };
  const lues = () => appels.filter(([, m]) => m === 'from').map(([t]) => t);
  return { admin: client as unknown as Admin, appels, lues };
}

const COLLECTE_APRES = {
  id: 'c1',
  evenement_id: 'e1',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  tms_reference: null,
  prestataire_logistique_id: 'presta-strike',
  date_collecte: '2099-01-14',
  heure_collecte: '16:45:00',
  attributions_antgaspi: null,
  evenement: {
    pax: 1500,
    created_by: 'user-prog',
    lieu: { nom: 'Paris Convention Centre' },
    organisation: { nom: 'Kaspia' },
  },
};
const PROGRAMMATEUR = {
  prenom: 'Julie',
  nom: 'Martin',
  telephone: '0601020304',
};

// Le cas de Val : date, pax et contact changés dans le même enregistrement.
const CAS_VAL = {
  collecteId: 'c1',
  collecteAvant: { date_collecte: '2099-01-15', heure_collecte: '16:45:00' },
  majCollecte: { date_collecte: '2099-01-14' },
  evenementAvant: {
    pax: 2000,
    contact_principal_nom: 'Paul Il',
    contact_principal_telephone: '0611111111',
  },
  majEvenement: {
    pax: 1500,
    contact_principal_nom: 'Arthus',
    contact_principal_telephone: '0699990002',
  },
};

let recus: CapturedEmail[] = [];
function capter() {
  recus = [];
  setEmailCaptureSink((email) => recus.push(email));
}
afterEach(() => setEmailCaptureSink(null));

describe('M3.1/email_modification_lignes — une ligne par champ modifié', () => {
  it('date, pax et contact : ancienne puis nouvelle valeur, en clair', () => {
    expect(lignesModifications(CAS_VAL)).toEqual([
      'Date de collecte : du 15/01/2099 au 14/01/2099',
      'Nombre de pax : de 2000 à 1500',
      'Contact : avant Paul Il (0611111111). Maintenant Arthus (0699990002)',
    ]);
  });

  it('un contact dont seul le téléphone change garde son nom dans la ligne', () => {
    expect(
      lignesModifications({
        evenementAvant: {
          contact_principal_nom: 'Paul Il',
          contact_principal_telephone: '0611111111',
        },
        majEvenement: { contact_principal_telephone: '0622222222' },
      }),
    ).toEqual([
      'Contact : avant Paul Il (0611111111). Maintenant Paul Il (0622222222)',
    ]);
  });

  it('un champ renvoyé à l’identique n’est pas listé (heure comparée à la minute)', () => {
    expect(
      lignesModifications({
        collecteAvant: {
          date_collecte: '2099-01-15',
          heure_collecte: '16:45:00',
          controle_acces_requis: true,
        },
        majCollecte: {
          date_collecte: '2099-01-15',
          heure_collecte: '16:45',
          controle_acces_requis: true,
        },
        evenementAvant: { pax: 2000, reference_affaire: null },
        majEvenement: { pax: '2000', reference_affaire: '' },
      }),
    ).toEqual([]);
  });

  it('heure, contrôle d’accès, textes libres, contact de secours, type et logo', () => {
    expect(
      lignesModifications(
        {
          collecteAvant: {
            heure_collecte: '16:45:00',
            controle_acces_requis: false,
            informations_supplementaires: null,
          },
          majCollecte: {
            heure_collecte: '17:30:00',
            controle_acces_requis: true,
            informations_supplementaires: 'Quai B',
          },
          evenementAvant: {
            contact_secours_nom: null,
            contact_secours_telephone: null,
            nom_evenement: 'Gala',
            nom_client_organisateur: 'Hermès',
            reference_affaire: 'A-1',
            type_evenement_id: 't-cocktail',
            logo_client_organisateur_url: null,
          },
          majEvenement: {
            contact_secours_nom: 'Léa',
            contact_secours_telephone: '0633333333',
            nom_evenement: 'Gala annuel',
            nom_client_organisateur: null,
            reference_affaire: 'A-2',
            type_evenement_id: 't-diner',
            logo_client_organisateur_url: 'https://exemple.test/logo.png',
          },
        },
        { 't-cocktail': 'Cocktail', 't-diner': 'Dîner assis' },
      ),
    ).toEqual([
      'Heure de collecte : de 16h45 à 17h30',
      'Contact de secours : avant non renseigné. Maintenant Léa (0633333333)',
      "Contrôle d'accès : de Non à Oui",
      'Informations supplémentaires : avant non renseigné. Maintenant Quai B',
      "Nom de l'événement : avant Gala. Maintenant Gala annuel",
      'Client organisateur : avant Hermès. Maintenant non renseigné',
      "Référence d'affaire : avant A-1. Maintenant A-2",
      "Type d'événement : avant Cocktail. Maintenant Dîner assis",
      'Logo du client organisateur : modifié',
    ]);
  });

  it('une clé qui n’est pas un champ saisi (statut de réacceptation) n’est jamais listée', () => {
    expect(
      lignesModifications({
        collecteAvant: { statut: 'validee' },
        majCollecte: { statut: 'programmee' },
      }),
    ).toEqual([]);
  });

  // Cliquet : un champ ajouté à la liste éditable des routes sans sa ligne ici
  // disparaîtrait de l'email sans que rien ne le dise. Les listes sont celles
  // que les routes importent (lib/collectes/champs-editables).
  it.each(CHAMPS_COLLECTE_EDITABLES)(
    'champ éditable de la collecte « %s » : une ligne',
    (c) => {
      expect(
        lignesModifications({
          collecteAvant: { [c]: 'a' },
          majCollecte: { [c]: 'b' },
        }),
      ).toHaveLength(1);
    },
  );

  it.each(CHAMPS_EVENEMENT_EDITABLES)(
    'champ éditable de l’événement « %s » : une ligne',
    (c) => {
      expect(
        lignesModifications({
          evenementAvant: { [c]: 'a' },
          majEvenement: { [c]: 'b' },
        }),
      ).toHaveLength(1);
    },
  );
});

describe('M3.1/email_modification_urgence_12h — ancien ou nouveau créneau à moins de 12 h', () => {
  // Heure d'hiver : 13h00 à Paris (UTC+1).
  const hiver = Date.UTC(2099, 0, 14, 12, 0);
  // Heure d'été : 12h00 à Paris (UTC+2).
  const ete = Date.UTC(2099, 6, 14, 10, 0);
  const LOIN = { date: '2099-12-31', heure: '10:00:00' };

  it.each([
    ['hiver, créneau dans 11 h 59', '2099-01-15', '00:59:00', hiver, true],
    ['hiver, créneau dans 12 h 01', '2099-01-15', '01:01:00', hiver, false],
    ['été, créneau dans 11 h 59', '2099-07-14', '23:59:00', ete, true],
    ['été, créneau dans 12 h 01', '2099-07-15', '00:01:00', ete, false],
  ])('seuil — %s', (_cas, date, heure, maintenant, urgent) => {
    const creneau = { date, heure };
    expect(modificationUrgente(creneau, creneau, maintenant)).toBe(urgent);
  });

  const PROCHE = { date: '2099-01-14', heure: '16:00:00' }; // dans 3 h

  it('collecte de ce soir repoussée au loin : urgente (ancien créneau proche)', () => {
    expect(modificationUrgente(PROCHE, LOIN, hiver)).toBe(true);
  });

  it('collecte lointaine rapprochée à dans 3 h : urgente (nouveau créneau proche)', () => {
    expect(modificationUrgente(LOIN, PROCHE, hiver)).toBe(true);
  });

  it('ancien et nouveau créneaux lointains : pas urgente', () => {
    expect(modificationUrgente(LOIN, LOIN, hiver)).toBe(false);
  });

  it('créneau déjà passé : urgente', () => {
    const passe = { date: '2099-01-14', heure: '09:00:00' };
    expect(modificationUrgente(passe, passe, hiver)).toBe(true);
  });

  it('heure absente : minuit du jour de collecte', () => {
    const minuit = { date: '2099-01-15', heure: null };
    // 13h00 → minuit = 11 h : urgent ; la veille à la même heure : 35 h.
    expect(modificationUrgente(minuit, minuit, hiver)).toBe(true);
    expect(modificationUrgente(minuit, minuit, hiver - 24 * 3600 * 1000)).toBe(
      false,
    );
  });
});

describe('M3.1/email_modification_rendu — email envoyé', () => {
  it('le cas de Val, rendu mot pour mot avec le corps de la migration', async () => {
    capter();
    const { admin, appels } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });

    await notifierEquipeModificationCollecte(admin, REQ, CAS_VAL);

    expect(recus).toHaveLength(1);
    const [email] = recus;
    expect(email!.slug).toBe('admin_modification_collecte_traiteur');
    expect(email!.to).toBe('contact@gosavr.io');
    expect(VARIABLES).toContain('liste_modifications');
    expect(findMissingVariables(VARIABLES, email!.variables, CORPS)).toEqual(
      [],
    );
    expect(interpolate(CORPS, email!.variables)).toBe(
      [
        '<p>Bonjour,</p>',
        "<p>L'organisation Kaspia a modifié la collecte initialement prévue le 15/01/2099 pour 2000 pax (lieu : Paris Convention Centre).</p>",
        '<p>Les champs modifiés sont :</p>',
        '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Nombre de pax : de 2000 à 1500</li><li>Contact : avant Paul Il (0611111111). Maintenant Arthus (0699990002)</li></ul>',
        '<p>Le programmateur est Julie Martin, joignable au 0601020304.</p>',
        '<p>Le statut actuel de la collecte est « Programmée ».</p>',
        '<p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p>',
        `<p><a href="${LIEN_FICHE}">Ouvrir la fiche de la collecte</a></p>`,
        "<p>L'équipe Savr</p>",
      ].join('\n'),
    );
    // La collecte lue est celle de la demande ; le programmateur, celui de
    // l'événement.
    expect(appels).toContainEqual(['collectes', 'eq', 'id', 'c1']);
    expect(appels).toContainEqual(['users', 'eq', 'id', 'user-prog']);
    // Le lieu fait partie de la lecture (une faute ici perdrait l'email entier).
    expect(appels).toContainEqual([
      'collectes',
      'select',
      expect.stringContaining('lieu:lieux!lieu_id(nom)'),
    ]);
    // Sans signalement, le journal d'audit n'est pas relu.
    expect(appels.map(([t]) => t)).not.toContain('audit_log');
  });

  it('statut « Créée » tant que la demande n’est pas partie vers le prestataire', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: { ...COLLECTE_APRES, prestataire_logistique_id: null },
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, CAS_VAL);
    expect(recus[0]!.variables.statut_collecte).toBe('Créée');
  });

  it('à moins de 12 h du créneau d’origine : la ligne ATTENTION du CDC', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      ...CAS_VAL,
      // Créneau d'origine déjà passé : forcément à moins de 12 h.
      collecteAvant: {
        date_collecte: '2020-01-01',
        heure_collecte: '10:00:00',
      },
    });
    expect(recus[0]!.variables.priorite_urgence).toBe('true');
    expect(interpolate(CORPS, recus[0]!.variables)).toContain(
      '<p>ATTENTION : modification effectuée moins de 12h avant le créneau de collecte. Action manuelle Ops probable (relais prestataire, vérification logistique).</p>',
    );
  });

  it('collecte lointaine rapprochée à moins de 12 h : la ligne ATTENTION aussi', async () => {
    capter();
    const { admin } = fauxAdmin({
      // Après l'écriture, le créneau est passé : forcément à moins de 12 h.
      collectes: { ...COLLECTE_APRES, date_collecte: '2020-01-01' },
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      collecteAvant: {
        date_collecte: '2099-01-15',
        heure_collecte: '16:45:00',
      },
      majCollecte: { date_collecte: '2020-01-01' },
    });
    expect(recus[0]!.variables.priorite_urgence).toBe('true');
  });

  it('le lien ouvre la fiche Admin de CETTE collecte, sur le domaine de l’application', async () => {
    capter();
    const { admin } = fauxAdmin({
      // L'identifiant du lien est celui que la base rend, pas celui de la demande.
      collectes: { ...COLLECTE_APRES, id: 'c-42' },
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, CAS_VAL);
    expect(recus[0]!.variables.lien_fiche).toBe(
      'https://app.exemple.test/admin/collectes/c-42',
    );
  });

  it('sans pax ni compte programmateur : ni « pour … pax » ni phrase programmateur, email envoyé quand même', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: {
        ...COLLECTE_APRES,
        evenement: {
          pax: null,
          created_by: 'user-prog',
          organisation: [{ nom: 'Kaspia' }],
        },
      },
      users: null,
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      collecteAvant: { date_collecte: '2099-01-15' },
      majCollecte: { date_collecte: '2099-01-14' },
    });
    const { variables } = recus[0]!;
    expect(findMissingVariables(VARIABLES, variables, CORPS)).toEqual([]);
    const html = interpolate(CORPS, variables);
    expect(html).toContain(
      "<p>L'organisation Kaspia a modifié la collecte initialement prévue le 15/01/2099.</p>",
    );
    expect(html).not.toContain('programmateur');
    expect(html).not.toContain('(lieu');
    expect(html).not.toContain('{{');
  });

  it('programmateur sans téléphone : son nom seul', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: { ...PROGRAMMATEUR, telephone: null },
    });
    await notifierEquipeModificationCollecte(admin, REQ, CAS_VAL);
    expect(recus[0]!.variables.programmateur).toBe('Julie Martin');
  });

  it('modification de l’événement seul : date et pax d’origine lus sur la collecte et l’événement', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      evenementAvant: { pax: 2000 },
      majEvenement: { pax: 1500 },
    });
    const { variables } = recus[0]!;
    expect(variables.date_initiale).toBe('14/01/2099');
    expect(variables.pax_initial).toBe('2000');
    expect(variables.liste_modifications).toBe(
      '<ul><li>Nombre de pax : de 2000 à 1500</li></ul>',
    );
  });

  it('un texte saisi par l’utilisateur est échappé dans le HTML', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: {
        ...COLLECTE_APRES,
        evenement: {
          ...COLLECTE_APRES.evenement,
          lieu: { nom: 'Salle <A>' },
          organisation: { nom: 'Kaspia & <Fils>' },
        },
      },
      users: { ...PROGRAMMATEUR, nom: '<b>Martin</b>' },
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      collecteAvant: { informations_supplementaires: null },
      majCollecte: {
        informations_supplementaires: '<script>alert("x")</script>',
      },
    });
    const html = interpolate(CORPS, recus[0]!.variables);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain(
      'Maintenant &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
    expect(html).toContain('Kaspia &amp; &lt;Fils&gt;');
    expect(html).toContain('(lieu : Salle &lt;A&gt;)');
  });

  it('le type d’événement est nommé par son libellé', async () => {
    capter();
    const { admin, lues } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
      types_evenements: [
        { id: 't-cocktail', libelle: 'Cocktail' },
        { id: 't-diner', libelle: 'Dîner assis' },
      ],
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      evenementAvant: { type_evenement_id: 't-cocktail' },
      majEvenement: { type_evenement_id: 't-diner' },
    });
    expect(lues()).toContain('types_evenements');
    expect(recus[0]!.variables.liste_modifications).toBe(
      "<ul><li>Type d'événement : avant Cocktail. Maintenant Dîner assis</li></ul>",
    );
  });

  it('aucun champ réellement modifié : aucun email', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, REQ, {
      collecteId: 'c1',
      collecteAvant: { date_collecte: '2099-01-14' },
      majCollecte: { date_collecte: '2099-01-14' },
    });
    expect(recus).toEqual([]);
  });

  it.each([
    [
      'de la collecte',
      { collecteAvant: null, majCollecte: { date_collecte: '2099-01-14' } },
    ],
    ['de l’événement', { evenementAvant: null, majEvenement: { pax: 1500 } }],
  ])(
    'état d’avant %s illisible : aucun email (il inventerait ses valeurs « avant »)',
    async (_cas, modification) => {
      capter();
      const { admin, lues } = fauxAdmin({
        collectes: COLLECTE_APRES,
        users: PROGRAMMATEUR,
      });
      await notifierEquipeModificationCollecte(admin, REQ, {
        collecteId: 'c1',
        ...modification,
      });
      expect(recus).toEqual([]);
      expect(lues()).toEqual([]);
    },
  );

  it('collecte introuvable : aucun email', async () => {
    capter();
    const { admin } = fauxAdmin({});
    await notifierEquipeModificationCollecte(admin, REQ, CAS_VAL);
    expect(recus).toEqual([]);
  });

  it('collecte illisible (erreur de lecture) : aucun email, rien ne remonte', async () => {
    capter();
    const { admin } = fauxAdmin(
      { collectes: COLLECTE_APRES, users: PROGRAMMATEUR },
      { collectes: 'colonne inconnue' },
    );
    await expect(
      notifierEquipeModificationCollecte(admin, REQ, CAS_VAL),
    ).resolves.toBeUndefined();
    expect(recus).toEqual([]);
  });

  it('un envoi qui échoue ne remonte pas à l’appelant (la modification est déjà écrite)', async () => {
    setEmailCaptureSink(() => {
      throw new Error('Resend indisponible');
    });
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await expect(
      notifierEquipeModificationCollecte(admin, REQ, CAS_VAL),
    ).resolves.toBeUndefined();
  });
});

describe('M3.1/email_modification_un_seul_email — modification d’événement du même enregistrement', () => {
  const DEMANDE = {
    collecteId: 'c1',
    collecteAvant: { date_collecte: '2099-01-15', heure_collecte: '16:45:00' },
    majCollecte: { date_collecte: '2099-01-14' },
    evenementModifiePar: 'user-1',
  };
  const AUDIT_PAX = {
    old_values: { pax: 2000, contact_principal_nom: 'Paul Il' },
    new_values: { updates: { pax: 1500 } },
  };

  it('relue dans le journal d’audit de CET utilisateur, pour l’événement de CETTE collecte', async () => {
    capter();
    const avantAppel = Date.now();
    const { admin, appels } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
      audit_log: [AUDIT_PAX],
    });
    await notifierEquipeModificationCollecte(admin, REQ, DEMANDE);

    expect(recus[0]!.variables.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Nombre de pax : de 2000 à 1500</li></ul>',
    );
    expect(recus[0]!.variables.pax_initial).toBe('2000');

    const audit = appels.filter(([t]) => t === 'audit_log');
    expect(audit.filter(([, m]) => m === 'eq')).toEqual([
      ['audit_log', 'eq', 'table_name', 'evenements'],
      ['audit_log', 'eq', 'record_id', 'e1'],
      ['audit_log', 'eq', 'user_id', 'user-1'],
      ['audit_log', 'eq', 'action', 'UPDATE'],
    ]);
    // Les lignes sont lues dans l'ordre où elles ont été écrites…
    expect(audit).toContainEqual([
      'audit_log',
      'order',
      'id',
      { ascending: true },
    ]);
    // … sur les dix dernières minutes seulement.
    const borne = audit.find(([, m]) => m === 'gte')!;
    expect(borne[2]).toBe('created_at');
    const depuis = avantAppel - Date.parse(String(borne[3]));
    expect(depuis).toBeGreaterThan(10 * 60 * 1000 - 5000);
    expect(depuis).toBeLessThan(10 * 60 * 1000 + 5000);
  });

  it('second essai après une requête collecte refusée : la modification d’événement renvoyée sans effet ne masque pas la première', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
      audit_log: [
        AUDIT_PAX,
        // Le formulaire renvoie le même écart : la base vaut déjà 1500.
        { old_values: { pax: 1500 }, new_values: { updates: { pax: 1500 } } },
      ],
    });
    await notifierEquipeModificationCollecte(admin, REQ, DEMANDE);
    expect(recus[0]!.variables.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Nombre de pax : de 2000 à 1500</li></ul>',
    );
    expect(recus[0]!.variables.pax_initial).toBe('2000');
  });

  it('deux modifications d’événement successives : de la première valeur à la dernière', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
      audit_log: [
        AUDIT_PAX,
        {
          old_values: { pax: 1500, contact_principal_nom: 'Paul Il' },
          new_values: {
            updates: { pax: 1800, contact_principal_nom: 'Arthus' },
          },
        },
      ],
    });
    await notifierEquipeModificationCollecte(admin, REQ, DEMANDE);
    expect(recus[0]!.variables.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Nombre de pax : de 2000 à 1800</li><li>Contact : avant Paul Il. Maintenant Arthus</li></ul>',
    );
  });

  it('aucune ligne d’audit récente : l’email part avec les seuls champs de la collecte', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
      audit_log: [],
    });
    await notifierEquipeModificationCollecte(admin, REQ, DEMANDE);
    expect(recus[0]!.variables.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li></ul>',
    );
  });

  it('journal d’audit illisible : l’email part quand même, avec les seuls champs de la collecte', async () => {
    capter();
    const { admin } = fauxAdmin(
      {
        collectes: COLLECTE_APRES,
        users: PROGRAMMATEUR,
        audit_log: [AUDIT_PAX],
      },
      { audit_log: 'délai dépassé' },
    );
    await notifierEquipeModificationCollecte(admin, REQ, DEMANDE);
    expect(recus).toHaveLength(1);
    expect(recus[0]!.variables.liste_modifications).toBe(
      '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li></ul>',
    );
  });
});
