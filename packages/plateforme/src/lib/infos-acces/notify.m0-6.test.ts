import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { CODE_ALERTE_INFOS_ACCES_NON_REMISES } from '@/lib/emails/codes-alertes.js';
import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
} from '@/test-utils/base-en-memoire';
import {
  envoyerInfosAccesCompletes,
  evaluerInfosAccesEtEnvoyer,
  renderChauffeursBloc,
  type InfosAccesChauffeur,
} from './notify.js';

const TAMPON = '2026-09-01T08:00:00.000Z';

// Base en mémoire : la collecte porte le claim posé par la RPC de marquage (la
// vraie fonction SQL est prouvée en pgTAP — ici elle rend ce que le test fixe).
function creerBase(marquage: {
  data?: unknown;
  erreur?: string;
}): BaseEnMemoire {
  const b = creerBaseEnMemoire({
    collectes: [{ id: 'coll-1', infos_acces_email_envoye_at: TAMPON }],
    alertes_admin: [
      {
        id: 'a-1',
        code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
        entity_type: 'collecte',
        entity_id: 'coll-1',
        statut: 'ouverte',
      },
    ],
  });
  b.rpcs['fn_infos_acces_marquer_si_complet'] = () => marquage.data ?? null;
  if (marquage.erreur) {
    b.pannes['rpc.fn_infos_acces_marquer_si_complet'] = {
      code: 'XX000',
      message: marquage.erreur,
    };
  }
  return b;
}

const client = (b: BaseEnMemoire) =>
  b.client as Parameters<typeof evaluerInfosAccesEtEnvoyer>[0];
const tampon = (b: BaseEnMemoire) =>
  b.tables['collectes']![0]!['infos_acces_email_envoye_at'];
const alerte = (b: BaseEnMemoire) => b.tables['alertes_admin']![0]!['statut'];

const PAYLOAD_COMPLET = {
  to: 'prog@infos-acces.local',
  prenom: 'Prog',
  evenement_nom: 'Gala',
  date_collecte: '2026-09-10',
  heure_collecte: '08:00:00',
  lieu_nom: 'Salle Accès',
  lieu_adresse: '9 rue Test',
  chauffeurs: [
    {
      rang: 1,
      chauffeur_nom: 'Jean Dupont',
      chauffeur_telephone: '0611111111',
      plaque: '12ABC23',
      accompagnant_nom: null,
      accompagnant_telephone: null,
    },
    {
      rang: 2,
      chauffeur_nom: 'Marie Martin',
      chauffeur_telephone: '0622222222',
      plaque: '34XYZ56',
      accompagnant_nom: 'Luc Bernard',
      accompagnant_telephone: '0633333333',
    },
  ] satisfies InfosAccesChauffeur[],
};

