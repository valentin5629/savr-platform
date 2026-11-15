/**
 * Lieux Bubble → `plateforme.lieux` (fiche de mapping 03 + rapprochement validé
 * par Val le 2026-11-06).
 *
 * 1. Une « fiche » par adresse normalisée : les lignes Bubble de même adresse
 *    sont un seul lieu (règle de la fiche 03). Les adresses de collectes absentes
 *    du référentiel ajoutent des fiches, pour que chaque collecte ait un lieu.
 * 2. Entre fiches d'adresses différentes : rapprochement par position (service
 *    d'adresses) et ressemblance des noms, en trois niveaux.
 * 3. Les décisions de Val (fichier de correspondance) priment et sont rejouées.
 */
import type { Ligne } from '../csv';
import { identifiantCible } from '../identifiants';
import {
  codePostalVille,
  horodatageParis,
  lireDateBubble,
  lireOuiNon,
  normaliserAdresse,
  normaliserNom,
  regionDuCodePostal,
  texteOuNull,
  type DateMurale,
} from '../normalisation';
import {
  ajouterAuListing,
  SCORE_GEOCODE_MINIMAL,
  type Contexte,
  type Geocode,
  type Plan,
} from '../plan';
import {
  appliquerDecisions,
  distanceMetres,
  regrouper,
  ressemblanceNoms,
  type Proposition,
} from '../rapprochement';

/** Ce que les lieux lisent d'une collecte (2e passe, activité, traiteurs opérant). */
export interface PassageSurLieu {
  adresse: string;
  nomDuLieu: string;
  instruction: string;
  plaqueRequise: boolean;
  jour: string;
  creation: DateMurale | null;
  traiteurId: string | null;
}

export interface LieuRetenu {
  id: string;
  nom: string;
  /** Faux si le service d'adresses n'a pas situé le lieu (collecte marquée « historique partiel »). */
  situe: boolean;
}

interface Fiche {
  cle: string;
  adresse: string;
  noms: string[];
  instructions: string[];
  plaqueRequise: boolean;
  creation: DateMurale | null;
  modification: DateMurale | null;
  traiteurs: Set<string>;
  bubbleIds: string[];
  nbCollectes: number;
  derniereCollecte: string;
}

const DISTANCE_MEME_POSITION_M = 30;
const DISTANCE_VOISINAGE_M = 200;

function plusFrequents(noms: string[]): string[] {
  const compte = new Map<string, { nom: string; n: number; rang: number }>();
  noms.forEach((nom, rang) => {
    const cle = normaliserNom(nom);
    if (cle === '') return;
    const vu = compte.get(cle);
    if (vu) vu.n++;
    else compte.set(cle, { nom: nom.trim(), n: 1, rang });
  });
  return [...compte.values()]
    .sort((a, b) => b.n - a.n || a.rang - b.rang)
    .map((v) => v.nom);
}

function position(g: Geocode | null | undefined, precis: boolean) {
  if (!g || g.score < SCORE_GEOCODE_MINIMAL) return null;
  return precis && !g.precis ? null : g;
}

function anciennete(a: Fiche, b: Fiche): number {
  const da = a.creation ? `${a.creation.jour} ${a.creation.heure}` : '9999';
  const db = b.creation ? `${b.creation.jour} ${b.creation.heure}` : '9999';
  return da === db ? a.cle.localeCompare(b.cle) : da.localeCompare(db);
}

