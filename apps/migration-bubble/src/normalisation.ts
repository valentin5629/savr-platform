/**
 * Règles de lecture communes à toutes les tables (04 - Transformations §2 à §9).
 * Fonctions pures : même entrée, même sortie, à chaque passage.
 *
 * Aucun objet Date ici : une date Bubble est une heure murale de Paris, gardée
 * en texte (« 2021-10-14 », « 12:00 ») et convertie par Postgres au moment de
 * l'écriture (`… Europe/Paris`), qui connaît les changements d'heure.
 */

const MOIS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

export interface DateMurale {
  /** AAAA-MM-JJ, heure de Paris. */
  jour: string;
  /** HH:MM, heure de Paris. */
  heure: string;
}

/** « Oct 14, 2021 12:00 pm » → { jour: '2021-10-14', heure: '12:00' } ; illisible → null. */
export function lireDateBubble(texte: string | undefined): DateMurale | null {
  const m =
    /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (am|pm)$/.exec(
      (texte ?? '').trim(),
    );
  if (!m) return null;
  const mois = MOIS[m[1]!];
  const h12 = Number(m[4]);
  if (!mois || h12 < 1 || h12 > 12 || Number(m[5]) > 59) return null;
  const h24 = (h12 % 12) + (m[6] === 'pm' ? 12 : 0);
  return {
    jour: `${m[3]}-${mois}-${m[2]!.padStart(2, '0')}`,
    heure: `${String(h24).padStart(2, '0')}:${m[5]}`,
  };
}

/** Texte accepté tel quel par une colonne `timestamptz` : Postgres applique le fuseau. */
export function horodatageParis(d: DateMurale): string {
  return `${d.jour} ${d.heure}:00 Europe/Paris`;
}

/** Décale un jour AAAA-MM-JJ d'un nombre d'années (négatif = passé). Sert aux seuils, comparés en texte. */
export function decalerAnnees(jour: string, annees: number): string {
  return `${String(Number(jour.slice(0, 4)) + annees).padStart(4, '0')}${jour.slice(4)}`;
}

/** « 31,2 » → 31.2 ; vide ou illisible → null (jamais 0 en silence). */
export function lireDecimal(texte: string | undefined): number | null {
  const t = (texte ?? '').trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export function lireEntier(texte: string | undefined): number | null {
  const t = (texte ?? '').trim();
  return /^-?\d+$/.test(t) ? Number(t) : null;
}

/** « oui » → true, « non » → false, autre → null (le défaut est décidé par la fiche, pas ici). */
export function lireOuiNon(texte: string | undefined): boolean | null {
  const t = (texte ?? '').trim().toLowerCase();
  return t === 'oui' ? true : t === 'non' ? false : null;
}

export function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Clé de comparaison d'un nom : minuscules, sans accents, ponctuation → espace. */
export function normaliserNom(texte: string | undefined): string {
  return sansAccents((texte ?? '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Clé de dédoublonnage d'une adresse (04 - Transformations §7). */
export function normaliserAdresse(texte: string | undefined): string {
  return sansAccents((texte ?? '').toLowerCase())
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/,\s*france$/, '')
    .replace(/[\s.,;]+$/, '');
}

/** Dernier « 75008 Paris » d'une adresse ; absent → null. */
export function codePostalVille(
  adresse: string | undefined,
): { codePostal: string; ville: string } | null {
  const trouves = [
    ...(adresse ?? '').matchAll(/(?<!\d)(\d{5})\s+([^,\d][^,]*)/g),
  ];
  const m = trouves.at(-1);
  if (!m) return null;
  return { codePostal: m[1]!, ville: m[2]!.trim() };
}

const DEPARTEMENTS_IDF = new Set([
  '75',
  '77',
  '78',
  '91',
  '92',
  '93',
  '94',
  '95',
]);

export function regionDuCodePostal(
  codePostal: string | null,
): 'idf' | 'province' | null {
  if (!codePostal || !/^\d{5}$/.test(codePostal)) return null;
  return DEPARTEMENTS_IDF.has(codePostal.slice(0, 2)) ? 'idf' : 'province';
}

/** Premier numéro d'un champ, au format E.164 français ; illisible → null. */
export function telephoneE164(texte: string | undefined): string | null {
  const premier = (texte ?? '').split('/')[0] ?? '';
  let chiffres = premier.replace(/\D/g, '');
  if (chiffres.startsWith('0033')) chiffres = chiffres.slice(4);
  else if (chiffres.startsWith('33') && chiffres.length === 11)
    chiffres = chiffres.slice(2);
  else if (chiffres.startsWith('0') && chiffres.length === 10)
    chiffres = chiffres.slice(1);
  return /^[1-9]\d{8}$/.test(chiffres) ? `+33${chiffres}` : null;
}

const FORME_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Adresses lisibles d'un champ qui peut en contenir plusieurs, en minuscules. */
export function lireEmails(texte: string | undefined): string[] {
  return (texte ?? '')
    .toLowerCase()
    .split(/[\s,;/]+/)
    .filter((e) => FORME_EMAIL.test(e));
}

export function domaineEmail(email: string): string | null {
  const d = email.toLowerCase().trim().split('@')[1];
  return d && d.includes('.') ? d : null;
}

/** SIRET : 14 chiffres une fois les séparateurs retirés ; sinon null. */
export function lireSiret(texte: string | undefined): string | null {
  const chiffres = (texte ?? '').replace(/\D/g, '');
  return chiffres.length === 14 ? chiffres : null;
}

/** SIREN : 9 chiffres ; un SIRET de 14 chiffres donne ses 9 premiers ; sinon null. */
export function lireSiren(texte: string | undefined): string | null {
  const chiffres = (texte ?? '').replace(/\D/g, '');
  if (chiffres.length === 9) return chiffres;
  return chiffres.length === 14 ? chiffres.slice(0, 9) : null;
}

/** « PARIS / Nom » → { zone: 'PARIS', nom: 'Nom' } ; sans préfixe → zone null. */
export function retirerPrefixeZone(nom: string | undefined): {
  zone: string | null;
  nom: string;
} {
  const t = (nom ?? '').trim();
  const m = /^([A-ZÀ-Ý]{2,})\s*\/\s*(.+)$/.exec(t);
  return m ? { zone: m[1]!, nom: m[2]!.trim() } : { zone: null, nom: t };
}

/**
 * Texte borné pour une colonne contrôlée par un CHECK (longueur, pas de
 * caractère de contrôle). `multiligne` garde tabulations et retours à la ligne.
 */
export function texteBorne(
  texte: string | undefined,
  longueur: number,
  multiligne = false,
): string | null {
  const controle = multiligne
    ? // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
    : // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/g;
  const propre = (texte ?? '').replace(controle, ' ').trim();
  return propre === '' ? null : propre.slice(0, longueur).trim();
}

/** Vide → null, sinon le texte sans espaces autour. */
export function texteOuNull(texte: string | undefined): string | null {
  const t = (texte ?? '').trim();
  return t === '' ? null : t;
}
