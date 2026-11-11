/**
 * M4.1 — Exports CSV au-delà des plafonds de l'API de données.
 *
 * Une réponse est amputée à 1 000 lignes sans erreur, et un filtre `in.(…)` de
 * plus de quelques centaines d'identifiants fait échouer la lecture (mesures :
 * `src/lib/pdf/selection-par-pages.ts`). Avant l'import de l'historique Bubble
 * (environ 2 000 collectes), aucun jeu de données n'atteignait ces plafonds :
 * les exports sortaient alors amputés, ou avec des colonnes vides, sans message.
 * Chaque cas ci-dessous échoue sur une lecture unique ou une liste entière.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  creerApiPlafonnee,
  PLAFOND_IDS,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => {
    throw new Error('lecture service_role non attendue dans ces cas');
  },
}));

import {
  resolveRepas,
  resolveTraiteurNoms,
  type ExportContext,
} from '@/lib/exports/shared.js';
import {
  buildAssociationsAgExport,
  buildFacturesExport,
  buildImpactRseExport,
  buildPacksAgExport,
  buildPeseesExport,
} from '@/lib/exports/builders.js';
import { CSV_BOM, CSV_EOL, CSV_SEP } from '@savr/shared/src/csv/index.js';

const id = (prefixe: string, i: number) =>
  `${prefixe}-${String(i).padStart(5, '0')}`;
const suite = <T>(n: number, ligne: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => ligne(i));

/** Lignes d'un CSV Savr, en-tête retiré, chaque ligne découpée en cellules. */
function lignesCsv(csv: string): { entetes: string[]; lignes: string[][] } {
  const [entete, ...lignes] = csv.replace(CSV_BOM, '').split(CSV_EOL);
  return {
    entetes: entete!.split(CSV_SEP),
    lignes: lignes.map((l) => l.split(CSV_SEP)),
  };
}

function contexte(
  tables: Record<string, Ligne[]>,
  role: ExportContext['role'] = 'admin_savr',
) {
  const api = creerApiPlafonnee(tables);
  const ctx: ExportContext = {
    supabase: api.client as ExportContext['supabase'],
    role,
    isStaff: role === 'admin_savr' || role === 'ops_savr',
  };
  return { api, ctx };
}

const aucunFiltre = new URLSearchParams();

/**
 * Chaque tranche est bornée et son tri finit par `id`. Un tri sans clé unique
 * laisse l'ordre des ex æquo libre d'une requête à l'autre : une ligne pourrait
 * être servie deux fois ou sautée entre deux tranches. Le banc trie toujours de
 * la même façon et ne le montrerait pas : c'est le tri DEMANDÉ qui est contrôlé.
 */
function attendreTranches(
  api: ReturnType<typeof creerApiPlafonnee>,
  table: string,
  total: number,
): void {
  const tranches = api.lecturesDe(table);
  expect(tranches.length).toBeGreaterThan(1);
  expect(tranches.every((t) => t.tris.at(-1) === 'id')).toBe(true);
  expect(tranches.every((t) => t.rendues <= PLAFOND_LIGNES)).toBe(true);
  expect(tranches.reduce((s, t) => s + t.rendues, 0)).toBe(total);
}

// ── Aides partagées par les exports ──────────────────────────────────────────

describe('M4.1 / exports au-delà des plafonds — repas AG (resolveRepas)', () => {
  // 1 755 collectes anti-gaspi : le volume attendu après l'import Bubble.
  const collecteIds = suite(1755, (i) => id('col', i));

  it('équipe Savr : les repas de 1 755 collectes sont tous lus, par lots', async () => {
    const { api, ctx } = contexte({
      attributions_antgaspi: collecteIds.map((collecte_id) => ({
        collecte_id,
        volume_repas_realise: 3,
      })),
    });

    const repas = await resolveRepas(ctx.supabase, collecteIds, true);

    expect(repas.size).toBe(1755);
    expect([...repas.values()].every((v) => v === 3)).toBe(true);
    const listes = api
      .lecturesDe('attributions_antgaspi')
      .map((l) => (l.filtres[0]![2] as unknown[]).length);
    expect(Math.max(...listes)).toBeLessThanOrEqual(PLAFOND_IDS);
  });

  it("équipe Savr : une lecture en échec fait échouer l'export", async () => {
    const { api, ctx } = contexte({ attributions_antgaspi: [] });
    api.pannes['attributions_antgaspi'] = { message: 'panne', code: 'XX000' };

    await expect(
      resolveRepas(ctx.supabase, collecteIds.slice(0, 5), true),
    ).rejects.toThrow('Erreur serveur');
  });

  it('client : un appel par collecte, jamais plus de 20 à la fois', async () => {
    const { api, ctx } = contexte({}, 'traiteur_manager');
    api.rpcs['f_volume_repas_realise'] = () => 2;
    const ids = collecteIds.slice(0, 450);

    const repas = await resolveRepas(ctx.supabase, ids);

    expect(repas.size).toBe(450);
    expect(api.appelsRpc).toHaveLength(450);
    expect(api.rpcSimultanesMax).toBeLessThanOrEqual(20);
  });

  it("client : un appel en échec fait échouer l'export", async () => {
    const { api, ctx } = contexte({}, 'traiteur_manager');
    api.pannes['rpc.f_volume_repas_realise'] = { message: 'panne' };

    await expect(
      resolveRepas(ctx.supabase, collecteIds.slice(0, 3)),
    ).rejects.toThrow('Erreur serveur');
  });
});