function proposer(fiches: Fiche[], ctx: Contexte): Proposition[] {
  const liensAuto: [string, string][] = [];
  const motifAuto = new Map<string, string>();
  const aRevoir = new Map<string, { autre: Fiche; motif: string }>();
  const noter = (a: Fiche, b: Fiche, motif: string) => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const deja = aRevoir.get(x.cle);
      if (!deja || anciennete(y, deja.autre) < 0)
        aRevoir.set(x.cle, { autre: y, motif });
    }
  };
  const nomPrincipal = new Map(
    fiches.map((f) => [f.cle, plusFrequents(f.noms)[0] ?? '']),
  );
  for (let i = 0; i < fiches.length; i++) {
    for (let j = i + 1; j < fiches.length; j++) {
      const a = fiches[i]!;
      const b = fiches[j]!;
      const pa = position(ctx.geocodes.get(a.cle), true);
      const pb = position(ctx.geocodes.get(b.cle), true);
      const d = pa && pb ? Math.round(distanceMetres(pa, pb)) : null;
      const r = ressemblanceNoms(
        nomPrincipal.get(a.cle)!,
        nomPrincipal.get(b.cle)!,
      );
      if (d !== null && d <= DISTANCE_MEME_POSITION_M && r >= 0.7) {
        liensAuto.push([a.cle, b.cle]);
        const motif = `même position (${d} m) et noms proches`;
        motifAuto.set(a.cle, motif);
        motifAuto.set(b.cle, motif);
      } else if (d !== null && d <= DISTANCE_MEME_POSITION_M)
        noter(a, b, `même position (${d} m), noms différents`);
      else if (d !== null && d <= DISTANCE_VOISINAGE_M && r >= 0.85)
        noter(a, b, `à ${d} m, noms proches`);
      else if (r >= 0.9)
        noter(
          a,
          b,
          d === null
            ? 'même nom, adresses différentes (position inconnue)'
            : `même nom, adresses distantes de ${d} m`,
        );
    }
  }
  const parCle = new Map(fiches.map((f) => [f.cle, f]));
  const chefAuto = regrouper(
    fiches.map((f) => f.cle),
    liensAuto,
    (membres) => membres.map((m) => parCle.get(m)!).sort(anciennete)[0]!.cle,
  );
  return fiches.map((f) => {
    const chef = chefAuto.get(f.cle)!;
    if (chef !== f.cle)
      return {
        cle: f.cle,
        niveau: 'auto',
        groupePropose: chef,
        motif: motifAuto.get(f.cle) ?? 'regroupée',
      };
    const voisin = aRevoir.get(f.cle);
    if (voisin && chefAuto.get(voisin.autre.cle) !== f.cle)
      return {
        cle: f.cle,
        niveau: 'a_revoir',
        groupePropose: chefAuto.get(voisin.autre.cle)!,
        motif: voisin.motif,
      };
    return { cle: f.cle, niveau: 'distinct', groupePropose: f.cle, motif: '' };
  });
}

