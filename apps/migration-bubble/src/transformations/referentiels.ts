/**
 * Référentiels Bubble → `associations` (fiche 05), `transporteurs` (fiche 06)
 * et `contacts_traiteurs` (fiche 04).
 */
import type { Ligne } from '../csv';
import { identifiantCible } from '../identifiants';
import {
  codePostalVille,
  decalerAnnees,
  horodatageParis,
  lireDateBubble,
  lireEmails,
  lireEntier,
  lireSiren,
  normaliserNom,
  regionDuCodePostal,
  retirerPrefixeZone,
  telephoneE164,
  texteOuNull,
} from '../normalisation';
import { ajouterAuListing, type Contexte, type Plan } from '../plan';
import { TYPE_TMS_CAMION, typeTmsDepuisBubble } from '../referentiel-tms';

export const EMAIL_A_COMPLETER = 'a-completer@gosavr.io';
export const SIREN_A_COMPLETER = '000000000';

const JOURS = [
  ['Lundi', 'lundi'],
  ['Mardi', 'mardi'],
  ['Mercredi', 'mercredi'],
  ['Jeudi', 'jeudi'],
  ['Vendredi', 'vendredi'],
  ['Samedi', 'samedi'],
  ['Dimanche', 'dimanche'],
] as const;

/** « [480,1260] » (minutes depuis minuit) → ['08:00', '21:00'] ; fermé ou illisible → null. */
export function plageHoraire(
  texte: string | undefined,
): [string, string] | null {
  const m = /^\[\s*(\d+)\s*,\s*(\d+)\s*\]$/.exec((texte ?? '').trim());
  if (!m) return null;
  const debut = Number(m[1]);
  const fin = Number(m[2]);
  if (fin <= debut || fin > 1440) return null;
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return [hhmm(debut), hhmm(fin)];
}

/** Activité d'un référentiel : dernière collecte par identifiant Bubble, et types de collecte vus. */
export interface UsageReferentiel {
  derniereCollecte: Map<string, string>;
  typesCollecte: Map<string, Set<'anti_gaspi' | 'zero_dechet'>>;
}

