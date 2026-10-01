/**
 * Prédicats purs de la Data Table Collectes Admin (`components/admin/collectes-table`) —
 * `estUrgente` (criticité §06.09 §1 / ALGO-02 : AG à attribuer ET < 48h) et
 * `urgentesEnTete` (urgences remontées en tête de liste, tri stable).
 *
 * `estUrgente` a été recâblée sur les helpers de fuseau (#287) : `instantParis`
 * pour le créneau. Les helpers sont couverts en propre (packages/shared/src/temps),
 * ici on couvre le CÂBLAGE — une erreur de branchement serait silencieuse.
 *
 * Invariant établi par #287 : ce fichier doit donner le même résultat sous
 * TZ=UTC et sous TZ=Pacific/Auckland (frontière 48h en heure murale de Paris,
 * sans jamais construire d'instant hors de `instantParis`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { instantParis } from '@savr/shared/src/temps/index.js';

import {
  estUrgente,
  urgentesEnTete,
  type CollecteRow,
} from '@/components/admin/collectes-table';

// Ligne minimale : seuls type / statut / attribution / date / heure comptent
// pour les deux prédicats testés, le reste satisfait le type.
function row(over: Partial<CollecteRow> = {}): CollecteRow {
  return {
    id: 'c1',
    type: 'anti_gaspi',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    dirty_tms: false,
    date_collecte: '2026-07-08',
    heure_collecte: '20:00:00',
    controle_acces_requis: false,
    informations_completes: true,
    taux_recyclage: null,
    attributions_antgaspi: null,
    collecte_flux: [],
    rapports_rse: [],
    evenements: {
      nom_evenement: 'Gala',
      pax: 120,
      nom_client_organisateur: null,
      organisations: { raison_sociale: 'Traiteur Test' },
      client_organisateur: null,
      lieux: {
        nom: 'Lieu Test',
        adresse_acces: '1 rue du Test',
        code_postal: '75001',
        ville: 'Paris',
      },
    },
    ...over,
  };
}

const attribution: NonNullable<CollecteRow['attributions_antgaspi']> = {
  id: 'a1',
  valide_at: '2026-07-01T10:00:00Z',
  mode_validation: 'manuel_top1',
  volume_repas_realise: null,
};

// « Maintenant » figé à une heure murale parisienne : les écarts annoncés
// ci-dessous sont donc exacts quel que soit le fuseau de la machine.
function maintenant(jour: string, heure: string): void {
  vi.setSystemTime(instantParis(jour, heure));
}

describe('collectes-table / estUrgente (§06.09 §1 — AG à attribuer < 48h)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AG à attribuer dans 47h → urgente', () => {
    maintenant('2026-07-06', '21:00'); // créneau par défaut : 08/07 20:00 Paris
    expect(estUrgente(row())).toBe(true);
  });

  it('AG à attribuer dans 49h → pas urgente', () => {
    maintenant('2026-07-06', '19:00');
    expect(estUrgente(row())).toBe(false);
  });

  it('exactement 48h → pas urgente (seuil strict)', () => {
    maintenant('2026-07-06', '20:00');
    expect(estUrgente(row())).toBe(false);
  });

  it('AG déjà attribuée → jamais urgente, même à 1h du créneau', () => {
    maintenant('2026-07-08', '19:00');
    expect(estUrgente(row({ attributions_antgaspi: attribution }))).toBe(false);
  });

  it('AG déjà validée par le transporteur (statut ≠ programmee) → pas urgente', () => {
    maintenant('2026-07-06', '21:00');
    expect(estUrgente(row({ statut: 'validee' }))).toBe(false);
  });

  it('ZD → jamais urgente (la criticité ne porte que sur l’attribution AG)', () => {
    maintenant('2026-07-06', '21:00');
    expect(estUrgente(row({ type: 'zero_dechet' }))).toBe(false);
  });

  it('date_collecte corrompue → false (échec fermé, pas de badge Urgent au hasard)', () => {
    maintenant('2026-07-06', '21:00');
    expect(estUrgente(row({ date_collecte: 'pas-une-date' }))).toBe(false);
    expect(estUrgente(row({ date_collecte: '' }))).toBe(false);
  });

  it('heure vide traitée comme minuit, comme estAnnulationTardive', () => {
    // Créneau visé : 09/07 00:00 Paris. `?? "00:00:00"` ne couvrait que null →
    // instantParis(jour, '') rendait une date invalide → jamais urgente.
    maintenant('2026-07-08', '10:00'); // 14h avant
    expect(
      estUrgente(row({ date_collecte: '2026-07-09', heure_collecte: '' })),
    ).toBe(true);
    expect(
      estUrgente(
        row({
          date_collecte: '2026-07-09',
          heure_collecte: null as unknown as string,
        }),
      ),
    ).toBe(true);
    // Et la fenêtre reste bornée : même créneau vu de plus loin → pas urgente.
    maintenant('2026-07-06', '10:00'); // 62h avant
    expect(
      estUrgente(row({ date_collecte: '2026-07-09', heure_collecte: '' })),
    ).toBe(false);
  });

  it('frontière 48h lue en heure MURALE parisienne (créneau 00h30)', () => {
    // Créneau : 16/07 00:30 Paris = 15/07 22:30 UTC (été, UTC+2).
    const tardif = row({
      date_collecte: '2026-07-16',
      heure_collecte: '00:30:00',
    });
    // 47h30 avant en heure de Paris → urgente. Lu en UTC, le créneau tomberait
    // à 02:30 Paris (49h30) et la collecte ne serait PAS signalée.
    maintenant('2026-07-14', '01:00');
    expect(estUrgente(tardif)).toBe(true);
    // 48h30 avant → hors fenêtre. Lu en UTC, le créneau tomberait à 46h30 et la
    // collecte serait signalée à tort.
    maintenant('2026-07-14', '00:00');
    expect(estUrgente(tardif)).toBe(false);
  });

  it('frontière identique en heure d’hiver (UTC+1)', () => {
    const tardif = row({
      date_collecte: '2026-01-16',
      heure_collecte: '00:30:00',
    });
    maintenant('2026-01-14', '01:00');
    expect(estUrgente(tardif)).toBe(true);
    maintenant('2026-01-14', '00:00');
    expect(estUrgente(tardif)).toBe(false);
  });
});

describe('collectes-table / urgentesEnTete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('urgentes remontées en tête, ordre reçu conservé de part et d’autre (tri stable)', () => {
    maintenant('2026-07-07', '10:00'); // < 48h des créneaux du 08/07
    const lignes = urgentesEnTete([
      // Non urgentes (déjà attribuées) — gardent l'ordre reçu.
      row({
        id: 'attr-mar',
        date_collecte: '2026-07-07',
        heure_collecte: '08:00:00',
        attributions_antgaspi: attribution,
      }),
      row({
        id: 'urgent-tot',
        date_collecte: '2026-07-08',
        heure_collecte: '07:00:00',
      }),
      row({
        id: 'attr-mer',
        date_collecte: '2026-07-08',
        heure_collecte: '09:00:00',
        attributions_antgaspi: attribution,
      }),
      row({
        id: 'urgent-tard',
        date_collecte: '2026-07-08',
        heure_collecte: '20:00:00',
      }),
    ]);
    expect(lignes.map((i) => i.id)).toEqual([
      'urgent-tot',
      'urgent-tard',
      'attr-mar',
      'attr-mer',
    ]);
  });

  it('ne mute pas le tableau reçu (état React)', () => {
    maintenant('2026-07-07', '10:00');
    const recu = [
      row({ id: 'a', attributions_antgaspi: attribution }),
      row({ id: 'u' }),
    ];
    urgentesEnTete(recu);
    expect(recu.map((r) => r.id)).toEqual(['a', 'u']);
  });

  it('liste vide → liste vide', () => {
    expect(urgentesEnTete([])).toEqual([]);
  });
});
