import { vi } from 'vitest';
import type { FicheClientDonnees } from '@/components/collecte/fiche-collecte-client-onglets';

/**
 * Fixture de la réponse GET /api/v1/{espace}/collectes/[id] (pop-up fiche
 * collecte client) — forme EXACTE du contrat `FicheCollecteClient`, pour les
 * tests de rendu des 3 espaces.
 */
export function ficheClient(
  over: Partial<FicheClientDonnees> = {},
): FicheClientDonnees {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    statut_tms: 'acceptee',
    tms_reference: null,
    date_collecte: '2026-10-28',
    heure_collecte: '22:00:00',
    // Pax de la collecte (décision Val 2026-10-20) : il porte la taille et les
    // ratios « par pax » du bilan (lot C1). L'événement, sur deux soirées, en
    // compte le double : un écran qui lirait l'événement se trahit.
    pax: 4200,
    controle_acces_requis: true,
    informations_completes: true,
    informations_supplementaires: 'Quai B, badge à l’accueil',
    taux_recyclage: null,
    co2_evite_kg: null,
    realisee_at: null,
    aucun_repas_motif: null,
    // Type d'événement et contacts de LA collecte (lot B1).
    type_evenement_id: 't1',
    type_evenement: { libelle: 'Cocktail apéritif' },
    contacts_visibles: true,
    contact_principal_nom: 'Paul Contact',
    contact_principal_telephone: '+33 6 11 22 33 44',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    taille_bracket: 'XL',
    evenement: {
      id: 'e1',
      nom_evenement: 'Salon',
      pax: 8400,
      nom_client_organisateur: 'Maison Client',
      reference_affaire: null,
      lieu: {
        id: 'l1',
        nom: 'Paris Expo Porte de Versailles',
        adresse_acces: '1 Place de la Porte de Versailles',
        code_postal: '75015',
        ville: 'Paris',
        acces_details: 'Entrée logistique hall 7',
      },
    },
    tournees: [],
    coordonnees_urgence_demandee: false,
    bilan_flux: null,
    repas_donnes: null,
    association: null,
    rapport_rse_disponible: false,
    rapport_rse_regenere: false,
    rapport_reserve_donneur_ordre: false,
    // Par défaut, cohérent avec les deux indicateurs comme le calcule le
    // serveur (etatRapport) ; un test peut forcer n'importe quel état.
    rapport_etat: over.rapport_reserve_donneur_ordre
      ? 'reserve'
      : over.rapport_rse_disponible
        ? 'disponible'
        : 'a_venir',
    actions: { modifier: 'actif', annuler: 'actif', annulation: 'demande' },
    ...over,
  };
}

function reponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

/**
 * Routeur de fetch de la fiche : détail, radar (flux ou « indisponible »),
 * options de filtres, demande urgente, annulation, téléchargement.
 */
export function stubFetchFiche(
  detail: unknown,
  opts: {
    detailStatus?: number;
    benchmark?: 'ok' | 'indisponible';
    urgenceStatus?: number;
    // Rapport de recyclage fabriqué au clic : refus du serveur (statut + motif).
    rapportRefus?: { status: number; error: string };
  } = {},
): void {
  // jsdom n'implémente pas les URL d'objet : le PDF reçu est « enregistré » ici.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:rapport'),
    revokeObjectURL: vi.fn(),
  });
  // …et le lien de téléchargement n'ouvre aucune navigation (jsdom ne la gère pas).
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.includes('/benchmark/filtres'))
        return Promise.resolve(
          reponse(200, {
            data: {
              lieux: [{ id: 'l1', nom: 'Paris Expo Porte de Versailles' }],
              traiteurs: [{ id: 'tr1', nom: 'Traiteur Concurrent' }],
              types: [{ id: 't1', libelle: 'Cocktail apéritif' }],
            },
          }),
        );
      if (u.includes('/benchmark'))
        return Promise.resolve(
          reponse(
            200,
            opts.benchmark === 'indisponible'
              ? { data: null }
              : {
                  data: {
                    flux: {
                      biodechet: { ratio_user: 0.4, benchmark_kg_pax: 0.3 },
                    },
                  },
                },
          ),
        );
      if (u.includes('/coordonnees-urgence'))
        return Promise.resolve(
          reponse(opts.urgenceStatus ?? 200, { data: { demandee: true } }),
        );
      if (u.endsWith('/rapport-rse') && init?.method === 'POST')
        return Promise.resolve(
          opts.rapportRefus
            ? reponse(opts.rapportRefus.status, {
                error: opts.rapportRefus.error,
              })
            : ({
                ok: true,
                status: 200,
                headers: new Headers({
                  'Content-Type': 'application/pdf',
                  'Content-Disposition':
                    'attachment; filename="rapport-recyclage-2026-09-28.pdf"',
                }),
                blob: () => Promise.resolve(new Blob(['%PDF'])),
              } as unknown as Response),
        );
      if (init?.method === 'POST')
        return Promise.resolve(reponse(200, { data: {} }));
      if (u.includes('/rapport-rse/download'))
        return Promise.resolve(
          reponse(200, { url: 'https://r2.example/rapport.pdf' }),
        );
      const status = opts.detailStatus ?? 200;
      return Promise.resolve(
        reponse(status, status === 200 ? { data: detail } : { error: 'x' }),
      );
    }),
  );
}

/** Rapports de recyclage demandés (POST `…/rapport-rse`), avec leur corps. */
export function rapportsDemandes(): Array<{
  url: string;
  corps: unknown;
}> {
  return (
    globalThis.fetch as unknown as {
      mock: { calls: [unknown, { method?: string; body?: string }?][] };
    }
  ).mock.calls
    .filter(
      ([u, init]) =>
        String(u).endsWith('/rapport-rse') && init?.method === 'POST',
    )
    .map(([u, init]) => ({
      url: String(u),
      corps: init?.body === undefined ? undefined : JSON.parse(init.body),
    }));
}

/** URLs appelées par le fetch stubbé. */
export function urlsAppelees(): Array<{ url: string; method?: string }> {
  return (
    globalThis.fetch as unknown as {
      mock: { calls: [unknown, { method?: string }?][] };
    }
  ).mock.calls.map(([u, init]) => ({ url: String(u), method: init?.method }));
}