export function transformerAssociations(
  pointsDepot: Ligne[],
  /** Dernière collecte anti-gaspi par NOM Bubble complet du point de dépôt. */
  derniereCollecteParNom: Map<string, string>,
  ctx: Contexte,
  plan: Plan,
): Map<string, string> {
  // Association par nom Bubble complet (avec préfixe de zone), tel que les collectes le citent.
  const associationParNom = new Map<string, string>();
  const doublons = new Set<string>();
  const seuil = decalerAnnees(ctx.jourReference, -1);
  for (const l of pointsDepot) {
    const bubbleId = l['unique id']!.trim();
    const nomBubble = (l['Nom'] ?? '').trim();
    if ((l['Type'] ?? '').trim() !== 'NOURRITURE') {
      // Exutoire de déchets ou type vide : pas une association (fiche 05, cas particuliers).
      plan.rejets.push({
        sourceType: 'point_depot',
        bubbleId,
        motif: `type « ${(l['Type'] ?? '').trim() || 'vide'} » : pas une association`,
      });
      continue;
    }
    const { zone, nom: nomSansZone } = retirerPrefixeZone(nomBubble);
    const nom = nomSansZone || texteOuNull(l['Print_name']);
    if (!nom) {
      plan.rejets.push({
        sourceType: 'point_depot',
        bubbleId,
        motif: 'nom vide',
      });
      continue;
    }
    const id = identifiantCible('association', bubbleId);
    const adresse = texteOuNull(l['Adresse']);
    const cpVille = codePostalVille(adresse ?? undefined);
    const region =
      zone === 'PARIS' || zone === 'IDF'
        ? 'idf'
        : regionDuCodePostal(cpVille?.codePostal ?? null);
    const emails = lireEmails(l['mailing_list']);
    const telephones = (l['Numero contact'] ?? '')
      .split('/')
      .map((t) => t.trim())
      .filter(Boolean);
    const horaires: Record<string, [string, string]> = {};
    for (const [colonne, jour] of JOURS) {
      const plage = plageHoraire(l[colonne]);
      if (plage) horaires[jour] = plage;
    }
    const description = (l['description_pour_rapport_impact'] ?? '').trim();
    const manques = [
      adresse ? null : 'adresse',
      cpVille ? null : 'ville',
      region ? null : 'région',
      emails[0] ? null : 'email de contact',
      'position (lieux seuls situés par le service d’adresses)',
    ].filter((m) => m !== null);
    ajouterAuListing(plan, 'associations-a-completer', {
      association_id: id,
      nom,
      manque: manques.join(', '),
    });
    const nbBeneficiaires = lireEntier(l['Nb_bénéficiaires']);
    const derniere = derniereCollecteParNom.get(nomBubble) ?? '';
    const creation = lireDateBubble(l['Creation Date']);
    const modification = lireDateBubble(l['Modified Date']);
    const created_at = creation ? horodatageParis(creation) : ctx.instantImport;
    plan.tables.associations.push({
      id,
      nom,
      adresse: adresse ?? 'À compléter',
      latitude: null,
      longitude: null,
      region: region ?? 'idf',
      ville: cpVille?.ville ?? 'À compléter',
      capacite_max_beneficiaires:
        nbBeneficiaires && nbBeneficiaires > 0 ? nbBeneficiaires : null,
      horaires_ouverture: Object.keys(horaires).length > 0 ? horaires : null,
      contact_nom: texteOuNull(l['Nom prenom contact']),
      contact_email: emails[0] ?? EMAIL_A_COMPLETER,
      contact_telephone: telephoneE164(l['Numero contact']),
      // Fiscalité : jamais présumée. Val coche les associations habilitées avant le go-live.
      habilitee_attestation_fiscale: false,
      siren: lireSiren(l['SIREN']),
      // Logos non repris pendant les répétitions (aucun envoi vers le stockage).
      logo_url: null,
      commentaires_internes:
        [
          texteOuNull(l['internal_usage_comment']),
          zone ? `Zone Bubble : ${zone}` : null,
          emails.length > 1
            ? `Autres emails : ${emails.slice(1).join(', ')}`
            : null,
          telephones.length > 1
            ? `Autres téléphones : ${telephones.slice(1).join(' / ')}`
            : null,
        ]
          .filter((c) => c !== null)
          .join('\n') || null,
      description_rapport_impact:
        description.length >= 30
          ? description
          : `Description à compléter — association ${nom}.`,
      id_point_collecte_mts1: texteOuNull(l['MTS_1_delivery_place_id']),
      actif: derniere !== '' && derniere >= seuil,
      created_at,
      updated_at: modification ? horodatageParis(modification) : created_at,
    });
    if (texteOuNull(l['Logo']))
      ajouterAuListing(plan, 'logos-non-repris', {
        table: 'associations',
        id,
        nom,
      });
    if (nomBubble && !associationParNom.has(nomBubble))
      associationParNom.set(nomBubble, id);
    else if (nomBubble) doublons.add(nomBubble);
    plan.correspondances.push({
      sourceType: 'point_depot',
      bubbleId,
      table: 'associations',
      cibleId: id,
      fusionne: false,
    });
  }
  // Les collectes citent leur association par son nom : deux associations du même nom bloquent.
  if (doublons.size > 0)
    plan.blocages.push(
      `${doublons.size} nom(s) de point de dépôt porté(s) par plusieurs associations`,
    );
  return associationParNom;
}

/** « Vélo cargo », « Camion frigorifique »… → valeurs de l'enum des véhicules ; rien de lisible → null. */
export function typesVehicules(texte: string | undefined): string[] | null {
  const t = normaliserNom(texte);
  const trouves = new Set<string>();
  if (/\b(velo|cargo)\b/.test(t)) trouves.add('velo_cargo');
  if (/\bcamionnette\b/.test(t)) trouves.add('camionnette');
  if (/\bfourgon\b/.test(t)) trouves.add('fourgon');
  if (/\b(poids lourd|pl|19t|26t)\b/.test(t)) trouves.add('poids_lourd');
  if (/\b(camion|frigo|frigorifique)\b/.test(t) && !trouves.has('camionnette'))
    trouves.add('vul');
  return trouves.size > 0 ? [...trouves].sort() : null;
}

