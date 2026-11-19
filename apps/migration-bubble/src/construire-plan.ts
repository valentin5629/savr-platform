/**
 * Assemble le plan d'import : enchaîne les transformations dans l'ordre des
 * dépendances (03 - Ordre d'execution), sans toucher la base.
 */
import { decalerAnnees, normaliserNom } from './normalisation';
import { planVide, type Contexte, type Plan } from './plan';
import type { Sources } from './sources';
import {
  lireCollectes,
  passagesSurLieux,
  transformerCollectes,
  usageDesReferentiels,
} from './transformations/collectes';
import { transformerLieux } from './transformations/lieux';
import { transformerOrganisations } from './transformations/organisations';
import { transformerPacks } from './transformations/packs';
import {
  transformerAssociations,
  transformerContacts,
  transformerTransporteurs,
} from './transformations/referentiels';

export function construirePlan(sources: Sources, ctx: Contexte): Plan {
  const plan = planVide();
  plan.blocagesDecisions.push(...ctx.blocagesDecisions);
  const fichesConnues = new Set(
    [
      ...sources.entreprises.lignes,
      ...sources.agences.lignes,
      ...sources.collectes_ag.lignes,
      ...sources.collectes_zd.lignes,
    ].map((l) => (l['unique id'] ?? '').trim()),
  );
  const exclusionsSansObjet = [...ctx.decisions.exclusions.keys()].filter(
    (cle) => !fichesConnues.has(cle),
  );
  if (exclusionsSansObjet.length > 0)
    plan.blocagesDecisions.push(
      `exclusions.csv : ${exclusionsSansObjet.length} décision(s) désignent une fiche inconnue (colonne bubble_id) : ${exclusionsSansObjet.join(', ')}`,
    );
  const nomsLieux = new Set(
    sources.lieux.lignes.map((l) => normaliserNom(l['Nom du lieu'])),
  );
  const clients = transformerOrganisations(
    sources.entreprises.lignes,
    sources.agences.lignes,
    sources.utilisateurs.lignes,
    nomsLieux,
    ctx,
    plan,
  );
  const lues = lireCollectes(
    [...sources.collectes_ag.lignes, ...sources.collectes_zd.lignes],
    clients,
    ctx,
    plan,
  );

  // Une organisation est active si elle a une collecte dans les 24 derniers mois.
  const seuil24Mois = decalerAnnees(ctx.jourReference, -2);
  const derniereCollecte = new Map<string, string>();
  for (const c of lues)
    for (const id of [c.traiteurId, c.organisationId])
      if (c.date.jour > (derniereCollecte.get(id) ?? ''))
        derniereCollecte.set(id, c.date.jour);
  clients.fixerActivite(derniereCollecte, seuil24Mois);

  const lieuParAdresse = transformerLieux(
    sources.lieux.lignes,
    passagesSurLieux(lues),
    clients.organisationParNom,
    seuil24Mois,
    ctx,
    plan,
  );
  const usage = usageDesReferentiels(lues);
  const associationParNom = transformerAssociations(
    sources.points_depot.lignes,
    usage.derniereCollecteParPointDepot,
    ctx,
    plan,
  );
  const transporteurParBubbleId = transformerTransporteurs(
    sources.transporteurs.lignes,
    usage.transporteurs,
    ctx,
    plan,
  );
  transformerContacts(
    sources.contacts.lignes,
    clients.organisationParNom,
    clients.organisationParEmail,
    ctx,
    plan,
  );
  const packParCollecte = transformerPacks(
    sources.packs.lignes,
    sources.abonnements.lignes,
    lues,
    clients.organisationParEmail,
    ctx,
    plan,
  );
  transformerCollectes(
    lues,
    {
      clients,
      lieuParAdresse,
      associationParNom,
      transporteurParBubbleId,
      poidsParBubbleId: new Map(
        sources.poids_zd.lignes.map((l) => [l['unique id']!.trim(), l]),
      ),
      packParCollecte,
    },
    ctx,
    plan,
  );
  return plan;
}
