/**
 * M3.1 — Data Table liste collectes traiteur (refonte 2026-07-05, revue écran
 * 2026-07-15, passage en Data Table 2026-09-28 — décisions Val). Couvre : champs
 * affichés (Date · Heure · Lieu · Client · Pax · Statut), menu « ⋯ » (Modifier /
 * Dupliquer / Annuler — revue écran 2026-10-29) : action absente si le statut
 * l'interdit, grisée avec sa raison sans droit d'écriture ; repères
 * « Aujourd’hui » / « Demain » et pastille « Par un tiers » ; et —
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
      columns={colonnesCollectesTraiteur(
        {
          onModifier: handlers.onModifier ?? (() => {}),
          onAnnuler: handlers.onAnnuler ?? (() => {}),
          onDupliquer: handlers.onDupliquer ?? (() => {}),
          onTelecharger: handlers.onTelecharger ?? (() => {}),
        },
        aujourdhui,
      )}
      data={[{ ...c, canWrite }]}
      getRowId={(x) => x.id}
      onRowClick={handlers.onOpen ?? (() => {})}
    />,
  );
  return { ...r, table: within(screen.getByRole('table')) };
}

let aujourdhui: string | undefined;
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
// Menu « ⋯ » de la ligne, ouvert au clavier (Entrée, comme un utilisateur).
// Déjà ouvert : le reste de la page est masqué aux lecteurs d'écran.
function menu(): HTMLElement {
  const ouvert = screen.queryByRole('menu');
  if (ouvert) return ouvert;
  fireEvent.keyDown(btn(/Actions sur la collecte/), { key: 'Enter' });
  return screen.getByRole('menu');
}
function item(name: RegExp): HTMLElement | null {
  return within(menu()).queryByRole('menuitem', { name });
}
function estGrise(el: HTMLElement | null): boolean {
  return el?.getAttribute('aria-disabled') === 'true';
}

describe('M3.1 / Data Table liste traiteur', () => {
  it('M3.1/card_traiteur_champs — affiche heure, lieu, pax + menu « ⋯ » des 3 actions (validee)', () => {
    monte(base(), true);
    expect(table.getByText(/23h30/)).toBeTruthy();
    expect(table.getByText(/Lieu Rouen Gare/)).toBeTruthy();
    expect(table.getByText(/220 pax/)).toBeTruthy();
    // Plus de picto par action sur la ligne : un seul déclencheur.
    expect(queryBtn(/Modifier/)).toBeNull();
    expect(queryBtn(/Dupliquer/)).toBeNull();
    const noms = within(menu())
      .getAllByRole('menuitem')
      .map((m) => m.textContent);
    expect(noms).toEqual([
      'Modifier la collecte',
      'Dupliquer la collecte',
      'Demander l’annulation',
    ]);
  });

  it('M3.1/liste_colonne_client — colonne « Client » à droite de « Lieu », cellule vide si non renseigné', () => {
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

    // Client organisateur non saisi : cellule laissée vide (revue écran
    // 2026-10-29), plus de tiret.
    monte(base({ client_nom: null }), true);
    expect(table.queryByText('Maison Lenôtre')).toBeNull();
    const cellules = table.getAllByRole('cell');
    expect(cellules[entetes.indexOf('Client')]?.textContent).toBe('');
  });

  it('M3.1/card_traiteur_gating_manager — validee + canWrite → Modifier/Annuler actifs', () => {
    monte(base({ statut: 'validee' }), true);
    expect(estGrise(item(/Modifier/))).toBe(false);
    expect(estGrise(item(/annulation/))).toBe(false);
    expect(item(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_libelle_annuler — programmee : « Annuler la collecte », validee : « Demander l’annulation »', () => {
    monte(base({ statut: 'programmee' }), true);
    expect(item(/^Annuler la collecte$/)).toBeTruthy();
    monte(base({ statut: 'validee' }), true);
    expect(item(/^Demander l’annulation$/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_readonly — canWrite false → Modifier/Annuler GRISÉS avec leur raison, Dupliquer actif', () => {
    monte(base({ statut: 'validee' }), false);
    const modifier = item(/Modifier/);
    expect(estGrise(modifier)).toBe(true);
    expect(modifier?.textContent).toContain(
      'Seul le créateur de la collecte ou un manager peut la modifier.',
    );
    expect(estGrise(item(/annulation/))).toBe(true);
    // Dupliquer crée une nouvelle collecte → toujours disponible.
    expect(estGrise(item(/Dupliquer/))).toBe(false);
  });

  it('M3.1/card_traiteur_gating_tiers — programmée par un tiers : raison propre au tiers', () => {
    monte(base({ statut: 'validee', programmee_par_tiers: true }), false);
    expect(item(/Modifier/)?.textContent).toContain(
      'Collecte programmée par un tiers',
    );
  });

  it('M3.1/card_traiteur_gating_statut_terminal — cloturee → Modifier/Annuler ABSENTS même si canWrite', () => {
    monte(base({ statut: 'cloturee' }), true);
    expect(item(/Modifier/)).toBeNull();
    expect(item(/Annuler|annulation/)).toBeNull();
    expect(item(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_actions — les entrées du menu appellent leurs handlers', () => {
    const onModifier = vi.fn();
    const onAnnuler = vi.fn();
    const onDupliquer = vi.fn();
    monte(base({ statut: 'validee' }), true, {
      onModifier,
      onAnnuler,
      onDupliquer,
    });
    fireEvent.click(item(/Modifier/)!);
    fireEvent.click(item(/Dupliquer/)!);
    fireEvent.click(item(/annulation/)!);
    expect(onModifier).toHaveBeenCalledOnce();
    expect(onAnnuler).toHaveBeenCalledOnce();
    expect(onDupliquer).toHaveBeenCalledOnce();
  });

  it('M3.1/card_traiteur_action_grisee_inerte — une entrée grisée n’appelle rien', () => {
    const onModifier = vi.fn();
    monte(base({ statut: 'validee' }), false, { onModifier });
    fireEvent.click(item(/Modifier/)!);
    expect(onModifier).not.toHaveBeenCalled();
  });

  it('M3.1/liste_pastille_tiers — « Par un tiers » écrit à côté du lieu', () => {
    monte(base({ programmee_par_tiers: true }), true);
    expect(table.getByText('Par un tiers')).toHaveAttribute(
      'title',
      'Programmée par un tiers',
    );
    monte(base({ programmee_par_tiers: false }), true);
    expect(table.queryByText('Par un tiers')).toBeNull();
  });

  it('M3.1/liste_repere_jour — « Aujourd’hui » / « Demain », rien au-delà ni sur une annulée', () => {
    aujourdhui = '2026-07-08';
    try {
      monte(base({ date_collecte: '2026-07-08' }), true);
      expect(table.getByText('Aujourd’hui')).toBeTruthy();
      monte(base({ date_collecte: '2026-07-09' }), true);
      expect(table.getByText('Demain')).toBeTruthy();
      monte(base({ date_collecte: '2026-07-10' }), true);
      expect(table.queryByText(/Aujourd’hui|Demain/)).toBeNull();
      monte(base({ date_collecte: '2026-07-08', statut: 'annulee' }), true);
      expect(table.queryByText('Aujourd’hui')).toBeNull();
    } finally {
      aujourdhui = undefined;
    }
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
    expect(item(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_non_realisee — statut non terminal : pas de téléchargement', () => {
    monte(base({ statut: 'validee' }), true);
    expect(queryBtn(/Télécharger le rapport/)).toBeNull();
  });

  it('M3.1/ligne_ouvre_la_fiche_mais_pas_via_une_action — clic ligne = fiche, clic action ≠ fiche', () => {
    const onOpen = vi.fn();
    const onDupliquer = vi.fn();
    monte(base(), true, { onOpen, onDupliquer });
    fireEvent.click(btn(/Actions sur la collecte/));
    fireEvent.click(item(/Dupliquer/)!);
    expect(onDupliquer).toHaveBeenCalledOnce();
    // La cellule Actions est `interactive` : son clic ne remonte pas à la ligne.
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(table.getByText('Lieu Rouen Gare'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('M3.1/ligne_chevron_ouvre_la_fiche — un clic sur le chevron de la cellule d’actions ouvre la fiche', () => {
    const onOpen = vi.fn();
    monte(base(), true, { onOpen });
    fireEvent.click(table.getByTestId('chevron-ligne'));
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
