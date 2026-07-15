/**
 * M3.1 — Carte simplifiée liste collectes traiteur (refonte 2026-07-05 + revue
 * écran 2026-07-15, décisions Val). Couvre : champs affichés (Date · Heure · Lieu ·
 * Pax · Statut), actions icône-seule (Modifier / Annuler / Dupliquer) MASQUÉES quand
 * indisponibles (plus de bouton grisé), et — sur collecte réalisée (cloturee) — les
 * résultats (ZD : poids/taux/CO₂ ; AG : repas/CO₂) + le téléchargement du rapport.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  TraiteurCollecteCard,
  type TraiteurCollecteCardData,
} from '@/components/collecte/collecte-card-traiteur';

function base(
  over: Partial<TraiteurCollecteCardData> = {},
): TraiteurCollecteCardData {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'validee',
    date_collecte: '2026-07-08',
    heure_collecte: '23:30:00',
    lieu_nom: 'Lieu Rouen Gare',
    lieu_adresse: '9 Ruelle 76000 Rouen',
    pax: 220,
    programmee_par_tiers: false,
    poids_total_kg: null,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: null,
    ...over,
  };
}

function renderCard(
  c: TraiteurCollecteCardData,
  canWrite: boolean,
  handlers: Partial<{
    onOpen: () => void;
    onModifier: () => void;
    onAnnuler: () => void;
    onDupliquer: () => void;
    onTelecharger: () => void;
  }> = {},
) {
  return render(
    <TraiteurCollecteCard
      c={c}
      canWrite={canWrite}
      onOpen={handlers.onOpen ?? (() => {})}
      onModifier={handlers.onModifier ?? (() => {})}
      onAnnuler={handlers.onAnnuler ?? (() => {})}
      onDupliquer={handlers.onDupliquer ?? (() => {})}
      onTelecharger={handlers.onTelecharger ?? (() => {})}
    />,
  );
}

function btn(name: RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement;
}
function queryBtn(name: RegExp): HTMLButtonElement | null {
  return screen.queryByRole('button', { name }) as HTMLButtonElement | null;
}

describe('M3.1 / carte liste traiteur (refonte)', () => {
  it('M3.1/card_traiteur_champs — affiche heure, lieu, pax + 3 actions (validee)', () => {
    cleanup();
    renderCard(base(), true);
    expect(screen.getByText(/23:30/)).toBeTruthy();
    expect(screen.getByText(/Lieu Rouen Gare/)).toBeTruthy();
    expect(screen.getByText(/220 pax/)).toBeTruthy();
    // Actions icône-seule : le libellé accessible vient de l'aria-label.
    expect(btn(/Modifier/)).toBeTruthy();
    expect(btn(/Annuler/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_manager — validee + canWrite → Modifier/Annuler présents et cliquables', () => {
    cleanup();
    renderCard(base({ statut: 'validee' }), true);
    expect(btn(/Modifier/)).toBeTruthy();
    expect(btn(/Annuler/)).toBeTruthy();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_readonly — canWrite false → Modifier/Annuler MASQUÉS, Dupliquer présent', () => {
    cleanup();
    renderCard(base({ statut: 'validee' }), false);
    expect(queryBtn(/Modifier/)).toBeNull();
    expect(queryBtn(/Annuler/)).toBeNull();
    // Dupliquer crée une nouvelle collecte → toujours disponible.
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_gating_statut_terminal — cloturee → Modifier/Annuler MASQUÉS même si canWrite', () => {
    cleanup();
    renderCard(base({ statut: 'cloturee' }), true);
    expect(queryBtn(/Modifier/)).toBeNull();
    expect(queryBtn(/Annuler/)).toBeNull();
    expect(btn(/Dupliquer/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_actions — les boutons appellent leurs handlers', () => {
    cleanup();
    const onModifier = vi.fn();
    const onAnnuler = vi.fn();
    const onDupliquer = vi.fn();
    renderCard(base({ statut: 'validee' }), true, {
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
    cleanup();
    renderCard(
      base({
        statut: 'cloturee',
        type: 'zero_dechet',
        poids_total_kg: 128.5,
        taux_recyclage: 87,
        co2_evite_kg: 42,
      }),
      true,
    );
    expect(screen.getByText(/128,5\s*kg/)).toBeTruthy();
    expect(screen.getByText(/87\s*%/)).toBeTruthy();
    expect(screen.getByText(/42\s*kg CO₂e/)).toBeTruthy();
    expect(btn(/Télécharger le rapport/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_realisee_ag — cloturee AG affiche repas + CO₂ + téléchargement', () => {
    cleanup();
    renderCard(
      base({
        statut: 'cloturee',
        type: 'anti_gaspi',
        nb_repas_donnes: 340,
        co2_evite_kg: 850,
      }),
      true,
    );
    expect(screen.getByText(/340 repas/)).toBeTruthy();
    expect(screen.getByText(/850\s*kg CO₂e/)).toBeTruthy();
    expect(btn(/Télécharger le rapport/)).toBeTruthy();
  });

  it('M3.1/card_traiteur_realisee_download — le picto téléchargement appelle onTelecharger', () => {
    cleanup();
    const onTelecharger = vi.fn();
    renderCard(
      base({ statut: 'cloturee', poids_total_kg: 100, co2_evite_kg: 10 }),
      true,
      { onTelecharger },
    );
    fireEvent.click(btn(/Télécharger le rapport/));
    expect(onTelecharger).toHaveBeenCalledOnce();
  });

  it('M3.1/card_traiteur_non_realisee — statut non terminal : pas de téléchargement', () => {
    cleanup();
    renderCard(base({ statut: 'validee' }), true);
    expect(queryBtn(/Télécharger le rapport/)).toBeNull();
  });
});
