import * as React from 'react';
import type { FicheClientDonnees } from '@/components/collecte/fiche-collecte-client-onglets';

// R-UI-6c — fixtures et cadres communs avant / après (données uniquement : les
// composants rendus sont importés de l'arbre construit, `main` ou la branche).

// Chemin courant lu par le stub `usePathname` (item actif de la Sidebar).
(globalThis as { __PV_PATHNAME?: string }).__PV_PATHNAME =
  '/admin/transporteurs';

export function Sec({
  id,
  title,
  width = 1180,
  children,
}: {
  id: string;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={
        width < 640 ? 'bg-savr-neutral-50 p-4' : 'bg-savr-neutral-50 p-6'
      }
      style={{ width }}
    >
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-savr-neutral-500">
        {title}
      </div>
      {children}
    </section>
  );
}

export function Legende({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 font-mono text-[10px] text-savr-neutral-400 first:mt-0">
      {children}
    </div>
  );
}

// Fiche collecte AG clôturée — forme de `ficheClient()` (src/test-utils/
// fiche-collecte-client.ts, identique sur main et la branche ; non importé car
// le module importe vitest).
export const FICHE_AG: FicheClientDonnees = {
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'cloturee',
  statut_tms: 'acceptee',
  tms_reference: null,
  date_collecte: '2026-10-28',
  heure_collecte: '22:00:00',
  controle_acces_requis: true,
  informations_completes: true,
  informations_supplementaires: 'Quai B, badge à l’accueil',
  taux_recyclage: null,
  co2_net_kg: null,
  co2_evite_kg: 1240,
  realisee_at: '2026-10-28T23:10:00Z',
  aucun_repas_motif: null,
  taille_bracket: 'XL',
  evenement: {
    id: 'e1',
    nom_evenement: 'Salon',
    pax: 4200,
    type_evenement_id: 't1',
    type_evenement: { libelle: 'Cocktail apéritif' },
    nom_client_organisateur: 'Maison Client',
    reference_affaire: null,
    contacts_visibles: true,
    contact_principal_nom: 'Paul Contact',
    contact_principal_telephone: '+33 6 11 22 33 44',
    contact_secours_nom: null,
    contact_secours_telephone: null,
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
  repas_donnes: 496,
  association: null,
  rapport_rse_disponible: true,
  rapport_rse_regenere: false,
  rapport_reserve_donneur_ordre: false,
  rapport_etat: 'disponible',
  actions: { modifier: 'absent', annuler: 'absent', annulation: null },
} as FicheClientDonnees;

export const TOP_ITEMS = [
  {
    label: 'Palais Brongniart',
    value: '4,2 t',
    secondary: '12 collectes · 82 % recyclage',
    barPct: 100,
  },
  {
    label: 'Pavillon Gabriel',
    value: '3,1 t',
    secondary: '9 collectes · 77 % recyclage',
    barPct: 74,
  },
  {
    label: 'Salons Hoche',
    value: '2,4 t',
    secondary: '6 collectes · 71 % recyclage',
    barPct: 57,
  },
];

export const CO2_ZD = {
  eviteKg: 12400,
  induitKg: 3100,
  netKg: 9300,
  energiePrimaireKwh: 5400,
  equivalences: { kmVoiture: 48000, repasBoeuf: 1200, foyers: 3 },
};

export const METHODE = {
  forfait: { km: 30, fe_camion: 0.9 },
  fluxFactors: [
    {
      code: 'biodechet',
      nom: 'Biodéchets',
      fe_evite: 120,
      fe_induit: 20,
      energie: 50,
    },
    {
      code: 'carton',
      nom: 'Carton',
      fe_evite: 1100,
      fe_induit: 30,
      energie: 2400,
    },
    { code: 'verre', nom: 'Verre', fe_evite: 420, fe_induit: 25, energie: 900 },
  ],
  equivalences: { km_voiture: 0.218, repas_boeuf: 7, foyer_kwh: 4700 },
};

export const LIGNES_TABLE = [
  {
    ref: 'COL-2026-0412',
    lieu: 'Palais Brongniart',
    statut: 'Clôturée',
    v: 'success' as const,
  },
  {
    ref: 'COL-2026-0413',
    lieu: 'Pavillon Gabriel',
    statut: 'À compléter',
    v: 'action' as const,
  },
  {
    ref: 'COL-2026-0414',
    lieu: 'Salons Hoche',
    statut: 'Annulée',
    v: 'neutral' as const,
  },
];
