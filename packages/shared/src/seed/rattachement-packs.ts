/**
 * Rattachement des collectes Anti-Gaspi aux packs du jeu de démo.
 *
 * En base, une collecte porte un pack quand elle en a décompté un crédit : le
 * nombre de collectes d'un pack égale donc ses crédits utilisés, et aucune
 * n'est antérieure à son achat. Le seed posait jusqu'ici le pack actif de
 * l'organisation sur TOUTES ses collectes réalisées, quelle que soit leur date,
 * avec un compteur fixé à la main (constaté le 2026-11-02 : 61 collectes pour
 * 6 crédits sur le pack Kaspia de savr-dev).
 *
 * Règle, par organisation programmatrice (celle de l'événement) :
 * - le pack ACTIF décompte les `creditsUtilises` collectes les plus récentes ;
 *   sa date d'achat est celle de la plus ancienne d'entre elles, pour que
 *   toute collecte postérieure à l'achat l'ait bien utilisé ;
 * - un pack ÉPUISÉ décompte, dans l'ordre, les premières collectes qui suivent
 *   son achat et précèdent celui du pack suivant ;
 * - les autres collectes sont facturées à l'unité (aucun pack).
 * Module pur : aucune écriture, testé à part.
 */

export interface CollecteARattacher {
  id: string;
  /** Organisation programmatrice (evenements.organisation_id). */
  organisationId: string;
  /** AAAA-MM-JJ. */
  date: string;
}

export interface PackARattacher {
  id: string;
  organisationId: string;
  statut: 'actif' | 'epuise' | 'annule';
  /** AAAA-MM-JJ ; recalculée pour le pack actif. */
  dateAchat: string;
  creditsUtilises: number;
}

export interface Rattachement {
  /** Collecte → pack décompté. Une collecte absente n'a pas de pack. */
  packParCollecte: Map<string, string>;
  /** Pack → crédits réellement utilisés et date d'achat retenue. */
  packs: Map<string, { creditsUtilises: number; dateAchat: string }>;
}

const parDate = (a: CollecteARattacher, b: CollecteARattacher) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

export function rattacherCollectesAuxPacks(
  collectes: readonly CollecteARattacher[],
  packs: readonly PackARattacher[],
): Rattachement {
  const packParCollecte = new Map<string, string>();
  const resultat = new Map<
    string,
    { creditsUtilises: number; dateAchat: string }
  >();

  for (const org of new Set(packs.map((p) => p.organisationId))) {
    const restantes = collectes
      .filter((c) => c.organisationId === org)
      .sort(parDate);
    const packsOrg = packs.filter((p) => p.organisationId === org);

    // 1. Le pack actif prend les plus récentes ; il borne les épuisés.
    let borne = '9999-12-31';
    for (const p of packsOrg.filter((x) => x.statut === 'actif')) {
      const prises = restantes.splice(
        Math.max(0, restantes.length - p.creditsUtilises),
      );
      for (const c of prises) packParCollecte.set(c.id, p.id);
      const dateAchat = prises[0]?.date ?? p.dateAchat;
      resultat.set(p.id, { creditsUtilises: prises.length, dateAchat });
      if (prises[0]) borne = prises[0].date;
    }

    // 2. Les épuisés, du plus ancien au plus récent, chacun jusqu'à l'achat
    //    du suivant.
    const epuises = packsOrg
      .filter((x) => x.statut !== 'actif')
      .sort((a, b) => a.dateAchat.localeCompare(b.dateAchat));
    epuises.forEach((p, k) => {
      const fin = epuises[k + 1]?.dateAchat ?? borne;
      const prises: CollecteARattacher[] = [];
      for (const c of [...restantes]) {
        if (prises.length >= p.creditsUtilises) break;
        if (c.date < p.dateAchat || c.date >= fin) continue;
        prises.push(c);
        restantes.splice(restantes.indexOf(c), 1);
      }
      for (const c of prises) packParCollecte.set(c.id, p.id);
      resultat.set(p.id, {
        creditsUtilises: prises.length,
        dateAchat: p.dateAchat,
      });
    });
  }

  return { packParCollecte, packs: resultat };
}
