/**
 * M0.6 — Fiche collecte Admin : garde-fou régression colonne-DB (BL-P1-BOA-07).
 *
 * La fiche /admin/collectes/[id] plantait en écran blanc : son GET embarquait
 * des colonnes DB INEXISTANTES —
 *   - types_evenements.nom        → la vraie colonne est `libelle`
 *   - tournees.statut_tms         → la vraie colonne est `statut`
 *   - factures_collectes.statut   → le statut vit sur `factures.statut`
 * PostgREST renvoyait 400, la page désérialisait le corps d'erreur puis
 * déréférençait des champs undefined → exception client (écran blanc).
 *
 * Ce test monte la VRAIE page (aucun mock du composant sous test — gate G5),
 * ne moquant que les frontières (next/navigation + fetch), avec un payload aux
 * NOUVEAUX noms de colonnes, et asserte que Bloc 1 (type via
 * `types_evenements.libelle`), Bloc 0 (tournée via `tournees.statut`) et Bloc 6
 * (facture via `factures.statut`) s'affichent. Un second cas verrouille le
 * durcissement `res.ok` : une réponse non-ok bascule sur l'état d'erreur au lieu
 * de crasher.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import CollecteDetailPage from '@/app/(admin)/admin/collectes/[id]/page.js';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const COLLECTE = {
  id: 'c1',
  type: 'zero_dechet',
  statut: 'realisee',
  statut_tms: 'non_envoye',
  dirty_tms: false,
  date_collecte: '2025-06-02',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: null,
  controle_acces_requis: false,
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: null,
  evenements: {
    nom_evenement: 'Gala annuel',
    pax: 200,
    organisations: { raison_sociale: 'Traiteur Alpha' },
    lieux: { nom: 'Salle Beta', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail dînatoire' },
  },
  collecte_flux: [],
  collecte_tournees: [
    {
      rang: 1,
      tournees: {
        id: 't1',
        statut: 'planifiee',
        tms_reference: null,
        external_ref_commande: 'REF-42',
      },
    },
  ],
  factures_collectes: [
    { id: 'fc1', montant_ht: 120, factures: { statut: 'emise' } },
  ],
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => cleanup());

describe('M0.6 / Fiche collecte Admin / régression colonne-DB (BL-P1-BOA-07)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(okResponse(COLLECTE))),
    );
  });

  it('M0.6 — fiche collecte : type (types_evenements.libelle), tournée (tournees.statut) et facture (factures.statut) s’affichent sans crash', async () => {
    render(<CollecteDetailPage />);

    // Bloc 1 — le TYPE d'événement, rendu via types_evenements.libelle (ex-`nom`).
    expect(await screen.findByText('Cocktail dînatoire')).toBeInTheDocument();
    // Bloc 0 — statut de la tournée, rendu via tournees.statut (ex-`statut_tms`).
    expect(screen.getByText('planifiee')).toBeInTheDocument();
    expect(screen.getByText('REF-42')).toBeInTheDocument();
    // Bloc 6 — statut de la facture, rendu via factures.statut (ex-ligne `statut`).
    expect(screen.getByText('emise')).toBeInTheDocument();
  });

  it('M0.6 — fiche collecte : type manquant (types_evenements null) → « — » sans crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          okResponse({
            ...COLLECTE,
            evenements: { ...COLLECTE.evenements, types_evenements: null },
          }),
        ),
      ),
    );
    render(<CollecteDetailPage />);
    // La page monte (Bloc 1 présent) malgré types_evenements null : l'optional
    // chaining `?.libelle ?? '—'` protège le rendu.
    expect(await screen.findByText('Gala annuel')).toBeInTheDocument();
  });

  it('M0.6 — fiche collecte : réponse non-ok → état d’erreur (pas d’écran blanc)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: 'column ... does not exist' }),
        } as Response),
      ),
    );
    render(<CollecteDetailPage />);
    expect(await screen.findByText('Erreur chargement')).toBeInTheDocument();
  });
});
