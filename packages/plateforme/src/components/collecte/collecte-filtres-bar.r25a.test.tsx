/**
 * R25a — Barre de filtres de la liste Collectes traiteur (§06.04 §3).
 * Vérifie ce qui est UX-critique et régressable :
 *  - le filtre Statut propose les LIBELLÉS de la vue client (jamais « Programmée »)
 *    et un libellé sélectionné rend TOUS les statuts DB qu'il regroupe ;
 *  - les libellés « Programmée par » suivent le format CDC (Agence : X …) ;
 *  - « Réinitialiser » n'apparaît que si un filtre est posé, et vide tout.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import {
  CollecteFiltresBar,
  FILTRES_COLLECTE_VIDES,
  filtresCollecteActifs,
  memeFiltresCollecte,
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
  lieux: [{ id: 'lieu-a', nom: 'Pavillon Gabriel' }],
  clients: ['Danone'],
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
    // Le déclencheur du multi-select est le seul bouton du bloc tant qu'il est fermé.
    fireEvent.click(
      within(screen.getByTestId('filtre-statut')).getByRole('button'),
    );
    fireEvent.click(screen.getByLabelText('Créée'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ statuts: ['brouillon', 'programmee'] }),
    );
  });
});

describe('M3.1 / R25a — « Programmée par » et réinitialisation', () => {
  it('R25a/programmee_par_libelles_cdc', () => {
    renderBar();
    fireEvent.click(
      within(screen.getByTestId('filtre-programmee-par')).getByRole('button'),
    );
    expect(screen.getByLabelText('Mon organisation')).toBeTruthy();
    expect(screen.getByLabelText('Agence : WPM')).toBeTruthy();
    expect(screen.getByLabelText('Gestionnaire : Viparis')).toBeTruthy();
  });

  it('R25a/reinitialiser_absent_sans_filtre_actif', () => {
    renderBar();
    expect(screen.queryByTestId('filtres-reinitialiser')).toBeNull();
  });

  it('R25a/reinitialiser_vide_tous_les_filtres', () => {
    const { onChange } = renderBar({
      ...FILTRES_COLLECTE_VIDES,
      client: 'Danone',
      infoIncomplete: 'oui',
      programmeePar: ['org-2'],
    });
    fireEvent.click(screen.getByTestId('filtres-reinitialiser'));
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
      { lieuId: 'lieu-a' },
      { client: 'Danone' },
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
        lieuId: 'lieu-a',
      }),
    ).toBe(false);
    expect(
      memeFiltresCollecte(
        { ...FILTRES_COLLECTE_VIDES, statuts: ['a'] },
        { ...FILTRES_COLLECTE_VIDES, statuts: ['b'] },
      ),
    ).toBe(false);
  });
});
