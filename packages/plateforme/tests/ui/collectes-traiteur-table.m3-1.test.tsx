/**
 * M3.1 — Data Table liste collectes traiteur (refonte 2026-07-05, revue écran
 * 2026-07-15, passage en Data Table 2026-09-28 — décisions Val). Couvre : champs
 * affichés (Date · Heure · Lieu · Client · Pax · Statut), actions icône-seule (Modifier /
 * Annuler / Dupliquer) MASQUÉES quand indisponibles (plus de bouton grisé), et —
 * sur collecte réalisée (cloturee) — les résultats (ZD : poids/taux/CO₂ ; AG :
 * repas/CO₂) + le téléchargement du rapport, retiré quand le rapport de don
 * est réservé au donneur d'ordre (D12).
 *
 * Requêtes bornées au <table> : DataGrid rend aussi chaque ligne en carte
 * mobile (< 640 px), qui dupliquerait chaque libellé.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from '@testing-library/react';
import { DataGrid } from '@/components/ui/data-grid';
import {
  colonnesCollectesTraiteur,
  type TraiteurCollecteLigne,
} from '@/components/collecte/collectes-traiteur-table';

function base(
  over: Partial<TraiteurCollecteLigne> = {},
): TraiteurCollecteLigne {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-07-08',
    heure_collecte: '23:30:00',
    lieu_nom: 'Lieu Rouen Gare',
    lieu_adresse: '9 Ruelle 76000 Rouen',
    client_nom: 'Maison Lenôtre',
    pax: 220,
    programmee_par_tiers: false,
    rapport_reserve_donneur_ordre: false,
    canWrite: true,
    poids_total_kg: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: null,
    ...over,
  };
}

function renderCard(
  c: TraiteurCollecteLigne,
  canWrite: boolean,
  handlers: Partial<{
    onOpen: () => void;
    onModifier: () => void;
    onAnnuler: () => void;
    onDupliquer: () => void;
    onTelecharger: () => void;
  }> = {},
) {
  const r = render(
    <DataGrid
      columns={colonnesCollectesTraiteur({
        onModifier: handlers.onModifier ?? (() => {}),
        onAnnuler: handlers.onAnnuler ?? (() => {}),
        onDupliquer: handlers.onDupliquer ?? (() => {}),
        onTelecharger: handlers.onTelecharger ?? (() => {}),
      })}
      data={[{ ...c, canWrite }]}
      getRowId={(x) => x.id}
      onRowClick={handlers.onOpen ?? (() => {})}
    />,
  );
  return { ...r, table: within(screen.getByRole('table')) };
}

let table: ReturnType<typeof renderCard>['table'];
function btn(name: RegExp): HTMLButtonElement {
  return table.getByRole('button', { name }) as HTMLButtonElement;
}
function queryBtn(name: RegExp): HTMLButtonElement | null {
  return table.queryByRole('button', { name }) as HTMLButtonElement | null;
}
function monte(...args: Parameters<typeof renderCard>) {
  cleanup();
  table = renderCard(...args).table;
}

describe('M3.1 / Data Table liste traiteur', () => {
  it('M3.1/card_traiteur_champs — affiche heure, lieu, pax + 3 actions (validee)', () => {
    monte(base(), true);
    expect(table.getByText(/23h30/)).toBeTruthy();
    expect(table.getByText(/Lieu Rouen Gare/)).toBeTruthy();
    expect(table.getByText(/220 pax/)).toBeTruthy();
    // Actions icône-seule : le libellé accessible vient de l'aria-label.
    expect(btn(/Modifier/)).toBeTruthy();
    expect(btn(/Annuler/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/liste_colonne_client — colonne « Client » à droite de « Lieu », « — » si non renseigné', () => {
    monte(base(), true);
    const entetes = table
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim());
    expect(entetes.indexOf('Client')).toBe(entetes.indexOf('Lieu') + 1);
    expect(table.getByText('Maison Lenôtre')).toBeTruthy();
    // Triable : DataGrid ne pose `aria-sort` que sur une colonne triable (sans
    // `accessorFn`, l'en-tête serait inerte).
    expect(table.getByRole('columnheader', { name: 'Client' })).toHaveAttribute(
      'aria-sort',
      'none',
    );

    // Client organisateur non saisi à la programmation : cellule vide du DS.
    monte(base({ client_nom: null }), true);
    expect(table.queryByText('Maison Lenôtre')).toBeNull();
    const cellules = table.getAllByRole('cell');
    expect(cellules[entetes.indexOf('Client')]?.textContent).toBe('—');
  });

  it('M3.1/card_traiteur_gating_manager — validee + canWrite → Modifier/Annuler présents et cliquables', () => {
    monte(base({ statut: 'validee' }), true);
    expect(btn(/Modifier/)).toBeTruthy();
    expect(btn(/Annuler/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_readonly — canWrite false → Modifier/Annuler MASQUÉS, Dupliquer présent', () => {
    monte(base({ statut: 'validee' }), false);
    expect(queryBtn(/Modifier/)).toBeNull();
    expect(queryBtn(/Annuler/)).toBeNull();
    // Dupliquer crée une nouvelle collecte → toujours disponible.
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_statut_terminal — cloturee → Modifier/Annuler MASQUÉS même si canWrite', () => {
    monte(base({ statut: 'cloturee' }), true);
    expect(queryBtn(/Modifier/)).toBeNull();
    expect(queryBtn(/Annuler/)).toBeNull();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_actions — les boutons appellent leurs handlers', () => {
    const onModifier = vi.fn();
    const onAnnuler = vi.fn();
    const onDupliquer = vi.fn();
    monte(base({ statut: 'validee' }), true, {
      onModifier,
      onAnnuler,
      onDupliquer,
    });
    fireEvent.click(btn(/Modifier/));
    fireEvent.click(btn(/Annuler/));
    fireEvent.click(btn(/Dupliquer/));
    expect(onModifier).toHaveBeenCalledOnce();
    expect(onAnnuler).toHaveBeenCalledOnce();
    expect(onDupliquer).toHaveBeenCalledOnce();
  });

  it('M3.1/card_traiteur_realisee_zd — cloturee ZD affiche poids, taux, CO₂ + téléchargement', () => {
    monte(
      base({
        statut: 'cloturee',
        type: 'zero_dechet',
        poids_total_kg: 128.5,
        taux_recyclage: 87,
        co2_evite_kg: 42,
      }),
      true,
    );
    expect(table.getByText(/128,5\s*kg/)).toBeTruthy();
    expect(table.getByText(/87\s*%/)).toBeTruthy();
    expect(table.getByText(/42\s*kg CO₂e/)).toBeTruthy();
    expect(btn(/Télécharger le rapport/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_realisee_ag — cloturee AG affiche repas + CO₂ + téléchargement', () => {
    monte(
      base({
        statut: 'cloturee',
        type: 'anti_gaspi',
        nb_repas_donnes: 340,
        co2_evite_kg: 850,
      }),
      true,
    );
    expect(table.getByText(/340 repas/)).toBeTruthy();
    expect(table.getByText(/850\s*kg CO₂e/)).toBeTruthy();
    expect(btn(/Télécharger le rapport/)).toBeTruthy();
  });

  // « Sans excédent » est un résultat, pas un statut (décision Val 2026-10-09) :
  // la ligne se lit « Réalisée », la mention prend la place des repas, et le
  // rapport de don se télécharge comme sur les autres lignes réalisées.
  it('M3.1/liste_sans_excedent_resultats — AG sans excédent : statut « Réalisée », « Sans excédent » en Résultats, téléchargement du rapport', () => {
    const onTelecharger = vi.fn();
    monte(
      base({
        statut: 'realisee_sans_collecte',
        type: 'anti_gaspi',
        nb_repas_donnes: 0,
        co2_evite_kg: 0,
      }),
      true,
      { onTelecharger },
    );
    expect(table.getByText('Sans excédent')).toBeTruthy();
    expect(table.getByText('Réalisée')).toBeTruthy();
    expect(table.queryByText(/Sans excédents/)).toBeNull();
    expect(table.queryByText(/repas/)).toBeNull();
    expect(table.queryByText(/CO₂e/)).toBeNull();
    fireEvent.click(btn(/Télécharger le rapport/));
    expect(onTelecharger).toHaveBeenCalledOnce();
  });

  it('M3.1/card_traiteur_realisee_download — le picto téléchargement appelle onTelecharger', () => {
    const onTelecharger = vi.fn();
    const onOpen = vi.fn();
    monte(
      base({ statut: 'cloturee', poids_total_kg: 100, co2_evite_kg: 10 }),
      true,
      { onTelecharger, onOpen },
    );
    fireEvent.click(btn(/Télécharger le rapport/));
    expect(onTelecharger).toHaveBeenCalledOnce();
    // Le clic s'arrête au bouton ; le reste de la cellule Résultats ouvre la
    // fiche comme toute la ligne (plus de zone morte autour des chiffres).
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(table.getByText(/100\s*kg/));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('M3.1/liste_rapport_reserve_donneur_ordre_picto_retire — AG réservée au donneur d’ordre : picto retiré, mention de la fiche, résultats conservés', () => {
    // D12 : la route répondrait 404 → pas de bouton inerte dans la liste
    // (action retirée, §10 §7), mais la mention affichée par la fiche.
    monte(
      base({
        statut: 'cloturee',
        type: 'anti_gaspi',
        nb_repas_donnes: 340,
        co2_evite_kg: 850,
        programmee_par_tiers: true,
        rapport_reserve_donneur_ordre: true,
      }),
      true,
    );
    expect(queryBtn(/Télécharger le rapport/)).toBeNull();
    expect(
      table.getByText('Réservé à l’organisation qui a programmé la collecte'),
    ).toBeTruthy();
    expect(table.getByText(/340 repas/)).toBeTruthy();
    expect(table.getByText(/850\s*kg CO₂e/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_non_realisee — statut non terminal : pas de téléchargement', () => {
    monte(base({ statut: 'validee' }), true);
    expect(queryBtn(/Télécharger le rapport/)).toBeNull();
  });

  it('M3.1/ligne_ouvre_la_fiche_mais_pas_via_une_action — clic ligne = fiche, clic action ≠ fiche', () => {
    const onOpen = vi.fn();
    const onDupliquer = vi.fn();
    monte(base(), true, { onOpen, onDupliquer });
    fireEvent.click(btn(/Dupliquer/));
    expect(onDupliquer).toHaveBeenCalledOnce();
    // La cellule Actions est `interactive` : son clic ne remonte pas à la ligne.
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(table.getByText('Lieu Rouen Gare'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('M3.1/ligne_activable_au_clavier — Entrée sur la ligne ouvre la fiche', () => {
    const onOpen = vi.fn();
    monte(base(), true, { onOpen });
    const ligne = table.getAllByRole('row')[1]!;
    fireEvent.keyDown(ligne, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
