/**
 * Clients Bubble → `organisations`, `entites_facturation`,
 * `organisations_domaines_email` (fiche de mapping 01) et compte système
 * (fiche 02 : aucun compte utilisateur n'est migré).
 */
import type { Ligne } from '../csv';
import { identifiantCible } from '../identifiants';
import {
  codePostalVille,
  domaineEmail,
  horodatageParis,
  lireDateBubble,
  lireEmails,
  lireSiret,
  normaliserNom,
  texteOuNull,
} from '../normalisation';
import { ajouterAuListing, type Contexte, type Plan } from '../plan';
import {
  appliquerDecisions,
  decisionsEnBoucle,
  decisionsSansObjet,
  proposer,
  rangerParDossier,
  ressemblanceNoms,
} from '../rapprochement';

export const EMAIL_COMPTE_SYSTEME = 'migration@gosavr.io';
export const NOM_ORGANISATION_SANS_CLIENT = 'Clients historiques Bubble';
const SEUIL_NOMS_PROCHES = 0.85;

interface Fiche {
  cle: string;
  source: 'entreprise' | 'agence';
  nom: string;
  siret: string | null;
  domaine: string | null;
  creation: string;
  ligne: Ligne;
}

export interface Clients {
  /** Organisation d'une entreprise Bubble, par sa raison sociale. */
  organisationParNom: (nom: string) => string | null;
  /** Organisation d'un utilisateur Bubble, par son email (via son entreprise). */
  organisationParEmail: (email: string) => string | null;
  /** Vrai si la raison sociale est celle d'un client écarté par Val (donnée de test). */
  clientExclu: (nom: string) => boolean;
  /** Organisation d'une agence Bubble, par son identifiant. */
  organisationParAgence: (bubbleId: string) => string | null;
  /** Entité de facturation par défaut d'une organisation, si elle en a une. */
  entiteParOrganisation: Map<string, string>;
  /** Email de contact d'une organisation importée (celui de l'entreprise Bubble), s'il existe. */
  emailContactParOrganisation: Map<string, string>;
  /** Nom d'une organisation importée, par identifiant cible. */
  nomParOrganisation: Map<string, string>;
  /** À appeler quand une collecte n'a pas de client résolu : crée l'organisation d'accueil. */
  organisationSansClient: () => string;
  organisationSavrId: string;
  compteSystemeId: string;
}

function ordreAnciennete(a: Fiche, b: Fiche): number {
  return a.creation === b.creation
    ? a.cle.localeCompare(b.cle)
    : a.creation.localeCompare(b.creation);
}

/** Jugement d'une paire de clients : SIRET, domaine email, nom. */
function jugerClients(
  a: Fiche,
  b: Fiche,
): { niveau: 'auto' | 'a_revoir'; motif: string } | null {
  const memeNom =
    normaliserNom(a.nom) !== '' &&
    normaliserNom(a.nom) === normaliserNom(b.nom);
  if (a.source === 'agence' || b.source === 'agence') {
    // Une agence Bubble n'a qu'un nom : seul le nom exact rapproche.
    if (!memeNom) return null;
    return a.source === b.source
      ? { niveau: 'auto', motif: 'agence du même nom' }
      : { niveau: 'a_revoir', motif: 'agence et entreprise du même nom' };
  }
  const memeSiret = a.siret !== null && a.siret === b.siret;
  const siretsContraires =
    a.siret !== null && b.siret !== null && a.siret !== b.siret;
  const memeDomaine = a.domaine !== null && a.domaine === b.domaine;
  const proches = ressemblanceNoms(a.nom, b.nom) >= SEUIL_NOMS_PROCHES;
  if (memeSiret && (proches || memeDomaine))
    return { niveau: 'auto', motif: 'même SIRET, nom ou domaine email proche' };
  if (memeNom && !siretsContraires)
    return { niveau: 'auto', motif: 'même nom' };
  if (memeSiret)
    return { niveau: 'a_revoir', motif: 'même SIRET, noms différents' };
  if (memeNom)
    return { niveau: 'a_revoir', motif: 'même nom, SIRET différents' };
  if (memeDomaine) return { niveau: 'a_revoir', motif: 'même domaine email' };
  return proches ? { niveau: 'a_revoir', motif: 'noms proches' } : null;
}

