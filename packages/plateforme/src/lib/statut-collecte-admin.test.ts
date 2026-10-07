/**
 * M0.6 — statut de collecte AFFICHÉ côté Admin (décision Val 2026-10-07) :
 * « Créée » = le traiteur a validé sa programmation, rien n'est parti ;
 * « Programmée » = la demande est partie vers le prestataire logistique.
 * Les deux formes de la règle (ligne chargée / filtre PostgREST de la liste)
 * sont tenues d'accord ici.
 */
import { describe, it, expect } from 'vitest';
import {
  demandeEnvoyee,
  filtreStatutsAdmin,
  statutCollecteAdmin,
  type EnvoiCollecte,
} from './statut-collecte-admin';

const CREEE: EnvoiCollecte = {
  statut: 'programmee',
  statut_tms: 'non_envoye',
  tms_reference: null,
  prestataire_logistique_id: null,
  attributions_antgaspi: null,
};

// Chaque signal « demande partie », pris isolément.
const SIGNAUX: [string, Partial<EnvoiCollecte>][] = [
  ['prestataire posé au dispatch', { prestataire_logistique_id: 'presta-1' }],
  [
    'attribution AG validée (embed objet)',
    { attributions_antgaspi: { id: 'attr-1' } },
  ],
  [
    'attribution AG validée (embed tableau)',
    { attributions_antgaspi: [{ id: 'attr-1' }] },
  ],
  ['ordre transmis au TMS', { statut_tms: 'attribuee_en_attente_acceptation' }],
  ['référence de commande reçue', { tms_reference: 'TOUR-42' }],
];

describe('M0.6 / statut Admin — Créée puis Programmée', () => {
  it('M0.6/statut_admin_creee_avant_envoi — `programmee` sans aucun signal d’envoi = « Créée »', () => {
    expect(demandeEnvoyee(CREEE)).toBe(false);
    expect(statutCollecteAdmin(CREEE)).toBe('creee');
    // Un embed tableau vide (aucune attribution) n'est pas un signal.
    expect(statutCollecteAdmin({ ...CREEE, attributions_antgaspi: [] })).toBe(
      'creee',
    );
  });

  it.each(SIGNAUX)(
    'M0.6/statut_admin_programmee_apres_envoi — %s = « Programmée »',
    (_nom, signal) => {
      const collecte = { ...CREEE, ...signal };
      expect(demandeEnvoyee(collecte)).toBe(true);
      expect(statutCollecteAdmin(collecte)).toBe('programmee');
    },
  );

  it('M0.6/statut_admin_programmee_transporteur_manuel — mail / téléphone : « Programmée » dès la validation, sans rien de transmis', () => {
    // Transporteur manuel : le worker ne transmet rien, le statut TMS reste
    // « non envoyé » et aucune référence n'arrive. Avec prestataire relié…
    expect(
      statutCollecteAdmin({ ...CREEE, prestataire_logistique_id: 'presta-m' }),
    ).toBe('programmee');
    // … ou sans (seule l'attribution validée en garde la trace).
    expect(
      statutCollecteAdmin({ ...CREEE, attributions_antgaspi: { id: 'a' } }),
    ).toBe('programmee');
  });

  it('hors `programmee`, la clé d’affichage est le statut DB', () => {
    for (const statut of [
      'brouillon',
      'validee',
      'en_cours',
      'realisee',
      'realisee_sans_collecte',
      'cloturee',
      'annulation_demandee',
      'annulee',
      'rejetee_par_prestataire',
    ]) {
      expect(statutCollecteAdmin({ ...CREEE, statut })).toBe(statut);
    }
  });
});

// ── Filtre de la liste : mini-interprète de la syntaxe PostgREST produite ─────
// Juste ce que `filtreStatutsAdmin` émet : and(…) / or(…), eq, neq, is.null,
// not.is.null, in.(…). Sert à prouver que le filtre retient exactement les
// lignes que `statutCollecteAdmin` range sous la clé demandée.
function decoupe(expr: string): string[] {
  const termes: string[] = [];
  let niveau = 0;
  let debut = 0;
  [...expr].forEach((c, i) => {
    if (c === '(') niveau++;
    else if (c === ')') niveau--;
    else if (c === ',' && niveau === 0) {
      termes.push(expr.slice(debut, i));
      debut = i + 1;
    }
  });
  termes.push(expr.slice(debut));
  return termes;
}