describe('M4.1 / exports au-delà des plafonds — noms des traiteurs (resolveTraiteurNoms)', () => {
  const traiteurIds = suite(450, (i) => id('org', i));

  it('450 traiteurs : tous les noms sont lus, par lots', async () => {
    const { api, ctx } = contexte({
      v_referentiel_traiteurs: traiteurIds.map((tid) => ({
        id: tid,
        nom: `Traiteur ${tid}`,
      })),
    });

    const noms = await resolveTraiteurNoms(ctx.supabase, traiteurIds);

    expect(noms.size).toBe(450);
    expect(noms.get(traiteurIds[449]!)).toBe(`Traiteur ${traiteurIds[449]}`);
    expect(api.lecturesDe('v_referentiel_traiteurs').length).toBeGreaterThan(1);
  });

  it("une lecture en échec fait échouer l'export", async () => {
    const { api, ctx } = contexte({ v_referentiel_traiteurs: [] });
    api.pannes['v_referentiel_traiteurs'] = { message: 'panne' };

    await expect(
      resolveTraiteurNoms(ctx.supabase, traiteurIds.slice(0, 2)),
    ).rejects.toThrow('Erreur serveur');
  });
});

// ── Exports : chaque fichier porte TOUTES les lignes ─────────────────────────

const evenement = (i: number) => ({
  nom_evenement: `Événement ${i}`,
  date_evenement: '2026-03-10',
  traiteur_operationnel_organisation_id: 'org-00001',
  lieux: { nom: 'Lieu', code_postal: '75001', ville: 'Paris' },
});