export function transformerLieux(
  lieuxBubble: Ligne[],
  passages: PassageSurLieu[],
  organisationParNom: (nom: string) => string | null,
  /** Jour à partir duquel une collecte rend le lieu actif (24 mois avant l'import). */
  seuilActivite: string,
  ctx: Contexte,
  plan: Plan,
): Map<string, LieuRetenu> {
  const fiches = new Map<string, Fiche>();
  const fiche = (adresse: string): Fiche => {
    const cle = normaliserAdresse(adresse);
    let f = fiches.get(cle);
    if (!f) {
      f = {
        cle,
        adresse: adresse.trim(),
        noms: [],
        instructions: [],
        plaqueRequise: false,
        creation: null,
        modification: null,
        traiteurs: new Set(),
        bubbleIds: [],
        nbCollectes: 0,
        derniereCollecte: '',
      };
      fiches.set(cle, f);
    }
    return f;
  };
  const plusAncienne = (a: DateMurale | null, b: DateMurale | null) =>
    !a ? b : !b ? a : `${a.jour} ${a.heure}` <= `${b.jour} ${b.heure}` ? a : b;

  // De la plus ancienne à la plus récente : le résultat ne dépend pas de l'ordre de l'export.
  const instant = (l: Ligne) => {
    const d = lireDateBubble(l['Creation Date']);
    return d ? `${d.jour} ${d.heure}` : '9999';
  };
  const parAnciennete = [...lieuxBubble].sort(
    (a, b) =>
      instant(a).localeCompare(instant(b)) ||
      a['unique id']!.localeCompare(b['unique id']!),
  );
  for (const l of parAnciennete) {
    const id = l['unique id']!.trim();
    if (normaliserAdresse(l['adresse']) === '') {
      plan.rejets.push({
        sourceType: 'lieu',
        bubbleId: id,
        motif: 'adresse vide',
      });
      continue;
    }
    const f = fiche(l['adresse']!);
    const creation = lireDateBubble(l['Creation Date']);
    if (plusAncienne(f.creation, creation) !== f.creation) {
      f.creation = creation;
      f.adresse = l['adresse']!.trim();
    }
    f.modification ??= lireDateBubble(l['Modified Date']);
    f.bubbleIds.push(id);
    f.noms.push(l['Nom du lieu'] ?? '');
    const instruction = texteOuNull(l['instruction du lieu']);
    if (instruction && !f.instructions.includes(instruction))
      f.instructions.push(instruction);
    f.plaqueRequise ||=
      lireOuiNon(l["besoin de la plaque d'immatriculation"]) === true;
    const traiteur = organisationParNom(l['Entreprise'] ?? '');
    if (traiteur) f.traiteurs.add(traiteur);
  }

  // 2e passe : adresses de collectes absentes du référentiel, et activité de chaque lieu.
  const recents = [...passages].sort((a, b) => b.jour.localeCompare(a.jour));
  for (const p of recents) {
    const connue = fiches.has(normaliserAdresse(p.adresse));
    const f = fiche(p.adresse);
    if (!connue || f.bubbleIds.length === 0) {
      // Fiche née des collectes : nom et consigne de la collecte la plus récente.
      if (f.noms.length === 0 && p.nomDuLieu.trim() !== '')
        f.noms.push(p.nomDuLieu);
      if (f.instructions.length === 0 && p.instruction.trim() !== '')
        f.instructions.push(p.instruction.trim());
      f.creation = plusAncienne(f.creation, p.creation);
    }
    f.nbCollectes++;
    if (p.jour > f.derniereCollecte) f.derniereCollecte = p.jour;
    // Montée seule : une collecte qui exige la plaque rend le contrôle d'accès requis sur le lieu.
    f.plaqueRequise ||= p.plaqueRequise;
    if (p.traiteurId) f.traiteurs.add(p.traiteurId);
  }

  const liste = [...fiches.values()].sort(anciennete);
  const propositions = proposer(liste, ctx);
  const groupe = appliquerDecisions(propositions, ctx.decisions.lieux);
  const propositionParCle = new Map(propositions.map((p) => [p.cle, p]));
  const nomDe = (cle: string) =>
    plusFrequents(fiches.get(cle)?.noms ?? [])[0] ?? '';

  for (const f of liste) {
    const p = propositionParCle.get(f.cle)!;
    const g = ctx.geocodes.get(f.cle);
    plan.aValider.lieux.push({
      cle: f.cle,
      nom: nomDe(f.cle),
      adresse: f.adresse,
      latitude: g?.latitude ?? '',
      longitude: g?.longitude ?? '',
      score_adresse: g?.score ?? '',
      nb_fiches_bubble: f.bubbleIds.length,
      nb_collectes: f.nbCollectes,
      niveau: p.niveau,
      groupe_propose: p.groupePropose,
      nom_groupe_propose: nomDe(p.groupePropose),
      adresse_groupe_propose: fiches.get(p.groupePropose)?.adresse ?? '',
      motif: p.motif,
      groupe_decide: ctx.decisions.lieux.get(f.cle) ?? '',
    });
  }

  const membres = new Map<string, Fiche[]>();
  for (const f of liste) {
    const chef = groupe.get(f.cle)!;
    membres.set(chef, [...(membres.get(chef) ?? []), f]);
  }
  const retenus = new Map<string, LieuRetenu>();
  for (const [chef, groupeFiches] of membres) {
    const tete = fiches.get(chef)!;
    const id = identifiantCible('lieu', chef);
    const noms = plusFrequents(groupeFiches.flatMap((f) => f.noms));
    const geocode =
      groupeFiches
        .map((f) => position(ctx.geocodes.get(f.cle), false))
        .find((g) => g !== null) ?? null;
    const lu = codePostalVille(tete.adresse);
    const codePostal = geocode?.codePostal ?? lu?.codePostal ?? null;
    const ville = geocode?.ville ?? lu?.ville ?? null;
    const region = regionDuCodePostal(codePostal);
    const manques = [
      geocode ? null : 'position',
      codePostal ? null : 'code postal',
      ville ? null : 'ville',
    ].filter((m) => m !== null);
    if (manques.length > 0)
      ajouterAuListing(plan, 'lieux-a-completer', {
        lieu_id: id,
        nom: noms[0] ?? tete.adresse,
        adresse: tete.adresse,
        manque: manques.join(', '),
      });
    const instructions = [
      ...new Set(groupeFiches.flatMap((f) => f.instructions)),
    ];
    const nbFiches = groupeFiches.reduce((n, f) => n + f.bubbleIds.length, 0);
    const derniere = groupeFiches
      .map((f) => f.derniereCollecte)
      .sort()
      .at(-1)!;
    const created_at = tete.creation
      ? horodatageParis(tete.creation)
      : ctx.instantImport;
    plan.tables.lieux.push({
      id,
      nom: noms[0] ?? tete.adresse,
      nom_alternatif: noms[1] ?? null,
      adresse_acces: tete.adresse,
      code_postal: codePostal ?? '00000',
      ville: ville ?? 'À compléter',
      latitude: geocode?.latitude ?? null,
      longitude: geocode?.longitude ?? null,
      region: region ?? 'idf',
      acces_details:
        instructions.length > 0 ? instructions.join('\n---\n') : null,
      // Pas de source Bubble : valeur la moins contraignante, resserrée par l'Admin (fiche 03).
      type_vehicule_max: 'poids_lourd',
      traiteurs_operant: [
        ...new Set(groupeFiches.flatMap((f) => [...f.traiteurs])),
      ].sort(),
      controle_acces_requis_default: groupeFiches.some((f) => f.plaqueRequise),
      photos_urls: [],
      commentaires_internes:
        `Migration Bubble — ${nbFiches} fiche(s) Bubble, ${groupeFiches.length} adresse(s) regroupée(s)` +
        (noms.length > 2
          ? ` — autres noms : ${noms.slice(2).join(' ; ')}`
          : ''),
      actif: derniere !== '' && derniere >= seuilActivite,
      created_at,
      updated_at: tete.modification
        ? horodatageParis(tete.modification)
        : created_at,
    });
    for (const f of groupeFiches) {
      retenus.set(f.cle, {
        id,
        nom: noms[0] ?? tete.adresse,
        situe: geocode !== null,
      });
      for (const bubbleId of f.bubbleIds)
        plan.correspondances.push({
          sourceType: 'lieu',
          bubbleId,
          table: 'lieux',
          cibleId: id,
          fusionne: !(f.cle === chef && bubbleId === f.bubbleIds[0]),
        });
      if (f.bubbleIds.length === 0)
        plan.correspondances.push({
          sourceType: 'lieu_adresse',
          bubbleId: f.cle,
          table: 'lieux',
          cibleId: id,
          fusionne: f.cle !== chef,
        });
    }
  }
  return retenus;
}

/** Adresses à situer : celles des fiches Bubble et des collectes, normalisées et sans doublon. */
export function adressesASituer(
  lieuxBubble: Ligne[],
  adressesCollectes: string[],
): Map<string, string> {
  const adresses = new Map<string, string>();
  for (const a of [
    ...lieuxBubble.map((l) => l['adresse'] ?? ''),
    ...adressesCollectes,
  ]) {
    const cle = normaliserAdresse(a);
    if (cle !== '' && !adresses.has(cle)) adresses.set(cle, a.trim());
  }
  return adresses;
}
