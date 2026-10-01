/**
 * R25a — Barre de filtres de la liste Collectes traiteur (§06.04 §3).
 * Vérifie ce qui est UX-critique et régressable :
 *  - le filtre Statut propose les LIBELLÉS de la vue client (jamais « Programmée »)
 *    et un libellé sélectionné rend TOUS les statuts DB qu'il regroupe ;
 *  - les libellés « Programmée par » suivent le format CDC (Agence : X …) ;
 *  - « Réinitialiser » n'apparaît que si un filtre est posé, et vide tout.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  CollecteFiltresBar,
  FILTRES_COLLECTE_VIDES,
  filtresCollecteActifs,
  memeFiltresCollecte,
  lireFiltresCollecte,
  ecrireFiltresCollecte,
  type CollecteFiltres,
} from '@/components/collecte/collecte-filtres-bar';
import { groupesStatutClient } from '@/lib/statut-collecte-labels';

const STATUTS_PROGRAMMEES = ['brouillon', 'programmee', 'validee', 'en_cours'];
const STATUTS_HISTORIQUE = [
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

const OPTIONS = {
  lieux: [
    { id: 'lieu-a', nom: 'Pavillon Gabriel' },
    { id: 'lieu-b', nom: 'Carrousel du Louvre' },
    { id: 'lieu-c', nom: 'Palais Brongniart' },
  ],
  clients: ['Danone', 'Kering, Paris'],
  programmateurs: [
    { id: 'org-1', nom: 'Mon organisation', type: null },
    { id: 'org-2', nom: 'WPM', type: 'agence' },
    { id: 'org-3', nom: 'Viparis', type: 'gestionnaire_lieux' },
  ],
};

function renderBar(
  value: CollecteFiltres = FILTRES_COLLECTE_VIDES,
  statutsOnglet = STATUTS_PROGRAMMEES,
) {
  const onChange = vi.fn();
  render(
    <CollecteFiltresBar
      statutsOnglet={statutsOnglet}
      options={OPTIONS}
      value={value}
      onChange={onChange}
      resultats={3}
    />,
  );
  return { onChange };
}

describe('M3.1 / R25a — groupes de statuts en vue client', () => {
  it('R25a/statuts_groupes_jamais_programmee', () => {
    const labels = groupesStatutClient(STATUTS_PROGRAMMEES).map((g) => g.label);
    // Mapping canonique 2026-06-30 : le client ne voit JAMAIS « Programmée ».
    expect(labels).not.toContain('Programmée');
    expect(labels).toEqual(['Créée', 'Validée', 'En cours']);
  });

  it('R25a/statuts_groupe_creee_couvre_brouillon_et_programmee', () => {
    const creee = groupesStatutClient(STATUTS_PROGRAMMEES).find(
      (g) => g.label === 'Créée',
    );
    expect(creee?.statuts).toEqual(['brouillon', 'programmee']);
  });

  it('R25a/statuts_historique_annulee_regroupe_les_deux_statuts_db', () => {
    const groupes = groupesStatutClient(STATUTS_HISTORIQUE);
    expect(groupes.find((g) => g.label === 'Annulée')?.statuts).toEqual([
      'annulation_demandee',
      'annulee',
    ]);
    // « Réalisée » = cloturee SEUL ; realisee reste « En cours ».
    expect(groupes.find((g) => g.label === 'Réalisée')?.statuts).toEqual([
      'cloturee',
    ]);
    expect(groupes.find((g) => g.label === 'En cours')?.statuts).toEqual([
      'realisee',
    ]);
  });

  it('R25a/statut_selectionne_rend_tous_les_statuts_db_du_groupe', () => {
    const { onChange } = renderBar();
    // Filtre en ligne à cocher : on ouvre la liste puis on coche le groupe.
    fireEvent.click(screen.getByTestId('filtre-statut'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Créée' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuts: ['brouillon', 'programmee'] }),
    );
  });
});

describe('M3.1 / R25a — « Programmée par » et réinitialisation', () => {
  it('R25a/programmee_par_libelles_cdc', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('filtre-programmee-par'));
    expect(
      screen.getByRole('checkbox', { name: 'Mon organisation' }),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Agence : WPM' })).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Gestionnaire : Viparis' }),
    ).toBeTruthy();
  });

  it('R25a/reinitialiser_absent_sans_filtre_actif', () => {
    renderBar();
    expect(screen.queryByTestId('collecte-filtres-bar-reset')).toBeNull();
  });

  it('R25a/reinitialiser_vide_tous_les_filtres', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      clients: ['Danone'],
      infoIncomplete: 'oui',
      programmeePar: ['org-2'],
    });
    fireEvent.click(screen.getByTestId('collecte-filtres-bar-reset'));
    expect(onChange).toHaveBeenCalledWith(FILTRES_COLLECTE_VIDES);
  });

  it('R25a/compteur_resultats_accorde', () => {
    renderBar();
    expect(
      screen.getByTestId('collectes-resultats-count').textContent,
    ).toContain('3 collectes correspondent');
  });
});

describe('M3.1 / R25a — helpers de filtres', () => {
  it('R25a/filtres_actifs_detecte_chaque_dimension', () => {
    expect(filtresCollecteActifs(FILTRES_COLLECTE_VIDES)).toBe(false);
    const dims: Partial<CollecteFiltres>[] = [
      { statuts: ['cloturee'] },
      { from: '2026-01-01' },
      { to: '2026-01-31' },
      { lieuIds: ['lieu-a'] },
      { clients: ['Danone'] },
      { infoIncomplete: 'oui' },
      { programmeePar: ['org-2'] },
    ];
    for (const d of dims)
      expect(filtresCollecteActifs({ ...FILTRES_COLLECTE_VIDES, ...d })).toBe(
        true,
      );
  });

  it('R25a/meme_filtres_compare_chaque_dimension', () => {
    expect(
      memeFiltresCollecte(FILTRES_COLLECTE_VIDES, {
        ...FILTRES_COLLECTE_VIDES,
      }),
    ).toBe(true);
    expect(
      memeFiltresCollecte(FILTRES_COLLECTE_VIDES, {
        ...FILTRES_COLLECTE_VIDES,
        lieuIds: ['lieu-a'],
      }),
    ).toBe(false);
    expect(
      memeFiltresCollecte(
        { ...FILTRES_COLLECTE_VIDES, clients: ['Danone'] },
        { ...FILTRES_COLLECTE_VIDES, clients: ['Kering, Paris'] },
      ),
    ).toBe(false);
    expect(
      memeFiltresCollecte(
        { ...FILTRES_COLLECTE_VIDES, statuts: ['a'] },
        { ...FILTRES_COLLECTE_VIDES, statuts: ['b'] },
      ),
    ).toBe(false);
  });
});

describe('M3.1 / barre de filtres Collectes — choix multiple, « Tous », Période en premier', () => {
  it('M3.1/barre_periode_en_premier', () => {
    renderBar();
    const periode = screen.getByTestId('filtre-periode');
    for (const id of [
      'filtre-statut',
      'filtre-lieu',
      'filtre-client',
      'filtre-info-incomplete',
      'filtre-programmee-par',
    ])
      expect(
        periode.compareDocumentPosition(screen.getByTestId(id)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
  });

  it('M3.1/barre_lieu_liste_a_cocher_ajoute_au_choix_existant', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      lieuIds: ['lieu-a'],
    });
    fireEvent.click(screen.getByTestId('filtre-lieu'));
    // Le lieu déjà choisi est coché, « Tous » ne l'est pas.
    expect(
      screen.getByRole('checkbox', { name: 'Pavillon Gabriel' }),
    ).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tous' })).not.toBeChecked();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Carrousel du Louvre' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ lieuIds: ['lieu-a', 'lieu-b'] }),
    );
  });

  it('M3.1/barre_lieu_case_tous_efface_et_tout_cocher_revient_a_tous', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      lieuIds: ['lieu-a', 'lieu-b'],
    });
    fireEvent.click(screen.getByTestId('filtre-lieu'));
    // Cocher le dernier lieu = tous cochés = aucun filtre.
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Palais Brongniart' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ lieuIds: [] }),
    );
    // « Tous » efface la sélection.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tous' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ lieuIds: [] }),
    );
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('M3.1/barre_client_liste_a_cocher_sur_les_noms', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      clients: ['Danone'],
    });
    expect(screen.getByTestId('filtre-client')).toHaveTextContent('Danone');
    fireEvent.click(screen.getByTestId('filtre-client'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Danone' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ clients: [] }),
    );
  });

  it('M3.1/barre_info_incomplete_deux_cases_une_seule_filtre', () => {
    const { onChange } = renderBar();
    expect(screen.getByTestId('filtre-info-incomplete')).toHaveTextContent(
      'Toutes',
    );
    fireEvent.click(screen.getByTestId('filtre-info-incomplete'));
    expect(screen.getByRole('checkbox', { name: 'Toutes' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Oui' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ infoIncomplete: 'oui' }),
    );
  });

  it('M3.1/barre_info_incomplete_les_deux_cochees_egale_toutes', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      infoIncomplete: 'oui',
    });
    fireEvent.click(screen.getByTestId('filtre-info-incomplete'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Non' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ infoIncomplete: '' }),
    );
  });

  it('M3.1/url_client_parametre_repete_virgule_conservee', () => {
    const usp = ecrireFiltresCollecte(new URLSearchParams('client=Ancien'), {
      ...FILTRES_COLLECTE_VIDES,
      lieuIds: ['lieu-a', 'lieu-b'],
      clients: ['Danone', 'Kering, Paris'],
    });
    // Lieux en CSV, clients en paramètre RÉPÉTÉ (l'ancienne valeur est retirée).
    expect(usp.get('lieu')).toBe('lieu-a,lieu-b');
    expect(usp.getAll('client')).toEqual(['Danone', 'Kering, Paris']);
  });

  it('M3.1/url_ancien_lien_valeur_unique_lu_comme_liste_d_un_element', () => {
    // Drill-down des Top listes (`?lieu=<id>`) et liens partagés avant le
    // choix multiple (`?client=<nom>`).
    expect(
      lireFiltresCollecte(new URLSearchParams('lieu=lieu-a&client=Danone')),
    ).toMatchObject({ lieuIds: ['lieu-a'], clients: ['Danone'] });
  });
});

describe('Filtres Collectes traiteur — synchronisation URL', () => {
  it('url/aller_retour_conserve_chaque_dimension', () => {
    const f: CollecteFiltres = {
      statuts: ['brouillon', 'programmee'],
      from: '2026-09-01',
      to: '2026-09-30',
      lieuIds: ['lieu-a', 'lieu-b'],
      // Un nom peut porter une virgule : il n'est jamais découpé.
      clients: ['Danone', 'Kering, Paris'],
      infoIncomplete: 'oui',
      programmeePar: ['org-1', 'org-2'],
    };
    const usp = ecrireFiltresCollecte(
      new URLSearchParams('onglet=historique'),
      f,
    );
    expect(lireFiltresCollecte(usp)).toEqual(f);
    // Les clés hors filtres (onglet, type, drill-down) sont conservées.
    expect(usp.get('onglet')).toBe('historique');
  });

  it('url/filtre_vide_retire_la_cle', () => {
    const usp = ecrireFiltresCollecte(
      new URLSearchParams('lieu=lieu-a&statut=cloturee&commercial=u1'),
      FILTRES_COLLECTE_VIDES,
    );
    expect(usp.toString()).toBe('commercial=u1');
  });

  it('url/cles_du_drill_down_dashboard_pre_remplissent_la_barre', () => {
    // Le drill-down d'une Top liste pose lieu + statut cloturee + période.
    const f = lireFiltresCollecte(
      new URLSearchParams(
        'lieu=lieu-a&statut=cloturee&from=2025-07-13&to=2026-07-13&info=peut-etre',
      ),
    );
    expect(f).toMatchObject({
      lieuIds: ['lieu-a'],
      statuts: ['cloturee'],
      from: '2025-07-13',
      to: '2026-07-13',
      // Valeur hors domaine ignorée.
      infoIncomplete: '',
    });
  });
});