describe('M0.6 / infos accès — email récap (evaluerInfosAccesEtEnvoyer)', () => {
  let emails: CapturedEmail[] = [];
  beforeEach(() => {
    emails = [];
    setEmailCaptureSink((e) => emails.push(e));
  });
  afterEach(() => setEmailCaptureSink(null));

  it('complet → envoie 1 email au programmateur avec les infos formatées', async () => {
    const b = creerBase({ data: PAYLOAD_COMPLET });
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');

    expect(res).toEqual({ envoye: true, issue: 'envoye' });
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.slug).toBe('infos_acces_collecte');
    expect(email.to).toBe('prog@infos-acces.local');
    // L'envoi est rattaché à la collecte : c'est ce lien qui permet d'en lire
    // l'état sur la fiche et d'en tirer les suites s'il échoue.
    expect(email.options).toEqual({
      entityType: 'collecte',
      entityId: 'coll-1',
    });
    // Date/heure formatées FR.
    expect(email.variables.date_collecte).toBe('10/09/2026');
    expect(email.variables.heure_collecte).toBe('08:00');
    // Bloc chauffeurs pré-rendu, un email listant les 2 camions.
    const bloc = email.variables.chauffeurs_bloc;
    expect(bloc).toContain('Jean Dupont');
    expect(bloc).toContain('0611111111');
    expect(bloc).toContain('Marie Martin');
    expect(bloc).toContain('Luc Bernard');
  });

  it('email parti → claim conservé, et l’alerte « non remis » ouverte pour la collecte est close', async () => {
    const b = creerBase({ data: PAYLOAD_COMPLET });
    await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');

    expect(tampon(b)).toBe(TAMPON);
    expect(alerte(b)).toBe('resolue');
  });

  it('email parti mais alerte non close (erreur base) → l’envoi reste annoncé, sans exception', async () => {
    const b = creerBase({ data: PAYLOAD_COMPLET });
    b.pannes['alertes_admin.update'] = { code: '08006', message: 'connexion' };

    expect(await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1')).toEqual({
      envoye: true,
      issue: 'envoye',
    });
    expect(alerte(b)).toBe('ouverte');
  });

  it('RPC null (incomplet / déjà envoyé) → aucun email, sans objet', async () => {
    const b = creerBase({ data: null });
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    expect(res).toEqual({ envoye: false, issue: 'sans_objet' });
    expect(emails).toHaveLength(0);
    expect(alerte(b)).toBe('ouverte');
  });

  it('destinataire introuvable → aucun email (pas d’envoi à vide), non envoyé', async () => {
    const b = creerBase({ data: { erreur: 'destinataire_introuvable' } });
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(emails).toHaveLength(0);
  });

  it('destinataire vide dans le marquage → aucun email, claim relâché', async () => {
    const b = creerBase({ data: { ...PAYLOAD_COMPLET, to: '' } });
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(emails).toHaveLength(0);
    expect(tampon(b)).toBeNull();
  });

  it('erreur RPC → aucun email, pas d’exception', async () => {
    const b = creerBase({ erreur: 'boom' });
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    expect(res).toEqual({ envoye: false, issue: 'sans_objet' });
    expect(emails).toHaveLength(0);
  });

  it('exception à l’envoi → relâche le claim (reset infos_acces_email_envoye_at) + non envoyé', async () => {
    const b = creerBase({ data: PAYLOAD_COMPLET });
    // Sink qui échoue → sendEmail throw → chemin de relâchement du claim.
    setEmailCaptureSink(() => {
      throw new Error('resend down');
    });

    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(tampon(b)).toBeNull();
    // Rien n'est parti : l'alerte reste ouverte.
    expect(alerte(b)).toBe('ouverte');
  });
});

