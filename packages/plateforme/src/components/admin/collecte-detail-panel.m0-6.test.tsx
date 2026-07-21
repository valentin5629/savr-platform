/**
 * M0.6 — Fiche collecte Admin : Bloc 0 dispatch (BL-P1-BOA-06) + modale forçage
 * statut (BL-P1-RM-08). Sélecteur prestataire, fork bouton par type_tms, champ
 * motif override conditionnel, PATCH statut avec motif ≥ 10.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

// Le panel reçoit l'id par prop (collecteId) → il n'appelle plus useParams.
// On garde useRouter : next/link (utilisé dans le panel) peut le requérir sous jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';

const collecteAg = {
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'non_envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: 12,
  controle_acces_requis: false,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  // Collecte AG non encore attribuée (comme sur le preview réel).
  prestataire_logistique_id: null,
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    organisations: { raison_sociale: 'Traiteur Beta' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  // Colonnes DB réelles (BL-P0 fiche corrigée) : tournees.statut (pas statut_tms),
  // factures_collectes → factures.statut (le statut vit sur la facture parente).
  collecte_tournees: [
    {
      rang: 1,
      tournees: {
        id: 'tour-1',
        statut: 'planifiee',
        tms_reference: 'TMS-42',
        external_ref_commande: 'CMD-42',
      },
    },
  ],
  factures_collectes: [
    { id: 'fc-1', montant_ht: 120, factures: { statut: 'emise' } },
  ],
};

const transporteurs = [
  {
    id: 't-mts1',
    nom: 'Strike',
    type_tms: 'mts1',
    prestataire_logistique_id: 'presta-mts1',
    actif: true,
  },
  {
    id: 't-atoutes',
    nom: 'A Toutes!',
    type_tms: 'a_toutes',
    prestataire_logistique_id: 'presta-atoutes',
    actif: true,
  },
];

function mockFetch() {
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      if (url.startsWith('/api/v1/admin/transporteurs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: transporteurs }),
        });
      }
      // Recommandation algo (top-1 = Strike / t-mts1) — Bloc 0 pré-sélectionne le
      // top-1 et n'exige un motif override que si le choix ≠ top-1.
      if (url.includes('/recommandation')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              associations: [{ id: 'a1', nom: 'Les Restos du Cœur' }],
              transporteur: { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
              no_asso: false,
              no_prestataire: false,
            },
          }),
        });
      }
      if (url === '/api/v1/admin/collectes/c1' && method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => collecteAg });
      }
      if (url.includes('/dispatch')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true, event_type: 'collecte.creee' }),
        });
      }
      // Bloc 3 Documents / Bloc 7 Audit (BOA-07) — shapes vides pour ces tests Bloc 0.
      if (url.endsWith('/documents')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            rapport: null,
            bordereau: null,
            attestation: null,
            photos: [],
          }),
        });
      }
      if (url.endsWith('/audit')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [], recredit_at: null }),
        });
      }
      // GET collecte
      return Promise.resolve({ ok: true, json: async () => collecteAg });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('M0.6 — fiche collecte Bloc 0 dispatch + RM-08 (BL-P1-BOA-06 / RM-08)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — Bloc 0 affiche la reco algo (prestataire + association) + pré-sélectionne le top-1', async () => {
    mockFetch();
    render(<CollecteDetailPanel collecteId="c1" />);

    // Recommandation algo affichée (§06.09) : prestataire top-1 + association.
    // findAllByText : l'association apparaît en Bloc 0 (reco) ET Bloc 5 (top-3) — BOA-07.
    expect(
      (await screen.findAllByText('Les Restos du Cœur')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Recommandation algo')).toBeInTheDocument();
    expect(screen.getByText('Strike (mts1)')).toBeInTheDocument();
    // Collecte non attribuée
    expect(screen.getByText('Aucun prestataire attribué')).toBeInTheDocument();

    // Pré-sélection du top-1 recommandé → bouton « Envoyer à MTS-1 », et AUCUN
    // motif override requis (on valide la reco).
    expect(
      await screen.findByRole('button', { name: /Envoyer à MTS-1/ }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Motif override/)).not.toBeInTheDocument();
  });

  it('M0.6 — choix ≠ top-1 algo → bouton A Toutes! + motif override obligatoire (≥ 5)', async () => {
    mockFetch();
    render(<CollecteDetailPanel collecteId="c1" />);
    // Attendre la pré-sélection du top-1 (bouton MTS-1)
    await screen.findByRole('button', { name: /Envoyer à MTS-1/ });

    // Choisir A Toutes! (≠ top-1 Strike) → override → motif obligatoire
    fireEvent.change(screen.getByLabelText('Prestataire à attribuer'), {
      target: { value: 't-atoutes' },
    });

    const bouton = screen.getByRole('button', { name: /Envoyer à A Toutes!/ });
    const motif = screen.getByLabelText(/Motif override/);
    expect(motif).toBeInTheDocument();
    expect(bouton).toBeDisabled();
    fireEvent.change(motif, { target: { value: 'Zone vélo cargo IDF' } });
    expect(bouton).not.toBeDisabled();

    // Re-sélection du top-1 recommandé → plus de motif requis (validation reco)
    fireEvent.change(screen.getByLabelText('Prestataire à attribuer'), {
      target: { value: 't-mts1' },
    });
    expect(screen.queryByLabelText(/Motif override/)).not.toBeInTheDocument();
  });

  it('M0.6 — modale forçage statut : PATCH exige un motif ≥ 10 caractères', async () => {
    const fetchMock = mockFetch();
    render(<CollecteDetailPanel collecteId="c1" />);
    await screen.findByText('Prestataire actuel');

    // Ouvre la modale (déclencheur d'en-tête)
    fireEvent.click(screen.getByRole('button', { name: /Forcer le statut/ }));

    const dialog = screen
      .getByText('Forcer le statut de la collecte')
      .closest('div') as HTMLElement;
    const confirmer = within(dialog).getByRole('button', {
      name: /Confirmer le forçage/,
    });
    // Motif vide → soumission désactivée
    expect(confirmer).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText('Nouveau statut'), {
      target: { value: 'validee' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Motif \(obligatoire/), {
      target: { value: 'Validation manuelle après échange traiteur' },
    });
    expect(confirmer).not.toBeDisabled();

    fireEvent.click(confirmer);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) =>
          c[0] === '/api/v1/admin/collectes/c1' &&
          (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as {
        statut: string;
        motif: string;
      };
      expect(body.statut).toBe('validee');
      expect(body.motif.length).toBeGreaterThanOrEqual(10);
    });
  });

  // Régression BL-P0 : le GET fiche référençait des colonnes DB inexistantes
  // (types_evenements.nom, tournees.statut_tms, factures_collectes.statut) → 400
  // → crash blanc. Ce test rend la fiche avec les shapes DB corrigées.
  it('M0.6 — rend type d’événement (libelle), tournée (statut) et facture (factures.statut)', async () => {
    mockFetch();
    render(<CollecteDetailPanel collecteId="c1" />);
    await screen.findByText('Prestataire actuel');

    // types_evenements.libelle (Bloc 1)
    expect(screen.getByText('Cocktail apéritif')).toBeInTheDocument();
    // tournees.statut (Bloc 0 — liste multi-camions)
    expect(screen.getByText('planifiee')).toBeInTheDocument();
    // factures_collectes → factures.statut (Bloc 6)
    expect(screen.getByText('emise')).toBeInTheDocument();
  });

  it('M0.6 — modale N camions : PATCH nb_camions_demande (RM-02)', async () => {
    const fetchMock = mockFetch();
    render(<CollecteDetailPanel collecteId="c1" />);
    await screen.findByText('Prestataire actuel');

    // Bouton « Modifier » à côté de Nb camions (statut programmee = éditable).
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    const dialog = screen
      .getByText('Modifier le nombre de camions')
      .closest('div') as HTMLElement;
    fireEvent.change(within(dialog).getByLabelText('Nombre de camions'), {
      target: { value: '3' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enregistrer' }),
    );

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        (c) =>
          c[0] === '/api/v1/admin/collectes/c1' &&
          (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as {
        nb_camions_demande: number;
      };
      expect(body.nb_camions_demande).toBe(3);
    });
  });
});

// ============================================================================
// BL-P1-BOA-07 — Blocs Documents / Pack AG / Attribution AG / Timeline (§06.06
// l.246-270). Remplace le stub « algo V2 » du Bloc 5, câble régénération PDF +
// import photo + audit.
// ============================================================================

const baseAg = {
  id: 'c1',
  type: 'anti_gaspi' as const,
  statut: 'realisee',
  statut_tms: 'acceptee',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-05-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: 'TMS-9',
  volume_estime_repas: 50,
  controle_acces_requis: false,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: 'p1',
  packs_antgaspi: {
    id: 'p1',
    type_pack: 'Pack 10 collectes',
    credits_restants: 7,
    statut: 'actif',
  },
  attributions_antgaspi: {
    id: 'attr1',
    mode_validation: 'manuel',
    valide_at: '2026-05-01T10:00:00Z',
    volume_repas_realise: 42,
    associations: { nom: 'Les Restos du Cœur' },
    transporteurs: { nom: 'A Toutes!' },
  },
  prestataire_logistique_id: null,
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    organisations: { raison_sociale: 'Traiteur Beta' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  collecte_tournees: [],
  factures_collectes: [],
};

const documentsAg = {
  rapport: {
    id: 'r1',
    version: 2,
    disponible_a: '2026-05-11T06:00:00Z',
    genere_at: '2026-05-11T06:05:00Z',
    regenere_at: '2026-05-12T09:00:00Z',
    consulte_par_user_at: null,
    pdf_url: 'rapports/r1.pdf',
  },
  bordereau: null,
  attestation: {
    id: 'a1',
    statut: 'emise',
    numero: 'ATT-DON-2026-00001',
    genere_at: '2026-05-11T06:05:00Z',
    pdf_url: 'rapports/a1.pdf',
    version: 1,
  },
  photos: [],
};

const auditAg = {
  data: [
    {
      id: 'au1',
      created_at: '2026-05-10T20:00:00Z',
      role: 'admin_savr',
      action: 'collecte_statut_force',
      old_values: { statut: 'validee' },
      new_values: { statut: 'realisee' },
      motif: 'Confirmation réalisation terrain',
      impersonator_id: null,
    },
  ],
  recredit_at: null,
};

// Fixtures ZD (Bloc 3 bordereau, pas d'attestation ni pack/attribution AG).
const baseZd = {
  ...baseAg,
  type: 'zero_dechet' as const,
  packs_antgaspi: null,
  attributions_antgaspi: null,
};

const documentsZd = {
  rapport: documentsAg.rapport,
  bordereau: {
    id: 'b1',
    statut: 'emis',
    numero: 'BSAV-2026-00001',
    genere_at: '2026-05-11T06:05:00Z',
    pdf_fichier_id: 'fich-1',
  },
  attestation: null,
  photos: [],
};

const recoAg = {
  data: {
    // Scores détaillés (distance, capacité) — §06.06 l.253, exposés par l'algo.
    associations: [
      {
        id: 'a1',
        nom: 'Les Restos du Cœur',
        distance_km: 3.2,
        capacite_max_beneficiaires: 200,
      },
      { id: 'a2', nom: 'Banque Alimentaire' },
      { id: 'a3', nom: 'Secours Populaire' },
    ],
    transporteur: { id: 't-mts1', nom: 'Strike', type_tms: 'mts1' },
    no_asso: false,
    no_prestataire: false,
  },
};

function installMock(opts: {
  collecte?: Record<string, unknown>;
  documents?: unknown;
  audit?: unknown;
}) {
  const collecte = opts.collecte ?? baseAg;
  const documents = opts.documents ?? documentsAg;
  const audit = opts.audit ?? auditAg;
  const fetchMock = vi.fn(
    (url: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? 'GET';
      const ok = (json: unknown, status = 200) =>
        Promise.resolve({ ok: status < 400, status, json: async () => json });

      // Régénération PDF (POST /documents/<type>/regenerate)
      if (url.includes('/documents/') && method === 'POST') {
        return ok({ job_id: 'job-1', type: 'x' }, 202);
      }
      if (url.endsWith('/documents')) return ok(documents);
      if (url.endsWith('/audit')) return ok(audit);
      if (url.includes('/photos') && method === 'POST') {
        return ok({ fichier: { id: 'f1' } }, 201);
      }
      if (url.includes('/download')) return ok({ url: 'https://r2/signed' });
      if (url.startsWith('/api/v1/admin/transporteurs'))
        return ok({ data: [] });
      if (url.includes('/recommandation')) return ok(recoAg);
      if (url.includes('/dispatch')) return ok({ ok: true });
      return ok(collecte);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('M0.6 — fiche collecte Documents/Pack/Attribution/Timeline (BL-P1-BOA-07)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — Bloc 3 Documents : rapport RSE + attestation AG affichés ; le bouton Régénérer appelle l’endpoint de régénération', async () => {
    const fetchMock = installMock({});
    render(<CollecteDetailPanel collecteId="c1" />);

    // Bloc Documents rendu + rapport + attestation (AG).
    expect(await screen.findByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('Rapport RSE')).toBeInTheDocument();
    expect(screen.getByText('Attestation de don')).toBeInTheDocument();
    expect(screen.getByText('ATT-DON-2026-00001')).toBeInTheDocument();

    // Régénérer le rapport → POST /documents/rapport-recyclage-zd/regenerate.
    const regenBtns = screen.getAllByRole('button', { name: /Régénérer/ });
    fireEvent.click(regenBtns[0]!);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes(
            '/documents/rapport-recyclage-zd/regenerate',
          ) &&
          (c[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(call).toBeTruthy();
    });
  });

  it('M0.6 — Bloc 3 : picto « régénéré » affiché quand version ≠ initiale', async () => {
    installMock({});
    render(<CollecteDetailPanel collecteId="c1" />);
    // rapport.version = 2 + regenere_at → picto ⟳ avec title « Rapport régénéré ».
    expect(await screen.findByTitle(/Rapport régénéré/)).toBeInTheDocument();
  });

  it('M0.6 — Bloc 4 Pack AG : pack rattaché + crédits restants + statut', async () => {
    installMock({});
    render(<CollecteDetailPanel collecteId="c1" />);
    expect(await screen.findByText('Pack AG')).toBeInTheDocument();
    expect(screen.getByText('Pack 10 collectes')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('M0.6 — Bloc 4 : badge « Crédit recrédité » si collecte annulee après réalisation', async () => {
    installMock({
      collecte: { ...baseAg, statut: 'annulee' },
      audit: { data: [], recredit_at: '2026-06-01T08:00:00Z' },
    });
    render(<CollecteDetailPanel collecteId="c1" />);
    expect(
      await screen.findByText(/Crédit recrédité automatiquement le/),
    ).toBeInTheDocument();
  });

  it('M0.6 — Bloc 5 Attribution AG : association + transporteur retenus + lien vers l’écran complet (plus de stub « algo V2 »)', async () => {
    installMock({});
    render(<CollecteDetailPanel collecteId="c1" />);

    expect(await screen.findByText('Attribution AG')).toBeInTheDocument();
    // Association + transporteur retenus (embed attributions_antgaspi).
    expect(screen.getAllByText('Les Restos du Cœur').length).toBeGreaterThan(0);
    expect(screen.getByText('A Toutes!')).toBeInTheDocument();
    // Lien vers l'écran d'attribution complète (§06.09).
    const lien = screen.getByRole('link', { name: /attribution compl/i });
    expect(lien).toHaveAttribute('href', '/admin/attributions-ag/c1');
    // Le stub V2 a disparu.
    expect(
      screen.queryByText(/algo V2.*Non disponible en V1/),
    ).not.toBeInTheDocument();
  });

  it('M0.6 — Bloc 7 Timeline : les entrées d’audit sont rendues (action + transition de statut)', async () => {
    installMock({});
    render(<CollecteDetailPanel collecteId="c1" />);
    expect(await screen.findByText('Historique & audit')).toBeInTheDocument();
    expect(screen.getByText('collecte_statut_force')).toBeInTheDocument();
    // Transition old → new statut.
    expect(screen.getByText(/validee → realisee/)).toBeInTheDocument();
    expect(
      screen.getByText(/Confirmation réalisation terrain/),
    ).toBeInTheDocument();
  });

  it('M0.6 — Bloc 3 : « Importer des photos » envoie un POST multipart /photos', async () => {
    const fetchMock = installMock({});
    const { container } = render(<CollecteDetailPanel collecteId="c1" />);
    await screen.findByText('Documents');

    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          (c[0] as string).endsWith('/photos') &&
          (c[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect((call![1] as { body?: unknown }).body instanceof FormData).toBe(
        true,
      );
    });
  });

  it('M0.6 — Bloc 3 : bordereau ZD affiché pour une collecte ZD (numéro + statut) ; pas d’attestation AG', async () => {
    installMock({ collecte: baseZd, documents: documentsZd });
    render(<CollecteDetailPanel collecteId="c1" />);
    expect(await screen.findByText('Bordereau ZD')).toBeInTheDocument();
    expect(screen.getByText('BSAV-2026-00001')).toBeInTheDocument();
    expect(screen.getByText(/Statut : emis/)).toBeInTheDocument();
    // Une collecte ZD n'a pas d'attestation de don (bloc AG masqué).
    expect(screen.queryByText('Attestation de don')).not.toBeInTheDocument();
    // Ni de Bloc 4/5 AG.
    expect(screen.queryByText('Pack AG')).not.toBeInTheDocument();
    expect(screen.queryByText('Attribution AG')).not.toBeInTheDocument();
  });

  it('M0.6 — Bloc 3 : la galerie affiche les photos importées (shared.fichiers, URL R2)', async () => {
    installMock({
      documents: {
        ...documentsAg,
        photos: [
          {
            id: 'ph1',
            content_type: 'image/png',
            created_at: '2026-05-11T00:00:00Z',
            url: 'https://r2/signed-photo',
          },
        ],
      },
    });
    const { container } = render(<CollecteDetailPanel collecteId="c1" />);
    await screen.findByText('Documents');
    expect(screen.getByText('Photos (1)')).toBeInTheDocument();
    const img = container.querySelector(
      'img[alt="Photo collecte"]',
    ) as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('https://r2/signed-photo');
  });

  it('M0.6 — Bloc 5 : top 3 affiche les scores détaillés (distance + capacité, §06.06 l.253)', async () => {
    // Collecte AG NON terminale → l'algo (reco) est appelé → top 3 + scores rendus.
    installMock({ collecte: { ...baseAg, statut: 'programmee' } });
    render(<CollecteDetailPanel collecteId="c1" />);
    expect(await screen.findByText(/3\.2 km/)).toBeInTheDocument();
    expect(screen.getByText(/capacité 200/)).toBeInTheDocument();
  });
});
