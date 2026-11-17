// Parcours des utilisateurs simulés. Importé par les scénarios k6 (dépend de
// `k6/http`, donc hors Vitest).
//
// ⚠ Écritures : uniquement des BROUILLONS (`confirmer: false`), créés, modifiés
// puis supprimés dans la même itération. Un brouillon n'émet aucun ordre vers
// un prestataire ni aucun email (route POST /api/v1/programmation/evenements,
// « un brouillon n'émet rien »). Confirmer une programmation sur dev enverrait
// de vraies commandes aux prestataires logistiques : mesuré sur dev, 38
// créations ZD sur 59 en 60 jours sont parties chez un prestataire (ordres
// `collecte.creee` traités par un adapter, pas en no-op). Le run ne confirme
// donc jamais.
// Les brouillons portent le préfixe `PREFIXE_BROUILLON` ; `nettoyer()` supprime
// ceux qu'un run interrompu aurait laissés.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

import { entetes } from './config.js';

export const PREFIXE_BROUILLON = '[charge]';

const reponses429 = new Counter('reponses_429');
const requetes = new Counter('requetes_par_nature');
const dureePages = new Trend('duree_pages', true);

// Session renouvelée avant l'expiration du jeton d'accès (1 h) : sans cela, un
// run long verrait des 401 qui ne disent rien de la plateforme.
const DUREE_SESSION_MS = 45 * 60 * 1000;

// `etat` : un objet par utilisateur simulé (les variables de module sont
// propres à chaque VU dans k6).
export function nouvelEtat(cfg, compte, tagsCommuns = () => ({})) {
  return {
    cfg,
    compte,
    tagsCommuns,
    connecteA: 0,
    evenements: [],
    collectes: [],
    referentiels: null,
  };
}

function appeler(etat, methode, chemin, o) {
  const params = {
    headers: entetes(etat.cfg, o.corps !== undefined),
    // Jamais de redirection suivie : une session perdue renvoie vers /login,
    // qui répondrait 200 et passerait pour un succès.
    redirects: 0,
    tags: {
      name: o.nom,
      sla: o.sla || 'aucun',
      nature: o.nature,
      ...etat.tagsCommuns(),
    },
  };
  const corps = o.corps === undefined ? null : JSON.stringify(o.corps);
  const res = http.request(methode, etat.cfg.baseUrl + chemin, corps, params);
  requetes.add(1, { nature: o.nature });
  if (res.status === 429) reponses429.add(1);
  if (res.status === 401) etat.connecteA = 0;
  if (o.page) dureePages.add(res.timings.duration, { name: o.nom });
  const attendu = o.attendu || 200;
  const ok = check(res, {
    [`${o.nom} → ${attendu}`]: (r) => r.status === attendu,
  });
  if (!ok) signalerInattendu(etat, o.nom, res);
  return res;
}

// Trois premières réponses inattendues par route et par utilisateur simulé :
// code, redirection éventuelle, champ `error` du JSON. Rien d'autre du corps
// (il peut porter des données de collecte).
function signalerInattendu(etat, nom, res) {
  etat.signales = etat.signales || {};
  const n = (etat.signales[nom] = (etat.signales[nom] || 0) + 1);
  if (n > 3) return;
  const json = lireJson(res);
  const erreur = json && typeof json.error === 'string' ? json.error : '';
  const vers = res.headers.Location || res.headers.location || '';
  console.warn(
    `[${etat.compte.email}] ${nom} → ${res.status}${vers ? ` vers ${vers}` : ''}${erreur ? ` : ${erreur.slice(0, 160)}` : ''}`,
  );
}

function lireJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

export function assurerSession(etat) {
  if (etat.connecteA && Date.now() - etat.connecteA < DUREE_SESSION_MS) return;
  if (etat.connecteA) {
    appeler(etat, 'POST', '/api/auth/logout', {
      nom: 'POST /api/auth/logout',
      nature: 'connexion',
    });
  }
  const res = appeler(etat, 'POST', '/api/auth/login', {
    nom: 'POST /api/auth/login',
    sla: 'connexion',
    nature: 'connexion',
    corps: { email: etat.compte.email, mot_de_passe: etat.cfg.motDePasse },
  });
  etat.connecteA = res.status === 200 ? Date.now() : 0;
}

export function pause(etat) {
  const { pauseMinS: min, pauseMaxS: max } = etat.cfg;
  sleep(min + Math.random() * (max - min));
}

// Tirage pondéré : `poids` = { action: poids }.
export function tirer(poids) {
  const total = Object.values(poids).reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (const [action, p] of Object.entries(poids)) {
    x -= p;
    if (x < 0) return action;
  }
  return Object.keys(poids)[0];
}

const JOUR_MS = 24 * 3600 * 1000;

