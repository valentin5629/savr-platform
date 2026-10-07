/**
 * R-UI-0 (B2) — libellés FR des enums : valeur connue → libellé, inconnue →
 * valeur brute (jamais une chaîne vide), absente → « — ». L'exhaustivité
 * contre les enums DB est garantie au typecheck (`satisfies`).
 */
import { describe, expect, it } from 'vitest';
import { libelleRole } from './role';
import { libelleStatutTournee } from './tournee';
import {
  LIBELLE_ACTIF,
  libelleActif,
  OPTIONS_FILTRE_ACTIF,
  variantActif,
} from './actif';
import {
  libelleCourtTypeFacture,
  libelleStatutFacture,
  libelleTypeFacture,
  LIBELLE_STATUT_FACTURE_PLURIEL,
  optionsStatutFacture,
  optionsTypeFacture,
  variantStatutFacture,
} from './facture';
import {
  libelleTypeOrganisation,
  libelleTypeOrganisationMinuscule,
  libelleVerificationSiret,
  LIBELLE_COURT_TYPE_ORGANISATION,
  variantVerificationSiret,
} from './organisation';
import {
  CREDITS_TYPE_PACK,
  libelleLongTypePack,
  libelleStatutPack,
  libelleTypePack,
  TYPES_PACK,
  TYPES_PACK_GRILLE,
  variantStatutPack,
} from './pack';
import {
  libelleCompletTypeCollecte,
  libelleCourtTypeCollecte,
  libelleTypeCollecte,
  normaliserTypeCollecte,
  variantTypeCollecte,
} from './type-collecte';
import { LIBELLE_TYPE_TMS, libelleCourtTypeTms } from '../type-tms-labels';
import { DIFFICULTE_LABEL, VEHICULE_LABEL } from '../lieux-labels';

describe('R-UI-0 — lib/libelles : enums DB → libellés FR', () => {
  it('valeur connue → libellé FR', () => {
    expect(libelleStatutFacture('payee')).toBe('Payée');
    expect(libelleStatutFacture('en_attente_pennylane')).toBe(
      'En attente Pennylane',
    );
    expect(libelleStatutPack('epuise')).toBe('Épuisé');
    expect(libelleTypePack('pack_30')).toBe('Pack 30');
    expect(libelleVerificationSiret('verifie')).toBe('Vérifié');
    expect(libelleRole('gestionnaire_lieux')).toBe('Gestionnaire de lieux');
    expect(libelleStatutTournee('planifiee')).toBe('Planifiée');
  });

  it('valeur absente → « — », valeur inconnue → valeur brute', () => {
    expect(libelleStatutFacture(null)).toBe('—');
    expect(libelleStatutFacture(undefined)).toBe('—');
    expect(libelleStatutPack('')).toBe('—');
    expect(libelleRole('role_inconnu')).toBe('role_inconnu');
    expect(libelleStatutTournee('statut_inconnu')).toBe('statut_inconnu');
  });

  it('variantes de badge : sémantique par valeur, neutral par défaut', () => {
    expect(variantStatutPack('actif')).toBe('success');
    expect(variantStatutPack('annule')).toBe('error');
    expect(variantStatutPack(null)).toBe('neutral');
    expect(variantVerificationSiret('en_attente')).toBe('warning');
    expect(variantVerificationSiret('echec')).toBe('error');
    expect(variantVerificationSiret('autre')).toBe('neutral');
  });
});