describe('M0.6 / infos accès — renderChauffeursBloc', () => {
  it('camion unique → pas de titre « Camion N », affiche chauffeur + plaque', () => {
    const bloc = renderChauffeursBloc([
      {
        rang: 1,
        chauffeur_nom: 'Jean Dupont',
        chauffeur_telephone: '0611111111',
        plaque: '12ABC23',
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    ]);
    expect(bloc).not.toContain('Camion 1');
    expect(bloc).toContain('Jean Dupont');
    expect(bloc).toContain('12ABC23');
  });

  it('multi-camions → titres « Camion N » + accompagnant listé', () => {
    const bloc = renderChauffeursBloc(PAYLOAD_COMPLET.chauffeurs);
    expect(bloc).toContain('Camion 1');
    expect(bloc).toContain('Camion 2');
    expect(bloc).toContain('Accompagnant : Luc Bernard');
  });

  // Décision Val 2026-11-16 : MTS-1 ne fournit pas le téléphone, l'email part
  // sur nom + plaque — jamais de tiret orphelin à la place du numéro.
  it('sans téléphone → « Chauffeur : nom » seul, plaque affichée', () => {
    const bloc = renderChauffeursBloc([
      {
        rang: 1,
        chauffeur_nom: 'Jean Dupont',
        chauffeur_telephone: null,
        plaque: '12ABC23',
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    ]);
    expect(bloc).toContain('<li>Chauffeur : Jean Dupont</li>');
    expect(bloc).toContain('<li>Plaque : 12ABC23</li>');
  });

  it('échappe le HTML des valeurs saisies (anti-injection)', () => {
    const bloc = renderChauffeursBloc([
      {
        rang: 1,
        chauffeur_nom: '<script>x</script>',
        chauffeur_telephone: '06',
        plaque: null,
        accompagnant_nom: null,
        accompagnant_telephone: null,
      },
    ]);
    expect(bloc).not.toContain('<script>');
    expect(bloc).toContain('&lt;script&gt;');
  });
});

// Décision Val 2026-11-16 : le chauffeur et la plaque arrivent par la relève
// des transporteurs, sans saisie Admin ; la relève évalue donc elle-même les
// collectes à contrôle d'accès encore à venir.
describe('M0.6 / infos accès — passage après la relève (envoyerInfosAccesCompletes)', () => {
  let emails: CapturedEmail[] = [];
  beforeEach(() => {
    emails = [];
    setEmailCaptureSink((e) => emails.push(e));
  });
  afterEach(() => setEmailCaptureSink(null));

  const ligne = (id: string, surcharge: Record<string, unknown> = {}) => ({
    id,
    controle_acces_requis: true,
    infos_acces_email_envoye_at: null,
    statut: 'validee',
    date_collecte: '2026-11-17',
    ...surcharge,
  });

  it('n’évalue que les collectes à contrôle d’accès, à venir, sans email réservé', async () => {
    const b = creerBaseEnMemoire({
      collectes: [
        ligne('a-evaluer'),
        ligne('deja-envoyee', { infos_acces_email_envoye_at: TAMPON }),
        ligne('sans-controle', { controle_acces_requis: false }),
        ligne('passee', { date_collecte: '2026-11-15' }),
        ligne('realisee', { statut: 'realisee' }),
        ligne('brouillon', { statut: 'brouillon' }),
      ],
      alertes_admin: [],
    });
    const evaluees: unknown[] = [];
    b.rpcs['fn_infos_acces_marquer_si_complet'] = (args) => {
      evaluees.push(args['p_collecte_id']);
      return PAYLOAD_COMPLET;
    };

    const r = await envoyerInfosAccesCompletes(client(b), '2026-11-16');

    expect(evaluees).toEqual(['a-evaluer']);
    expect(r).toEqual({ evaluees: 1, envoyes: 1 });
    expect(emails).toHaveLength(1);
  });

  it('fenêtre J à J+7 : une collecte au-delà n’est pas évaluée', async () => {
    const b = creerBaseEnMemoire({
      collectes: [
        ligne('j7', { date_collecte: '2026-11-23' }),
        ligne('j8', { date_collecte: '2026-11-24' }),
      ],
      alertes_admin: [],
    });
    const evaluees: unknown[] = [];
    b.rpcs['fn_infos_acces_marquer_si_complet'] = (args) => {
      evaluees.push(args['p_collecte_id']);
      return null;
    };

    await envoyerInfosAccesCompletes(client(b), '2026-11-16');

    expect(evaluees).toEqual(['j7']);
  });

  it('30 collectes incomplètes plus proches ne cachent pas une collecte complète', async () => {
    const incompletes = Array.from({ length: 30 }, (_, i) =>
      ligne(`incomplete-${i}`, { date_collecte: '2026-11-17' }),
    );
    const b = creerBaseEnMemoire({
      collectes: [
        ...incompletes,
        ligne('complete', { date_collecte: '2026-11-20' }),
      ],
      alertes_admin: [],
    });
    b.rpcs['fn_infos_acces_marquer_si_complet'] = (args) =>
      args['p_collecte_id'] === 'complete' ? PAYLOAD_COMPLET : null;

    const r = await envoyerInfosAccesCompletes(client(b), '2026-11-16');

    expect(r).toEqual({ evaluees: 31, envoyes: 1 });
    expect(emails).toHaveLength(1);
  });

  it('budget de temps dépassé : plus aucune collecte n’est commencée', async () => {
    const b = creerBaseEnMemoire({
      collectes: [ligne('premiere'), ligne('seconde')],
      alertes_admin: [],
    });
    const evaluees: unknown[] = [];
    b.rpcs['fn_infos_acces_marquer_si_complet'] = (args) => {
      evaluees.push(args['p_collecte_id']);
      return null;
    };
    // 0 au départ, puis 10 s, puis 30 s : la seconde collecte dépasse les 25 s.
    const instants = [0, 10_000, 30_000];
    const horloge = () => instants.shift() ?? 30_000;

    const r = await envoyerInfosAccesCompletes(
      client(b),
      '2026-11-16',
      horloge,
    );

    expect(evaluees).toEqual(['premiere']);
    expect(r.evaluees).toBe(1);
  });

  it('collecte incomplète (la fonction SQL ne réserve rien) → aucun email', async () => {
    const b = creerBaseEnMemoire({
      collectes: [ligne('incomplete')],
      alertes_admin: [],
    });
    b.rpcs['fn_infos_acces_marquer_si_complet'] = () => null;

    const r = await envoyerInfosAccesCompletes(client(b), '2026-11-16');

    expect(r).toEqual({ evaluees: 1, envoyes: 0 });
    expect(emails).toHaveLength(0);
  });
});