function vrai(terme: string, ligne: Record<string, unknown>): boolean {
  const groupe = /^(and|or)\((.*)\)$/.exec(terme);
  if (groupe) {
    const membres = decoupe(groupe[2] ?? '').map((t) => vrai(t, ligne));
    return groupe[1] === 'and' ? membres.every(Boolean) : membres.some(Boolean);
  }
  const [colonne = '', ...reste] = terme.split('.');
  const valeur = ligne[colonne];
  const vide = Array.isArray(valeur) ? valeur.length === 0 : valeur == null;
  const op = reste.join('.');
  if (op === 'is.null') return vide;
  if (op === 'not.is.null') return !vide;
  if (op.startsWith('eq.')) return valeur === op.slice(3);
  if (op.startsWith('neq.')) return valeur !== op.slice(4);
  const liste = /^in\.\((.*)\)$/.exec(op);
  if (liste) return (liste[1] ?? '').split(',').includes(String(valeur));
  throw new Error(`terme PostgREST non géré par le test : ${terme}`);
}

function retenue(cles: string[], ligne: EnvoiCollecte): boolean {
  const filtre = filtreStatutsAdmin(cles);
  if (!filtre) throw new Error('filtre attendu');
  return 'or' in filtre
    ? decoupe(filtre.or).some((t) =>
        vrai(t, ligne as unknown as Record<string, unknown>),
      )
    : (filtre.statuts as string[]).includes(ligne.statut);
}

const LIGNES: EnvoiCollecte[] = [
  CREEE,
  { ...CREEE, attributions_antgaspi: [] },
  ...SIGNAUX.map(([, signal]) => ({ ...CREEE, ...signal })),
  { ...CREEE, statut: 'validee', statut_tms: 'acceptee' },
  { ...CREEE, statut: 'en_cours', statut_tms: 'acceptee' },
  { ...CREEE, statut: 'annulee' },
];

describe('M0.6 / statut Admin — filtre « Statut » de la liste Collectes', () => {
  it.each([
    [['creee']],
    [['programmee']],
    [['creee', 'validee']],
    [['programmee', 'validee', 'en_cours']],
    [['creee', 'programmee']],
    [['creee', 'programmee', 'en_cours']],
    [['validee']],
  ])(
    'M0.6/statut_admin_filtre_creee_programmee — sélection %j : le filtre retient les lignes affichées sous ces statuts, et elles seules',
    (cles) => {
      for (const ligne of LIGNES) {
        expect(retenue(cles, ligne)).toBe(
          cles.includes(statutCollecteAdmin(ligne)),
        );
      }
    },
  );

  it('« Créée » et « Programmée » cochées ensemble (ou aucune) : simple liste de statuts DB', () => {
    expect(filtreStatutsAdmin(['creee', 'programmee', 'validee'])).toEqual({
      statuts: ['programmee', 'validee'],
    });
    expect(filtreStatutsAdmin(['en_cours', 'validee'])).toEqual({
      statuts: ['validee', 'en_cours'],
    });
  });

  it('une seule des deux : expression `or` bornée au statut DB `programmee`', () => {
    expect(filtreStatutsAdmin(['creee'])).toEqual({
      or: 'and(statut.eq.programmee,statut_tms.eq.non_envoye,tms_reference.is.null,prestataire_logistique_id.is.null,attributions_antgaspi.is.null)',
    });
    expect(filtreStatutsAdmin(['programmee', 'validee'])).toEqual({
      or: 'and(statut.eq.programmee,or(statut_tms.neq.non_envoye,tms_reference.not.is.null,prestataire_logistique_id.not.is.null,attributions_antgaspi.not.is.null)),statut.in.(validee)',
    });
  });

  it('M0.6/statut_admin_brouillon_absent — clés inconnues et `brouillon` écartés : rien ne part tel quel dans `.or()`', () => {
    expect(filtreStatutsAdmin([])).toBeNull();
    expect(filtreStatutsAdmin(['brouillon'])).toBeNull();
    expect(filtreStatutsAdmin(['nimporte', 'statut.eq.annulee)'])).toBeNull();
    expect(
      filtreStatutsAdmin(['creee', 'brouillon', 'x),statut.neq.zz']),
    ).toEqual(filtreStatutsAdmin(['creee']));
  });
});