export function transformerTransporteurs(
  transporteurs: Ligne[],
  usage: UsageReferentiel,
  ctx: Contexte,
  plan: Plan,
): Map<string, { id: string; nom: string }> {
  const transporteurParBubbleId = new Map<
    string,
    { id: string; nom: string }
  >();
  const seuil = decalerAnnees(ctx.jourReference, -1);
  for (const l of transporteurs) {
    const bubbleId = l['unique id']!.trim();
    const { zone, nom } = retirerPrefixeZone(l['Nom']);
    if (nom === '') {
      plan.rejets.push({
        sourceType: 'transporteur',
        bubbleId,
        motif: 'nom vide',
      });
      continue;
    }
    const id = identifiantCible('transporteur', bubbleId);
    const adresse = texteOuNull(l['Adresse']);
    const cpVille = codePostalVille(adresse ?? undefined);
    const vehicules = typesVehicules(l['Véhicules utilisés']);
    const tms = typeTmsDepuisBubble(l['TmsType'] ?? '', nom);
    const email = lireEmails(l['Mail de contact'])[0] ?? null;
    const telephone = telephoneE164(l['Numéro de contact']);
    const contactNom = texteOuNull(l['Nom de contact']);
    const types = [...(usage.typesCollecte.get(bubbleId) ?? [])].sort();
    const derniere = usage.derniereCollecte.get(bubbleId) ?? '';
    ajouterAuListing(plan, 'transporteurs-a-completer', {
      transporteur_id: id,
      nom,
      manque: [
        'SIREN',
        adresse ? null : 'adresse',
        cpVille ? null : 'code postal et ville',
        'position',
        vehicules ? null : 'véhicules (défaut posé)',
        tms.deduit ? `logiciel de transport (déduit : ${tms.type})` : null,
        tms.type === TYPE_TMS_CAMION ? 'code transporteur du logiciel' : null,
        contactNom ? null : 'nom du contact',
        email ? null : 'email du contact',
        telephone ? null : 'téléphone du contact',
        types.length > 0 ? null : 'types de collecte (aucune collecte Bubble)',
      ]
        .filter((m) => m !== null)
        .join(', '),
    });
    const creation = lireDateBubble(l['Creation Date']);
    plan.tables.transporteurs.push({
      id,
      nom,
      siren: SIREN_A_COMPLETER,
      adresse: adresse ?? 'À compléter',
      code_postal: cpVille?.codePostal ?? '00000',
      ville: cpVille?.ville ?? 'À compléter',
      latitude: null,
      longitude: null,
      types_vehicules: vehicules ?? ['vul'],
      type_tms: tms.type,
      contact_nom: contactNom ?? 'À compléter',
      contact_email: email ?? EMAIL_A_COMPLETER,
      contact_telephone: telephone ?? '-',
      actif: derniere !== '' && derniere >= seuil,
      commentaires_internes:
        [
          texteOuNull(l['internal_usage_comment']),
          zone ? `Zone Bubble : ${zone}` : null,
        ]
          .filter((c) => c !== null)
          .join('\n') || null,
      description_process_collecte: texteOuNull(l['process']),
      types_collecte: types.length > 0 ? types : null,
      created_at: creation ? horodatageParis(creation) : ctx.instantImport,
    });
    transporteurParBubbleId.set(bubbleId, { id, nom });
    plan.correspondances.push({
      sourceType: 'transporteur',
      bubbleId,
      table: 'transporteurs',
      cibleId: id,
      fusionne: false,
    });
  }
  return transporteurParBubbleId;
}