describe('M4.1 / exports au-delà des plafonds — fichiers complets', () => {
  it('Impact RSE : 1 500 collectes, repas AG renseignés', async () => {
    // 1 200 collectes AG (plus que la liste d'identifiants ne le tolère) + 300 ZD.
    const collectes = suite(1500, (i) => ({
      id: id('col', i),
      type: i < 1200 ? 'anti_gaspi' : 'zero_dechet',
      statut: 'cloturee',
      date_collecte: '2026-03-10',
      taux_recyclage: null,
      co2_induit_kg: 1,
      co2_evite_kg: 2,
      co2_net_kg: -1,
      energie_primaire_evitee_kwh: 0,
      collecte_flux: [],
      evenements: evenement(i),
    }));
    const { api, ctx } = contexte({
      collectes,
      attributions_antgaspi: collectes
        .filter((c) => c.type === 'anti_gaspi')
        .map((c) => ({ collecte_id: c.id, volume_repas_realise: 4 })),
      v_referentiel_traiteurs: [{ id: 'org-00001', nom: 'Maison Test' }],
    });

    const { csv } = await buildImpactRseExport(ctx, aucunFiltre);

    const { entetes, lignes } = lignesCsv(csv);
    expect(lignes).toHaveLength(1500);
    // Collecte AG : ses repas ; collecte ZD : cellule vide.
    const repas = entetes.indexOf('Repas AG');
    expect(lignes.filter((l) => l[repas] === '4')).toHaveLength(1200);
    expect(lignes.filter((l) => l[repas] === '')).toHaveLength(300);
    const traiteur = entetes.indexOf('Traiteur');
    expect(lignes.every((l) => l[traiteur] === 'Maison Test')).toBe(true);
    attendreTranches(api, 'collectes', 1500);
  });

  it('Pesées par flux : 1 300 lignes de flux', async () => {
    const { api, ctx } = contexte({
      collecte_flux: suite(1300, (i) => ({
        id: id('flux', i),
        poids_reel_kg: 10,
        nb_bacs: 1,
        equivalent_roll: 1,
        flux_dechets: { nom: 'Biodéchets', ordre_affichage: 1 },
        collectes: {
          id: id('col', i),
          type: 'zero_dechet',
          date_collecte: '2026-03-10',
          evenements: evenement(i),
        },
      })),
      v_referentiel_traiteurs: [],
    });

    const { csv } = await buildPeseesExport(ctx, aucunFiltre);

    expect(lignesCsv(csv).lignes).toHaveLength(1300);
    attendreTranches(api, 'collecte_flux', 1300);
  });

  const facture = (i: number) => ({
    id: id('fac', i),
    numero_facture: `F-${i}`,
    type: 'zero_dechet',
    statut: 'emise',
    montant_ht: 100,
    montant_ttc: 120,
    date_emission: '2026-03-10',
    date_echeance: null,
    date_paiement: null,
  });

  it('Factures : 1 200 factures', async () => {
    const { api, ctx } = contexte({ factures: suite(1200, facture) });

    const { csv } = await buildFacturesExport(ctx, aucunFiltre);

    const { lignes } = lignesCsv(csv);
    expect(lignes).toHaveLength(1200);
    expect(new Set(lignes.map((l) => l[0])).size).toBe(1200);
    attendreTranches(api, 'factures', 1200);
  });

  it('Packs anti-gaspi : 1 100 packs', async () => {
    const { api, ctx } = contexte({
      packs_antgaspi: suite(1100, (i) => ({
        id: id('pack', i),
        type_pack: 'pack_10',
        credits_initiaux: 10,
        credits_consommes: 1,
        credits_restants: 9,
        date_achat: '2026-01-05',
        date_expiration: null,
        statut: 'actif',
        created_at: '2026-01-05T10:00:00Z',
      })),
    });

    const { csv } = await buildPacksAgExport(ctx, aucunFiltre);

    expect(lignesCsv(csv).lignes).toHaveLength(1100);
    attendreTranches(api, 'packs_antgaspi', 1100);
  });

  it('Associations (équipe Savr) : 1 050 associations', async () => {
    const { api, ctx } = contexte({
      associations: suite(1050, (i) => ({
        id: id('asso', i),
        nom: `Association ${id('', i)}`,
        adresse: null,
        ville: 'Paris',
        region: 'Île-de-France',
        contact_nom: null,
        contact_email: null,
        habilitee_attestation_fiscale: true,
        actif: true,
      })),
    });

    const { csv } = await buildAssociationsAgExport(ctx, aucunFiltre);

    expect(lignesCsv(csv).lignes).toHaveLength(1050);
    attendreTranches(api, 'associations', 1050);
  });

  it('Associations (traiteur) : cumuls sur ses 1 400 collectes AG, pas sur les 1 000 premières', async () => {
    const association = (i: number) =>
      i % 2 === 0
        ? { nom: 'Les Restos', ville: 'Paris', region: 'Île-de-France' }
        : { nom: 'Secours', ville: 'Lyon', region: 'Auvergne-Rhône-Alpes' };
    const { api, ctx } = contexte(
      {
        collectes: suite(1400, (i) => ({
          id: id('col', i),
          type: 'anti_gaspi',
          attributions_antgaspi: {
            association_id: i % 2 === 0 ? 'asso-a' : 'asso-b',
            volume_repas_realise: 5,
            associations: association(i),
          },
        })),
      },
      'traiteur_manager',
    );

    const { csv } = await buildAssociationsAgExport(ctx, aucunFiltre);

    // Association ; Ville ; Région ; Nb collectes ; Repas donnés
    expect(lignesCsv(csv).lignes).toEqual([
      ['Les Restos', 'Paris', 'Île-de-France', '700', '3500'],
      ['Secours', 'Lyon', 'Auvergne-Rhône-Alpes', '700', '3500'],
    ]);
    attendreTranches(api, 'collectes', 1400);
  });

  it(`Factures : ${PLAFOND_LIGNES + 1} factures lues en deux tranches, ${PLAFOND_LIGNES} lignes puis 1`, async () => {
    const { api, ctx } = contexte({
      factures: suite(PLAFOND_LIGNES + 1, facture),
    });

    await buildFacturesExport(ctx, aucunFiltre);

    const lectures = api.lecturesDe('factures');
    expect(lectures.map((l) => l.rendues)).toEqual([PLAFOND_LIGNES, 1]);
    expect(lectures.every((l) => l.tris.at(-1) === 'id')).toBe(true);
  });
});