// ── R-UI-2 (C2-C11) : sources uniques complétées ─────────────────────────────
describe('R-UI-2 — lib/libelles : sources uniques C2-C11', () => {
  it('C2 type de collecte : long (graphie app, D38 ouverte), court, complet, alias zd/ag', () => {
    expect(libelleTypeCollecte('zero_dechet')).toBe('Zéro Déchet');
    expect(libelleTypeCollecte('anti_gaspi')).toBe('Anti-Gaspi');
    expect(libelleTypeCollecte('zd')).toBe('Zéro Déchet');
    expect(libelleTypeCollecte('ag')).toBe('Anti-Gaspi');
    expect(libelleCourtTypeCollecte('zero_dechet')).toBe('ZD');
    expect(libelleCourtTypeCollecte('ag')).toBe('AG');
    expect(libelleCompletTypeCollecte('zero_dechet')).toBe('Zéro Déchet (ZD)');
    expect(libelleCompletTypeCollecte('anti_gaspi')).toBe('Anti-Gaspi (AG)');
    expect(normaliserTypeCollecte('zd')).toBe('zero_dechet');
    expect(libelleTypeCollecte(null)).toBe('—');
    expect(libelleCourtTypeCollecte('')).toBe('—');
    expect(libelleTypeCollecte('autre')).toBe('autre');
    expect(libelleCompletTypeCollecte('autre')).toBe('autre');
    // Couleur majoritaire (arbitrage Q1 ouvert) : ZD vert, AG ambre.
    expect(variantTypeCollecte('zero_dechet')).toBe('success');
    expect(variantTypeCollecte('ag')).toBe('warning');
    expect(variantTypeCollecte('autre')).toBe('neutral');
  });

  it('C3/C4 facture : statut (Q12 « En attente Pennylane »), variantes, types long/court, options', () => {
    expect(variantStatutFacture('emise')).toBe('info');
    expect(variantStatutFacture('en_attente_pennylane')).toBe('warning');
    expect(variantStatutFacture('inconnu')).toBe('neutral');
    expect(LIBELLE_STATUT_FACTURE_PLURIEL.payee).toBe('Payées');
    expect(libelleTypeFacture('zero_dechet')).toBe('Zéro Déchet');
    expect(libelleTypeFacture('collecte_antigaspi')).toBe('Anti-Gaspi');
    expect(libelleTypeFacture('achat_pack_antigaspi')).toBe('Achat Pack AG');
    expect(libelleCourtTypeFacture('achat_pack_antigaspi')).toBe('Pack');
    expect(libelleCourtTypeFacture(null)).toBe('—');
    expect(libelleTypeFacture('x')).toBe('x');
    expect(optionsStatutFacture(['en_attente_pennylane', 'payee'])).toEqual([
      { id: 'en_attente_pennylane', nom: 'En attente Pennylane' },
      { id: 'payee', nom: 'Payée' },
    ]);
    expect(optionsStatutFacture()).toHaveLength(5);
    expect(optionsTypeFacture('court').map((o) => o.nom)).toEqual([
      'ZD',
      'AG',
      'Pack',
      'Avoir',
    ]);
    expect(optionsTypeFacture().map((o) => o.id)).toEqual([
      'zero_dechet',
      'collecte_antigaspi',
      'achat_pack_antigaspi',
      'avoir',
    ]);
  });

  it('C5 pack : libellés long/court, ordre de grille, crédits pré-remplis', () => {
    expect(libelleLongTypePack('pack_10')).toBe('Pack 10 collectes');
    expect(libelleLongTypePack('unitaire')).toBe('Unitaire (1 collecte)');
    expect(libelleLongTypePack('personnalise')).toBe('Personnalisé');
    expect(libelleLongTypePack(undefined)).toBe('—');
    expect(TYPES_PACK_GRILLE).toEqual([
      'unitaire',
      'pack_10',
      'pack_30',
      'pack_60',
    ]);
    expect(TYPES_PACK.at(-1)).toBe('personnalise');
    expect(CREDITS_TYPE_PACK.pack_60).toBe(60);
    expect(CREDITS_TYPE_PACK.personnalise).toBeUndefined();
  });

  it('C6 actif : « Inactif » unique (Q2 ouvert), féminin pour les associations', () => {
    expect(libelleActif(true)).toBe('Actif');
    expect(libelleActif(false)).toBe('Inactif');
    expect(libelleActif(false, 'association')).toBe('Inactive');
    expect(variantActif(true)).toBe('success');
    expect(variantActif(false)).toBe('neutral');
    expect(Object.keys(LIBELLE_ACTIF)).toEqual(['defaut', 'association']);
    expect(OPTIONS_FILTRE_ACTIF.map((o) => o.nom)).toEqual([
      'Actifs',
      'Inactifs',
    ]);
  });

  it('C8 type d’organisation : une graphie « Gestionnaire de lieux », court, minuscule', () => {
    expect(libelleTypeOrganisation('gestionnaire_lieux')).toBe(
      'Gestionnaire de lieux',
    );
    expect(libelleTypeOrganisationMinuscule('gestionnaire_lieux')).toBe(
      'gestionnaire de lieux',
    );
    expect(libelleTypeOrganisationMinuscule('agence')).toBe('agence');
    expect(libelleTypeOrganisationMinuscule('inconnu')).toBe('inconnu');
    expect(LIBELLE_COURT_TYPE_ORGANISATION.client_organisateur).toBe('Client');
    expect(libelleTypeOrganisation(null)).toBe('—');
  });

  it('C10/C11 lieux et type TMS : sources uniques', () => {
    expect(DIFFICULTE_LABEL.tres_difficile).toBe('Très difficile');
    expect(VEHICULE_LABEL.vul).toBe('VUL');
    expect(libelleCourtTypeTms('a_toutes')).toBe('A Toutes!');
    expect(libelleCourtTypeTms('par_mail')).toBe('Par mail');
    expect(libelleCourtTypeTms(null)).toBe('—');
    expect(libelleCourtTypeTms('x')).toBe('x');
    expect(Object.keys(LIBELLE_TYPE_TMS)).toHaveLength(5);
  });
});