const TYPES_VALIDES = new Set([
  'traiteur',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
]);

export function transformerOrganisations(
  entreprises: Ligne[],
  agences: Ligne[],
  utilisateurs: Ligne[],
  /** Noms normalisés des lieux Bubble : un client du même nom est proposé « gestionnaire de lieux ». */
  nomsLieux: Set<string>,
  ctx: Contexte,
  plan: Plan,
): Clients & {
  /** Fixe `actif` une fois les collectes lues (≥ 1 collecte dans les 24 derniers mois). */
  fixerActivite: (derniereCollecte: Map<string, string>, seuil: string) => void;
} {
  const nomsExclus = new Set<string>();
  const fiches: Fiche[] = [
    ...entreprises.map((l) => {
      const email = lireEmails(l['Email de contact'])[0] ?? null;
      const domaine = email ? domaineEmail(email) : null;
      return {
        cle: l['unique id']!.trim(),
        source: 'entreprise' as const,
        nom: (l['Raison sociale'] ?? '').trim(),
        siret: lireSiret(l['SIRET']),
        domaine: domaine && !ctx.domainesExclus.has(domaine) ? domaine : null,
        creation: lireDateBubble(l['Creation Date'])?.jour ?? '9999-12-31',
        ligne: l,
      };
    }),
    ...agences.map((l) => ({
      cle: l['unique id']!.trim(),
      source: 'agence' as const,
      nom: (l['Nom'] ?? '').trim(),
      siret: null,
      domaine: null,
      creation: lireDateBubble(l['Creation Date'])?.jour ?? '9999-12-31',
      ligne: l,
    })),
  ].filter((f) => {
    // Candidats « donnée de test », proposés à Val ; rien n'est écarté sans sa décision.
    const decision = ctx.decisions.exclusions.get(f.cle) ?? '';
    const exclue = decision === 'oui';
    if (
      decision !== '' ||
      /\b(test|tests|demo|savr)\b/.test(normaliserNom(f.nom))
    )
      plan.aValider.exclusions.push({
        source: f.source,
        bubble_id: f.cle,
        nom: f.nom,
        motif_propose: 'nom évoquant un test ou Savr',
        exclure: decision,
      });
    if (exclue) {
      nomsExclus.add(normaliserNom(f.nom));
      plan.rejets.push({
        sourceType: f.source,
        bubbleId: f.cle,
        motif: 'écartée par décision (donnée de test)',
      });
      return false;
    }
    if (f.nom !== '') return true;
    plan.rejets.push({
      sourceType: f.source,
      bubbleId: f.cle,
      motif: 'nom vide',
    });
    return false;
  });

  const propositions = proposer(fiches, ordreAnciennete, jugerClients);
  const groupe = appliquerDecisions(propositions, ctx.decisions.clients);
  const sansObjet = decisionsSansObjet(propositions, ctx.decisions.clients);
  if (sansObjet.length > 0)
    plan.blocages.push(
      `clients-a-valider.csv : ${sansObjet.length} décision(s) désignent une fiche inconnue (colonne groupe_decide) : ${sansObjet.join(', ')}`,
    );
  const boucles = decisionsEnBoucle(propositions, ctx.decisions.clients);
  if (boucles.length > 0)
    plan.blocages.push(
      `clients-a-valider.csv : ${boucles.length} boucle(s) de fiches qui se désignent l'une l'autre (colonne groupe_decide), aucune ne serait regroupée : ${boucles.map((b) => b.join(' → ')).join(' ; ')}`,
    );
  const typesInconnus = [...ctx.decisions.types.values()].filter(
    (t) => !TYPES_VALIDES.has(t.trim()),
  );
  if (typesInconnus.length > 0)
    plan.blocages.push(
      `type_overrides.csv : ${typesInconnus.length} type(s) validé(s) inconnu(s) (attendu : ${[...TYPES_VALIDES].join(', ')})`,
    );
  const parCle = new Map(fiches.map((f) => [f.cle, f]));
  // type_overrides.csv a une ligne par organisation : un type posé sur une fiche
  // regroupée dans une autre, ou sur une fiche inconnue, ne s'appliquerait à rien.
  const typesAReporter = [...ctx.decisions.types]
    .filter(([cle]) => groupe.get(cle) !== cle)
    .filter(([cle]) => ctx.decisions.exclusions.get(cle) !== 'oui')
    .map(([cle, type]) => ({
      cle,
      type,
      ou: groupe.has(cle)
        ? `regroupée dans ${groupe.get(cle)}`
        : 'fiche inconnue',
    }));
  if (typesAReporter.length > 0)
    plan.blocages.push(
      `type_overrides.csv : ${typesAReporter.length} type(s) posé(s) ailleurs que sur la fiche qui reçoit le regroupement, à reporter sur celle-ci : ${typesAReporter.map((t) => `${t.cle} (${t.ou})`).join(', ')}`,
    );
  const membres = new Map<string, Fiche[]>();
  for (const f of fiches) {
    const chef = groupe.get(f.cle)!;
    membres.set(chef, [...(membres.get(chef) ?? []), f]);
  }

  const idOrganisation = (chef: string) =>
    identifiantCible(parCle.get(chef)!.source, chef);
  const organisationParNom = new Map<string, string>();
  const organisationParAgence = new Map<string, string>();
  const entiteParOrganisation = new Map<string, string>();
  const nomParOrganisation = new Map<string, string>();
  const emailContactParOrganisation = new Map<string, string>();
  const siretsPris = new Set<string>();
  const organisationsAgences = new Set<string>();
  const nomsAmbigus = new Set<string>();
  const emailsAmbigus = new Set<string>();
  const propositionParCle = new Map(propositions.map((p) => [p.cle, p]));

  const chefs = [...membres.keys()].sort((a, b) =>
    ordreAnciennete(parCle.get(a)!, parCle.get(b)!),
  );
  for (const chef of chefs) {
    const groupeFiches = membres.get(chef)!.sort(ordreAnciennete);
    const tete = parCle.get(chef)!;
    const id = idOrganisation(chef);
    const premier = (colonne: string) =>
      groupeFiches
        .map((f) => texteOuNull(f.ligne[colonne]))
        .find((v) => v !== null) ?? null;
    const creation = lireDateBubble(tete.ligne['Creation Date']);
    const modification = lireDateBubble(tete.ligne['Modified Date']);
    const created_at = creation ? horodatageParis(creation) : ctx.instantImport;

    // Type d'organisation : tout en « traiteur », sauf type validé par Val (ou proposé, en répétition).
    const regle =
      tete.source === 'agence'
        ? 'agence Bubble'
        : nomsLieux.has(normaliserNom(tete.nom)) &&
            normaliserNom(tete.nom).length >= 4
          ? 'nom identique à un lieu'
          : 'défaut';
    const typePropose =
      regle === 'agence Bubble'
        ? 'agence'
        : regle === 'défaut'
          ? 'traiteur'
          : 'gestionnaire_lieux';
    const typeValide = (ctx.decisions.types.get(chef) ?? '').trim();
    const type = TYPES_VALIDES.has(typeValide)
      ? typeValide
      : ctx.appliquerTypesProposes
        ? typePropose
        : 'traiteur';
    plan.aValider.types.push({
      bubble_id: chef,
      source: tete.source,
      nom: tete.nom,
      type_propose: typePropose,
      regle,
      // Rendu tel que lu, même inconnu (il bloque) : une relance ne l'efface pas.
      type_valide: typeValide,
    });

    const emailPrincipal =
      groupeFiches
        .flatMap((f) => lireEmails(f.ligne['Email de contact']))
        .at(0) ?? null;
    const identifiant = premier('Identifiant');
    plan.tables.organisations.push({
      id,
      nom: tete.nom,
      raison_sociale: tete.source === 'entreprise' ? tete.nom : null,
      type,
      email_principal: emailPrincipal,
      adresse: premier('Adresse du siège'),
      // Logos non repris pendant les répétitions (aucun envoi vers le stockage, Val 2026-10-30).
      logo_url: null,
      notes_internes:
        `Migration Bubble 2026${identifiant ? ` — Identifiant: ${identifiant}` : ''}` +
        (groupeFiches.length > 1
          ? ` — ${groupeFiches.length} fiches Bubble regroupées`
          : ''),
      actif: false,
      est_shadow: false,
      created_at,
      updated_at: modification ? horodatageParis(modification) : created_at,
    });
    nomParOrganisation.set(id, tete.nom);
    if (emailPrincipal) emailContactParOrganisation.set(id, emailPrincipal);
    if (tete.source === 'agence') organisationsAgences.add(id);
    if (premier('logo'))
      ajouterAuListing(plan, 'logos-non-repris', {
        table: 'organisations',
        id,
        nom: tete.nom,
      });

    for (const f of groupeFiches) {
      plan.correspondances.push({
        sourceType: f.source,
        bubbleId: f.cle,
        table: 'organisations',
        cibleId: id,
        fusionne: f.cle !== chef,
      });
      if (f.source === 'agence') organisationParAgence.set(f.cle, id);
      else if (!organisationParNom.has(normaliserNom(f.nom)))
        organisationParNom.set(normaliserNom(f.nom), id);
      else if (organisationParNom.get(normaliserNom(f.nom)) !== id)
        nomsAmbigus.add(normaliserNom(f.nom));
    }

    // Entité de facturation : une par organisation issue d'une entreprise (jamais pour une agence).
    if (tete.source === 'entreprise') {
      const siretTrouve = groupeFiches.map((f) => f.siret).find((s) => s);
      let siret = '';
      if (siretTrouve && !siretsPris.has(siretTrouve)) {
        siret = siretTrouve;
        siretsPris.add(siretTrouve);
      } else
        ajouterAuListing(plan, 'entites-a-completer', {
          organisation_id: id,
          nom: tete.nom,
          motif: siretTrouve
            ? 'SIRET déjà porté par une autre organisation'
            : 'SIRET absent ou illisible',
          siret_bubble: tete.ligne['SIRET'] ?? '',
        });
      const adresse = premier('Adresse du siège');
      const cpVille = codePostalVille(adresse ?? undefined);
      if (siret !== '' && (!adresse || !cpVille))
        ajouterAuListing(plan, 'entites-a-completer', {
          organisation_id: id,
          nom: tete.nom,
          motif: 'adresse, code postal ou ville à compléter',
          siret_bubble: tete.ligne['SIRET'] ?? '',
        });
      const entiteId = identifiantCible('entite', chef);
      plan.tables.entites_facturation.push({
        id: entiteId,
        organisation_id: id,
        raison_sociale: tete.nom,
        siret,
        adresse_facturation: adresse ?? 'À compléter',
        code_postal: cpVille?.codePostal ?? '00000',
        ville: cpVille?.ville ?? 'À compléter',
        pays: 'FR',
        email_facturation: emailPrincipal,
        conditions_paiement_jours: 30,
        entite_par_defaut: true,
        created_at,
        updated_at: created_at,
      });
      entiteParOrganisation.set(id, entiteId);
      plan.correspondances.push({
        sourceType: 'entite',
        bubbleId: chef,
        table: 'entites_facturation',
        cibleId: entiteId,
        fusionne: false,
      });
    }
  }

  // Gardés dans le fichier régénéré, pour qu'une relance ne les efface pas.
  for (const t of typesAReporter)
    plan.aValider.types.push({
      bubble_id: t.cle,
      source: parCle.get(t.cle)?.source ?? '',
      nom: parCle.get(t.cle)?.nom ?? '',
      type_propose: '',
      regle: `${t.ou} : type à reporter`,
      type_valide: t.type,
    });

  for (const f of fiches) {
    const p = propositionParCle.get(f.cle)!;
    plan.aValider.clients.push({
      bubble_id: f.cle,
      source: f.source,
      nom: f.nom,
      siret: f.siret ?? '',
      domaine_email: f.domaine ?? '',
      niveau: p.niveau,
      groupe_propose: p.groupePropose,
      nom_groupe_propose: parCle.get(p.groupePropose)?.nom ?? '',
      motif: p.motif,
      groupe_decide: ctx.decisions.clients.get(f.cle) ?? '',
    });
  }
  plan.aValider.clients = rangerParDossier(plan.aValider.clients, 'bubble_id');

  // Utilisateurs Bubble : jamais importés, lus pour relier un email à son entreprise.
  const organisationParEmail = new Map<string, string>();
  const organisationsParDomaine = new Map<string, Set<string>>();
  const noterDomaine = (email: string, organisationId: string) => {
    const d = domaineEmail(email);
    if (!d || ctx.domainesExclus.has(d)) return;
    organisationsParDomaine.set(
      d,
      (organisationsParDomaine.get(d) ?? new Set()).add(organisationId),
    );
  };
  for (const u of utilisateurs) {
    const email = lireEmails(u['email'])[0];
    const organisationId = organisationParNom.get(
      normaliserNom(u['Entreprise']),
    );
    if (!email || !organisationId) continue;
    if ((organisationParEmail.get(email) ?? organisationId) !== organisationId)
      emailsAmbigus.add(email);
    organisationParEmail.set(email, organisationId);
    noterDomaine(email, organisationId);
  }
  for (const f of fiches.filter((x) => x.source === 'entreprise'))
    for (const email of lireEmails(f.ligne['Email de contact']))
      noterDomaine(email, idOrganisation(groupe.get(f.cle)!));

  for (const [domaine, organisations] of [...organisationsParDomaine].sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (organisations.size > 1) {
      ajouterAuListing(plan, 'domaines-en-conflit', {
        domaine,
        organisations: [...organisations]
          .map((o) => nomParOrganisation.get(o))
          .join(' | '),
      });
      continue;
    }
    const id = identifiantCible('domaine', domaine);
    plan.tables.organisations_domaines_email.push({
      id,
      organisation_id: [...organisations][0],
      domaine,
      // Importé comme vérifié : c'est ce qui rattache un nouvel inscrit à son organisation.
      verifie_at: ctx.instantImport,
    });
    plan.correspondances.push({
      sourceType: 'domaine',
      bubbleId: domaine,
      table: 'organisations_domaines_email',
      cibleId: id,
      fusionne: false,
    });
  }

  // Une référence ambiguë n'est jamais résolue au hasard : elle bloque l'écriture.
  if (nomsAmbigus.size > 0)
    plan.blocages.push(
      `${nomsAmbigus.size} raison(s) sociale(s) portée(s) par plusieurs organisations non regroupées : trancher dans clients-a-valider.csv`,
    );
  if (emailsAmbigus.size > 0)
    plan.blocages.push(
      `${emailsAmbigus.size} email(s) d'utilisateur Bubble rattaché(s) à plusieurs organisations`,
    );

  // Organisation des comptes Savr et compte système, auteur de tout l'historique.
  let organisationSavrId = ctx.organisationSavrId;
  if (!organisationSavrId) {
    organisationSavrId = identifiantCible('organisation', 'savr');
    plan.tables.organisations.push({
      id: organisationSavrId,
      nom: 'Savr',
      raison_sociale: null,
      type: 'agence',
      email_principal: null,
      adresse: null,
      logo_url: null,
      notes_internes:
        'Migration Bubble — organisation des comptes Savr (créée par l’import, absente de la base)',
      actif: true,
      est_shadow: false,
      created_at: ctx.instantImport,
      updated_at: ctx.instantImport,
    });
    plan.correspondances.push({
      sourceType: 'systeme',
      bubbleId: 'organisation-savr',
      table: 'organisations',
      cibleId: organisationSavrId,
      fusionne: false,
    });
  }
  const compteSystemeId = identifiantCible('utilisateur', 'migration');
  plan.tables.users.push({
    id: compteSystemeId,
    organisation_id: organisationSavrId,
    email: EMAIL_COMPTE_SYSTEME,
    prenom: 'Migration',
    nom: 'Bubble',
    role: 'admin_savr',
    // Ligne seule, sans compte de connexion : personne ne peut s'y connecter.
    actif: false,
    created_at: ctx.instantImport,
  });
  plan.correspondances.push({
    sourceType: 'systeme',
    bubbleId: 'compte-migration',
    table: 'users',
    cibleId: compteSystemeId,
    fusionne: false,
  });

  let sansClientId: string | null = null;
  const organisationSansClient = () => {
    if (sansClientId) return sansClientId;
    sansClientId = identifiantCible('organisation', 'clients-historiques');
    plan.tables.organisations.push({
      id: sansClientId,
      nom: NOM_ORGANISATION_SANS_CLIENT,
      raison_sociale: null,
      type: 'traiteur',
      email_principal: null,
      adresse: null,
      logo_url: null,
      notes_internes:
        'Migration Bubble — accueille les collectes dont le client n’a pas été retrouvé',
      actif: false,
      est_shadow: false,
      created_at: ctx.instantImport,
      updated_at: ctx.instantImport,
    });
    const entiteId = identifiantCible('entite', 'clients-historiques');
    plan.tables.entites_facturation.push({
      id: entiteId,
      organisation_id: sansClientId,
      raison_sociale: NOM_ORGANISATION_SANS_CLIENT,
      siret: '',
      adresse_facturation: 'À compléter',
      code_postal: '00000',
      ville: 'À compléter',
      pays: 'FR',
      email_facturation: null,
      conditions_paiement_jours: 30,
      entite_par_defaut: true,
      created_at: ctx.instantImport,
      updated_at: ctx.instantImport,
    });
    entiteParOrganisation.set(sansClientId, entiteId);
    nomParOrganisation.set(sansClientId, NOM_ORGANISATION_SANS_CLIENT);
    plan.correspondances.push(
      {
        sourceType: 'systeme',
        bubbleId: 'organisation-sans-client',
        table: 'organisations',
        cibleId: sansClientId,
        fusionne: false,
      },
      {
        sourceType: 'systeme',
        bubbleId: 'entite-sans-client',
        table: 'entites_facturation',
        cibleId: entiteId,
        fusionne: false,
      },
    );
    return sansClientId;
  };

  return {
    organisationParNom: (nom) =>
      organisationParNom.get(normaliserNom(nom)) ?? null,
    clientExclu: (nom) => nomsExclus.has(normaliserNom(nom)),
    organisationParEmail: (email) =>
      organisationParEmail.get(email.toLowerCase().trim()) ?? null,
    organisationParAgence: (bubbleId) =>
      organisationParAgence.get(bubbleId.trim()) ?? null,
    entiteParOrganisation,
    nomParOrganisation,
    emailContactParOrganisation,
    organisationSansClient,
    organisationSavrId,
    compteSystemeId,
    fixerActivite: (derniereCollecte, seuil) => {
      for (const ligne of plan.tables.organisations) {
        const id = ligne.id as string;
        // Savr et l'organisation d'accueil gardent leur valeur ; une agence
        // Bubble reste inactive (fiche 01 §2, option a).
        if (id === organisationSavrId || id === sansClientId) continue;
        ligne.actif =
          !organisationsAgences.has(id) &&
          (derniereCollecte.get(id) ?? '') >= seuil;
      }
    },
  };
}