export function transformerContacts(
  contacts: Ligne[],
  organisationParNom: (nom: string) => string | null,
  organisationParEmail: (email: string) => string | null,
  ctx: Contexte,
  plan: Plan,
): void {
  interface Groupe {
    organisationId: string;
    telephone: string;
    nomComplet: string;
    bubbleIds: string[];
    premiere: string;
    derniere: string;
    premiereDate: ReturnType<typeof lireDateBubble>;
    derniereDate: ReturnType<typeof lireDateBubble>;
  }
  const parTelephone = new Map<string, Groupe>();
  for (const l of contacts) {
    const bubbleId = l['unique id']!.trim();
    const rejeter = (motif: string) =>
      plan.rejets.push({ sourceType: 'contact', bubbleId, motif });
    const organisationId =
      organisationParNom(l['Entreprise liée'] ?? '') ??
      organisationParEmail(lireEmails(l['linked_user'])[0] ?? '');
    if (!organisationId) {
      rejeter('entreprise non retrouvée');
      continue;
    }
    const telephone = telephoneE164(l['Numero']);
    if (!telephone) {
      rejeter('téléphone illisible');
      continue;
    }
    const nomComplet = (l['PrenomNom'] ?? '').replace(/\s+/g, ' ').trim();
    const date = lireDateBubble(l['Creation Date']);
    const instant = date ? `${date.jour} ${date.heure}` : '';
    const cle = `${organisationId}:${telephone}`;
    const g = parTelephone.get(cle);
    if (!g) {
      parTelephone.set(cle, {
        organisationId,
        telephone,
        nomComplet,
        bubbleIds: [bubbleId],
        premiere: instant,
        derniere: instant,
        premiereDate: date,
        derniereDate: date,
      });
      continue;
    }
    g.bubbleIds.push(bubbleId);
    if (instant !== '' && (g.premiere === '' || instant < g.premiere)) {
      g.premiere = instant;
      g.premiereDate = date;
    }
    if (instant > g.derniere) {
      g.derniere = instant;
      g.derniereDate = date;
      if (nomComplet !== '') g.nomComplet = nomComplet;
    }
  }

  // Puis même personne (même nom) dans la même organisation : une ligne, le numéro le plus récent.
  const parNom = new Map<string, Groupe>();
  for (const g of parTelephone.values()) {
    const cleNom = normaliserNom(g.nomComplet);
    const cle = `${g.organisationId}:${cleNom === '' ? g.telephone : cleNom}`;
    const vu = parNom.get(cle);
    if (!vu) {
      parNom.set(cle, g);
      continue;
    }
    const [garde, absorbe] = g.derniere > vu.derniere ? [g, vu] : [vu, g];
    garde.bubbleIds.push(...absorbe.bubbleIds);
    if (
      absorbe.premiere !== '' &&
      (garde.premiere === '' || absorbe.premiere < garde.premiere)
    ) {
      garde.premiere = absorbe.premiere;
      garde.premiereDate = absorbe.premiereDate;
    }
    parNom.set(cle, garde);
  }

  // Durée de conservation : un contact sans usage depuis plus de 5 ans n'est pas repris (Val 2026-11-06).
  const seuil = decalerAnnees(ctx.jourReference, -5);
  for (const g of parNom.values()) {
    if (g.derniere !== '' && g.derniere.slice(0, 10) < seuil) {
      for (const bubbleId of g.bubbleIds)
        plan.rejets.push({
          sourceType: 'contact',
          bubbleId,
          motif: 'dernier usage de plus de 5 ans',
        });
      continue;
    }
    const mots = g.nomComplet.split(' ').filter(Boolean);
    const id = identifiantCible(
      'contact',
      `${g.organisationId}:${g.telephone}`,
    );
    plan.tables.contacts_traiteurs.push({
      id,
      organisation_id: g.organisationId,
      prenom: mots.length > 1 ? mots.slice(0, -1).join(' ') : '—',
      nom: mots.at(-1) ?? '—',
      telephone: g.telephone,
      utilise_nb_fois: g.bubbleIds.length,
      derniere_utilisation: g.derniereDate
        ? horodatageParis(g.derniereDate)
        : null,
      actif: true,
      created_at: g.premiereDate
        ? horodatageParis(g.premiereDate)
        : ctx.instantImport,
    });
    g.bubbleIds.forEach((bubbleId, rang) =>
      plan.correspondances.push({
        sourceType: 'contact',
        bubbleId,
        table: 'contacts_traiteurs',
        cibleId: id,
        fusionne: rang > 0,
      }),
    );
  }
}
