/**
 * M3.1 / §06.02 n°19 — email de modification d'une collecte (email_modification_*).
 * =============================================================================
 * Constat E2E de Val, 2026-10-09 : un traiteur change la date, le pax et le
 * contact d'une collecte ; l'email reçu par l'équipe Savr ne citait que
 * « date_collecte ». Vérifie, sans DB (corps lu dans la migration + moteur
 * d'interpolation réel) :
 *   - une ligne par champ réellement modifié, ancienne puis nouvelle valeur ;
 *   - l'email rendu pour le cas de Val, mot pour mot ;
 *   - les blocs conditionnels (pax, programmateur, ligne ATTENTION) ;
 *   - l'échappement de tout texte saisi par un utilisateur ;
 *   - qu'une notification en échec ne remonte jamais à l'appelant.
 * Le contrôle « en base » est le pgTAP
 * supabase/tests/email_template_modification_collecte.test.sql.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findMissingVariables,
  interpolate,
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import {
  derniereModificationEvenement,
  lignesModifications,
  modificationUrgente,
  notifierEquipeModificationCollecte,
} from './email-modification';

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../supabase/migrations/20261009160000_plateforme_email_modification_collecte_avant_apres.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const CORPS = SQL.match(/\$tpl\$([\s\S]*?)\$tpl\$/)![1]!;
const VARIABLES = [
  ...SQL.match(/variables = ARRAY\[([^\]]*)\]/)![1]!.matchAll(/'(\w+)'/g),
].map((m) => m[1]!);

type Admin = Parameters<typeof notifierEquipeModificationCollecte>[0];

// Faux client : chaque table rend la ligne qu'on lui a donnée.
function fauxAdmin(tables: Record<string, unknown>) {
  const lues: string[] = [];
  const filtres: unknown[][] = [];
  const client = {
    from(table: string) {
      lues.push(table);
      const reponse = { data: tables[table] ?? null, error: null };
      const chaine: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve(reponse),
        then: (suite: (r: typeof reponse) => unknown) => suite(reponse),
      };
      for (const m of ['select', 'in', 'gte', 'order', 'limit'])
        chaine[m] = () => chaine;
      chaine.eq = (...args: unknown[]) => {
        filtres.push(args);
        return chaine;
      };
      return chaine;
    },
  };
  return { admin: client as unknown as Admin, lues, filtres };
}

const COLLECTE_APRES = {
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
    contact_principal_telephone: '0656896534',
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
      'Contact : avant Paul Il (0611111111). Maintenant Arthus (0656896534)',
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
});

describe('M3.1/email_modification_urgence_12h — seuil des 12 h', () => {
  const maintenant = Date.UTC(2099, 0, 14, 12, 0); // 13h00 à Paris

  it('créneau à moins de 12 h : urgent', () => {
    expect(modificationUrgente('2099-01-14', '22:00:00', maintenant)).toBe(
      true,
    );
  });

  it('créneau à plus de 12 h : pas urgent', () => {
    expect(modificationUrgente('2099-01-15', '16:45:00', maintenant)).toBe(
      false,
    );
  });
});

describe('M3.1/email_modification_rendu — email envoyé', () => {
  it('le cas de Val, rendu mot pour mot avec le corps de la migration', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });

    await notifierEquipeModificationCollecte(admin, CAS_VAL);

    expect(recus).toHaveLength(1);
    const [email] = recus;
    expect(email!.slug).toBe('admin_modification_collecte_traiteur');
    expect(email!.to).toBe('contact@gosavr.io');
    expect(findMissingVariables(VARIABLES, email!.variables, CORPS)).toEqual(
      [],
    );
    expect(interpolate(CORPS, email!.variables)).toBe(
      [
        '<p>Bonjour,</p>',
        "<p>L'organisation Kaspia a modifié la collecte initialement prévue le 15/01/2099 pour 2000 pax.</p>",
        '<p>Les champs modifiés sont :</p>',
        '<ul><li>Date de collecte : du 15/01/2099 au 14/01/2099</li><li>Nombre de pax : de 2000 à 1500</li><li>Contact : avant Paul Il (0611111111). Maintenant Arthus (0656896534)</li></ul>',
        '<p>Le programmateur est Julie Martin, joignable au 0601020304.</p>',
        '<p>Le statut actuel de la collecte est « Programmée ».</p>',
        '<p>Merci de relayer au prestataire si nécessaire depuis le back-office.</p>',
        "<p>L'équipe Savr</p>",
      ].join('\n'),
    );
  });

  it('statut « Créée » tant que la demande n’est pas partie vers le prestataire', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: { ...COLLECTE_APRES, prestataire_logistique_id: null },
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, CAS_VAL);
    expect(recus[0]!.variables.statut_collecte).toBe('Créée');
  });

  it('à moins de 12 h du créneau d’origine : la ligne ATTENTION du CDC', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, {
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
    await notifierEquipeModificationCollecte(admin, {
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
    expect(html).not.toContain('{{');
  });

  it('programmateur sans téléphone : son nom seul', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: { ...PROGRAMMATEUR, telephone: null },
    });
    await notifierEquipeModificationCollecte(admin, CAS_VAL);
    expect(recus[0]!.variables.programmateur).toBe('Julie Martin');
  });

  it('modification de l’événement seul : date et pax d’origine lus sur la collecte et l’événement', async () => {
    capter();
    const { admin } = fauxAdmin({
      collectes: COLLECTE_APRES,
      users: PROGRAMMATEUR,
    });
    await notifierEquipeModificationCollecte(admin, {
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
          organisation: { nom: 'Kaspia & <Fils>' },
        },
      },
      users: { ...PROGRAMMATEUR, nom: '<b>Martin</b>' },
    });
    await notifierEquipeModificationCollecte(admin, {
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
    await notifierEquipeModificationCollecte(admin, {
      collecteId: 'c1',
      evenementAvant: { type_evenement_id: 't-cocktail' },
      majEvenement: { type_evenement_id: 't-diner' },
    });
    expect(lues).toContain('types_evenements');
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
    await notifierEquipeModificationCollecte(admin, {
      collecteId: 'c1',
      collecteAvant: { date_collecte: '2099-01-14' },
      majCollecte: { date_collecte: '2099-01-14' },
    });
    expect(recus).toEqual([]);
  });

  it('collecte introuvable : aucun email', async () => {
    capter();
    const { admin } = fauxAdmin({});
    await notifierEquipeModificationCollecte(admin, CAS_VAL);
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
      notifierEquipeModificationCollecte(admin, CAS_VAL),
    ).resolves.toBeUndefined();
  });
});

describe('M3.1/email_modification_un_seul_email — modification d’événement du même enregistrement', () => {
  it('relue dans le journal d’audit de CET utilisateur, pour CET événement', async () => {
    const { admin, lues, filtres } = fauxAdmin({
      audit_log: {
        old_values: { pax: 2000 },
        new_values: { updates: { pax: 1500 } },
      },
    });
    await expect(
      derniereModificationEvenement(admin, 'e1', 'user-1'),
    ).resolves.toEqual({
      evenementAvant: { pax: 2000 },
      majEvenement: { pax: 1500 },
    });
    expect(lues).toEqual(['audit_log']);
    expect(filtres).toEqual([
      ['table_name', 'evenements'],
      ['record_id', 'e1'],
      ['user_id', 'user-1'],
      ['action', 'UPDATE'],
    ]);
  });

  it('aucune ligne d’audit récente : rien à ajouter', async () => {
    const { admin } = fauxAdmin({});
    await expect(
      derniereModificationEvenement(admin, 'e1', 'user-1'),
    ).resolves.toEqual({});
  });

  it('événement inconnu : aucune lecture', async () => {
    const { admin, lues } = fauxAdmin({});
    await expect(
      derniereModificationEvenement(admin, undefined, 'user-1'),
    ).resolves.toEqual({});
    expect(lues).toEqual([]);
  });
});