// Jour (AAAA-MM-JJ) à `decalage` jours d'aujourd'hui. En UTC : k6 ne peut pas
// importer `jourParis()` (TypeScript du dépôt). Le décalage d'un jour entre 22 h
// et minuit à Paris est sans effet ici (fenêtre de 12 mois, brouillon à J+30).
function jour(decalage) {
  // eslint-disable-next-line no-restricted-syntax -- cf. commentaire ci-dessus
  return new Date(Date.now() + decalage * JOUR_MS).toISOString().slice(0, 10);
}

function periode12Mois() {
  return `from=${jour(-365)}&to=${jour(0)}`;
}

function au(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// ─── Lectures communes ──────────────────────────────────────────────────────

function listeEvenements(etat, page) {
  if (page) {
    appeler(etat, 'GET', page, {
      nom: `GET ${page}`,
      nature: 'lecture',
      page: true,
    });
  }
  const res = appeler(etat, 'GET', '/api/v1/evenements?page=1', {
    nom: 'GET /api/v1/evenements',
    sla: 'liste',
    nature: 'lecture',
  });
  const json = lireJson(res);
  const ids = ((json && json.data) || []).map((e) => e.id).filter(Boolean);
  if (ids.length) etat.evenements = ids;
}

function ficheEvenement(etat) {
  if (!etat.evenements.length) listeEvenements(etat);
  if (!etat.evenements.length) return;
  const id = au(etat.evenements);
  const res = appeler(etat, 'GET', `/api/v1/evenements/${id}`, {
    nom: 'GET /api/v1/evenements/[id]',
    sla: 'fiche',
    nature: 'lecture',
  });
  const json = lireJson(res);
  const collectes = (json && json.data && json.data.collectes) || [];
  const ids = collectes.map((c) => c.id).filter(Boolean);
  if (ids.length) etat.collectes = ids;
}

function exporterCollectes(etat) {
  appeler(etat, 'GET', `/api/v1/exports/collectes?${periode12Mois()}`, {
    nom: 'GET /api/v1/exports/collectes',
    sla: 'export',
    nature: 'batch',
  });
}

// ─── Traiteur ───────────────────────────────────────────────────────────────

// Poids choisis pour que les REQUÊTES suivent le mix du scénario 1 (70 %
// lecture, 25 % écriture, 5 % batch) : une action de lecture fait 2 requêtes,
// la programmation 3 écritures, l'export 1. 35 × 2 = 70, 8 × 3 = 24, 5 × 1 = 5.
export const POIDS_TRAITEUR = {
  tableauDeBord: 10,
  liste: 11,
  fiche: 10,
  registre: 4,
  programmation: 8,
  export: 5,
};

const ACTIONS_TRAITEUR = {
  tableauDeBord(etat) {
    appeler(etat, 'GET', '/traiteur', {
      nom: 'GET /traiteur',
      nature: 'lecture',
      page: true,
    });
    appeler(
      etat,
      'GET',
      `/api/v1/dashboards/traiteur-full?${periode12Mois()}&type=zero_dechet`,
      {
        nom: 'GET /api/v1/dashboards/traiteur-full',
        sla: 'tableau_de_bord_client',
        nature: 'lecture',
      },
    );
  },
  liste(etat) {
    listeEvenements(etat, '/traiteur/evenements');
  },
  fiche(etat) {
    ficheEvenement(etat);
    if (!etat.collectes.length) return;
    appeler(etat, 'GET', `/api/v1/traiteur/collectes/${au(etat.collectes)}`, {
      nom: 'GET /api/v1/traiteur/collectes/[id]',
      sla: 'fiche',
      nature: 'lecture',
    });
  },
  registre(etat) {
    appeler(etat, 'GET', '/registre', {
      nom: 'GET /registre',
      nature: 'lecture',
      page: true,
    });
    appeler(etat, 'GET', '/api/v1/registre', {
      nom: 'GET /api/v1/registre',
      sla: 'registre',
      nature: 'lecture',
    });
  },
  programmation(etat) {
    const ref = referentiels(etat);
    if (!ref) return;
    const nom = `${PREFIXE_BROUILLON} ${etat.compte.organisation} ${Date.now()}`;
    const cree = appeler(etat, 'POST', '/api/v1/programmation/evenements', {
      nom: 'POST /api/v1/programmation/evenements',
      sla: 'programmation',
      nature: 'ecriture',
      attendu: 201,
      corps: corpsBrouillon(ref, nom, 120),
    });
    const json = lireJson(cree);
    const id = json && json.evenement_id;
    if (!id) return;
    appeler(etat, 'PUT', `/api/v1/programmation/evenements/${id}/brouillon`, {
      nom: 'PUT /api/v1/programmation/evenements/[id]/brouillon',
      sla: 'modification',
      nature: 'ecriture',
      corps: corpsBrouillon(ref, nom, 150),
    });
    appeler(etat, 'DELETE', `/api/v1/programmation/evenements/${id}`, {
      nom: 'DELETE /api/v1/programmation/evenements/[id]',
      sla: 'suppression',
      nature: 'ecriture',
      attendu: 204,
    });
  },
  export: exporterCollectes,
};

// Lieu et type d'événement du formulaire, chargés une fois par utilisateur
// simulé (le formulaire les charge à l'ouverture).
function referentiels(etat) {
  if (etat.referentiels) return etat.referentiels;
  const lieux = lireJson(
    appeler(etat, 'GET', '/api/v1/programmation/lieux', {
      nom: 'GET /api/v1/programmation/lieux',
      sla: 'recherche',
      nature: 'lecture',
    }),
  );
  const types = lireJson(
    appeler(etat, 'GET', '/api/v1/programmation/types-evenements', {
      nom: 'GET /api/v1/programmation/types-evenements',
      sla: 'recherche',
      nature: 'lecture',
    }),
  );
  const lieu = Array.isArray(lieux) && lieux[0];
  const type = Array.isArray(types) && types[0];
  const ok = check(null, {
    'référentiels du formulaire disponibles': () => Boolean(lieu && type),
  });
  if (!ok) return null;
  etat.referentiels = { lieuId: lieu.id, typeEvenementId: type.id };
  return etat.referentiels;
}

function corpsBrouillon(ref, nom, pax) {
  const date = jour(30);
  return {
    lieu_id: ref.lieuId,
    nom_evenement: nom,
    confirmer: false,
    collectes: [
      {
        type: 'zd',
        date_collecte: date,
        heure_collecte: '22:00',
        pax,
        type_evenement_id: ref.typeEvenementId,
        contact_principal_nom: 'Test charge',
        contact_principal_telephone: '0600000000',
        contact_secours_nom: 'Test charge secours',
        contact_secours_telephone: '0600000001',
      },
    ],
  };
}

// ─── Équipe Savr ────────────────────────────────────────────────────────────

// Le registre est réservé aux rôles clients (`ROLES_REGISTRE`, lib/routes.ts) :
// il est dans le parcours traiteur, pas ici.
export const POIDS_EQUIPE = {
  tableauDeBord: 12,
  liste: 14,
  fiche: 9,
  export: 3,
};

const ACTIONS_EQUIPE = {
  tableauDeBord(etat) {
    appeler(etat, 'GET', '/admin/dashboard', {
      nom: 'GET /admin/dashboard',
      nature: 'lecture',
      page: true,
    });
    appeler(etat, 'GET', `/api/v1/dashboards/kpi-admin?${periode12Mois()}`, {
      nom: 'GET /api/v1/dashboards/kpi-admin',
      sla: 'tableau_de_bord_admin',
      nature: 'lecture',
    });
  },
  liste(etat) {
    appeler(etat, 'GET', '/admin/collectes', {
      nom: 'GET /admin/collectes',
      nature: 'lecture',
      page: true,
    });
    appeler(etat, 'GET', '/api/v1/admin/collectes?page=1&limit=50', {
      nom: 'GET /api/v1/admin/collectes',
      sla: 'liste',
      nature: 'lecture',
    });
  },
  fiche: ficheEvenement,
  export: exporterCollectes,
};

// Une itération = une session, une action, un temps de réflexion.
export function iteration(etat, poids) {
  assurerSession(etat);
  if (!etat.connecteA) {
    pause(etat);
    return;
  }
  const actions =
    etat.compte.profil === 'equipe' ? ACTIONS_EQUIPE : ACTIONS_TRAITEUR;
  actions[tirer(poids)](etat);
  pause(etat);
}

// Supprime les brouillons du préfixe laissés par un run interrompu. Lancé en
// `teardown`, compte par compte traiteur. Ne touche à rien d'autre : le nom
// doit commencer par le préfixe ET l'événement être un brouillon.
export function nettoyer(cfg, comptes) {
  let supprimes = 0;
  for (const compte of comptes) {
    const etat = nouvelEtat(cfg, compte);
    assurerSession(etat);
    if (!etat.connecteA) continue;
    // La liste rend les 50 brouillons les plus récents : on repasse tant
    // qu'un passage en supprime (20 passages au plus, soit 1 000 brouillons).
    for (let passage = 0; passage < 20; passage++) {
      const avant = supprimes;
      supprimes += nettoyerUnePage(etat);
      if (supprimes === avant) break;
    }
  }
  return supprimes;
}

function nettoyerUnePage(etat) {
  const res = appeler(
    etat,
    'GET',
    '/api/v1/programmation/evenements?statut=brouillon',
    { nom: 'nettoyage : brouillons', nature: 'nettoyage' },
  );
  const json = lireJson(res);
  const lignes = (json && json.data) || [];
  let supprimes = 0;
  for (const e of Array.isArray(lignes) ? lignes : []) {
    if (!e || !e.id) continue;
    if (!String(e.nom_evenement || '').startsWith(PREFIXE_BROUILLON)) continue;
    const d = appeler(
      etat,
      'DELETE',
      `/api/v1/programmation/evenements/${e.id}`,
      { nom: 'nettoyage : suppression', nature: 'nettoyage', attendu: 204 },
    );
    if (d.status === 204) supprimes++;
  }
  return supprimes;
}
