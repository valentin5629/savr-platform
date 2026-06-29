import {
  toCsv,
  formatDateFr,
  formatPoidsKg,
  formatNombreFr,
  type CsvColumn,
} from '@savr/shared/src/csv/index.js';
import {
  type ExportContext,
  type ExportOutput,
  TYPE_COLLECTE_LIBELLE,
  STATUT_COLLECTE_LIBELLE,
  STATUT_FACTURE_LIBELLE,
  TYPE_FACTURE_LIBELLE,
  STATUT_PACK_LIBELLE,
  libelle,
  heureCourte,
  resolveTraiteurNoms,
  resolveRepas,
  sommePoidsFlux,
  unwrap,
} from './shared.js';

type Row = Record<string, unknown>;

// ===========================================================================
// COLLECTES (grain collecte) — admin/ops, traiteur (mgr+com), agence, client orga.
// Colonnes spec-fixées : date_evenement ET date_collecte + poids virgule (§12 §2).
// ===========================================================================
export async function buildCollectesExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const type = sp.get('type');
  const statut = sp.get('statut');
  const from = sp.get('from');
  const to = sp.get('to');

  let q = ctx.supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, heure_collecte, taux_recyclage, co2_evite_kg,
       collecte_flux(poids_reel_kg),
       evenements!inner(nom_evenement, date_evenement, nom_client_organisateur,
         traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom, code_postal, ville))`,
    )
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') q = q.eq('type', type);
  if (statut) q = q.in('statut', statut.split(','));
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const traiteurNoms = await resolveTraiteurNoms(
    ctx.supabase,
    rows.map(
      (r) =>
        (unwrap(r.evenements)
          .traiteur_operationnel_organisation_id as string) ?? '',
    ),
  );
  const repas = await resolveRepas(
    ctx.supabase,
    rows.filter((r) => r.type === 'anti_gaspi').map((r) => r.id as string),
    ctx.isStaff,
  );

  const evt = (r: Row) => unwrap(r.evenements);
  const lieuOf = (r: Row) => unwrap(evt(r).lieux);

  const columns: CsvColumn<Row>[] = [
    {
      header: 'Date événement',
      value: (r) => formatDateFr(evt(r).date_evenement as string),
    },
    {
      header: 'Date collecte',
      value: (r) => formatDateFr(r.date_collecte as string),
    },
    { header: 'Heure', value: (r) => heureCourte(r.heure_collecte) },
    { header: 'Événement', value: (r) => evt(r).nom_evenement as string },
    { header: 'Lieu', value: (r) => lieuOf(r).nom as string },
    { header: 'Code postal', value: (r) => lieuOf(r).code_postal as string },
    { header: 'Ville', value: (r) => lieuOf(r).ville as string },
    {
      header: 'Traiteur',
      value: (r) =>
        traiteurNoms.get(
          evt(r).traiteur_operationnel_organisation_id as string,
        ) ?? '',
    },
    {
      header: 'Client organisateur',
      value: (r) => evt(r).nom_client_organisateur as string,
    },
    { header: 'Type', value: (r) => libelle(TYPE_COLLECTE_LIBELLE, r.type) },
    {
      header: 'Statut',
      value: (r) => libelle(STATUT_COLLECTE_LIBELLE, r.statut),
    },
    {
      header: 'Tonnage ZD (kg)',
      value: (r) =>
        r.type === 'zero_dechet'
          ? formatPoidsKg(
              sommePoidsFlux(
                r.collecte_flux as { poids_reel_kg?: number | null }[],
              ),
            )
          : '',
    },
    {
      header: 'Taux recyclage (%)',
      value: (r) => formatNombreFr(r.taux_recyclage as number),
    },
    {
      header: 'CO2 évité (kg)',
      value: (r) => formatPoidsKg(r.co2_evite_kg as number),
    },
    {
      header: 'Repas AG',
      value: (r) =>
        r.type === 'anti_gaspi' ? (repas.get(r.id as string) ?? '') : '',
    },
  ];

  return { filenamePrefix: 'collectes', csv: toCsv(rows, columns) };
}

// ===========================================================================
// PESÉES PAR FLUX (grain collecte × flux, ZD only) — admin/ops, mgr, agence, client.
// ===========================================================================
export async function buildPeseesExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const from = sp.get('from');
  const to = sp.get('to');

  let q = ctx.supabase
    .from('collecte_flux')
    .select(
      `poids_reel_kg, nb_bacs, equivalent_roll,
       flux_dechets!flux_id(nom, ordre_affichage),
       collectes!inner(id, type, date_collecte,
         evenements!inner(nom_evenement, date_evenement,
           traiteur_operationnel_organisation_id,
           lieux!lieu_id(nom, code_postal, ville)))`,
    )
    .eq('collectes.type', 'zero_dechet');

  if (from) q = q.gte('collectes.date_collecte', from);
  if (to) q = q.lte('collectes.date_collecte', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const col = (r: Row) => unwrap(r.collectes);
  const evt = (r: Row) => unwrap(col(r).evenements);
  const lieuOf = (r: Row) => unwrap(evt(r).lieux);

  // Tri : date collecte décroissante, puis ordre d'affichage du flux.
  rows.sort((a, b) => {
    const da = String(col(a).date_collecte ?? '');
    const db = String(col(b).date_collecte ?? '');
    if (da !== db) return db.localeCompare(da);
    return (
      Number(unwrap(a.flux_dechets).ordre_affichage ?? 0) -
      Number(unwrap(b.flux_dechets).ordre_affichage ?? 0)
    );
  });

  const traiteurNoms = await resolveTraiteurNoms(
    ctx.supabase,
    rows.map(
      (r) => (evt(r).traiteur_operationnel_organisation_id as string) ?? '',
    ),
  );

  const columns: CsvColumn<Row>[] = [
    {
      header: 'Date événement',
      value: (r) => formatDateFr(evt(r).date_evenement as string),
    },
    {
      header: 'Date collecte',
      value: (r) => formatDateFr(col(r).date_collecte as string),
    },
    { header: 'Événement', value: (r) => evt(r).nom_evenement as string },
    { header: 'Lieu', value: (r) => lieuOf(r).nom as string },
    { header: 'Code postal', value: (r) => lieuOf(r).code_postal as string },
    { header: 'Ville', value: (r) => lieuOf(r).ville as string },
    {
      header: 'Traiteur',
      value: (r) =>
        traiteurNoms.get(
          evt(r).traiteur_operationnel_organisation_id as string,
        ) ?? '',
    },
    { header: 'Flux', value: (r) => unwrap(r.flux_dechets).nom as string },
    {
      header: 'Poids (kg)',
      value: (r) => formatPoidsKg(r.poids_reel_kg as number),
    },
    { header: 'Nb bacs', value: (r) => (r.nb_bacs as number) ?? '' },
    {
      header: 'Équivalent rolls',
      value: (r) => formatNombreFr(r.equivalent_roll as number),
    },
  ];

  return { filenamePrefix: 'pesees', csv: toCsv(rows, columns) };
}

// ===========================================================================
// FACTURATION — admin/ops, traiteur (mgr+com), agence, gestionnaire.
// Whitelist client-safe (JAMAIS marge_logistique / colonnes synchro F5).
// Brouillons : visibles au staff, exclus pour les clients.
// ===========================================================================
export async function buildFacturesExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const statut = sp.get('statut');
  const type = sp.get('type');
  const from = sp.get('from');
  const to = sp.get('to');

  let q = ctx.supabase
    .from('factures')
    .select(
      `numero_facture, type, statut, montant_ht, montant_ttc,
       date_emission, date_echeance, date_paiement`,
    )
    .order('date_emission', { ascending: false, nullsFirst: false });

  if (!ctx.isStaff) q = q.neq('statut', 'brouillon');
  if (statut) q = q.eq('statut', statut);
  if (type) q = q.eq('type', type);
  if (from) q = q.gte('date_emission', from);
  if (to) q = q.lte('date_emission', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const columns: CsvColumn<Row>[] = [
    { header: 'Numéro', value: (r) => r.numero_facture as string },
    { header: 'Type', value: (r) => libelle(TYPE_FACTURE_LIBELLE, r.type) },
    {
      header: 'Statut',
      value: (r) => libelle(STATUT_FACTURE_LIBELLE, r.statut),
    },
    {
      header: 'Montant HT (€)',
      value: (r) => formatNombreFr(r.montant_ht as number),
    },
    {
      header: 'Montant TTC (€)',
      value: (r) => formatNombreFr(r.montant_ttc as number),
    },
    {
      header: 'Date émission',
      value: (r) => formatDateFr(r.date_emission as string),
    },
    {
      header: 'Date échéance',
      value: (r) => formatDateFr(r.date_echeance as string),
    },
    {
      header: 'Date paiement',
      value: (r) => formatDateFr(r.date_paiement as string),
    },
  ];

  return { filenamePrefix: 'factures', csv: toCsv(rows, columns) };
}

// ===========================================================================
// PACKS AG (mouvements) — admin/ops, traiteur_manager, agence, gestionnaire.
// ===========================================================================
export async function buildPacksAgExport(
  ctx: ExportContext,
  _sp: URLSearchParams,
): Promise<ExportOutput> {
  void _sp;
  // Colonnes réelles packs_antgaspi (convergées M2.1 / §04) : pas de reference /
  // date_debut / date_fin / prix_ht / devise — mappées sur type_pack /
  // date_achat / date_expiration. Export « mouvements » = crédits + dates, SANS
  // financier : cet export est accessible à gestionnaire_lieux (EXPORT_MATRIX) où
  // tout élément financier est masqué (§06.05). Le montant pré-existait en
  // colonne phantom (toujours null) → aucune régression pour les autres rôles.
  const { data, error } = await ctx.supabase
    .from('packs_antgaspi')
    .select(
      `type_pack, credits_initiaux, credits_consommes, credits_restants,
       date_achat, date_expiration, statut`,
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const columns: CsvColumn<Row>[] = [
    { header: 'Type de pack', value: (r) => r.type_pack as string },
    {
      header: 'Crédits initiaux',
      value: (r) => (r.credits_initiaux as number) ?? '',
    },
    {
      header: 'Crédits consommés',
      value: (r) => (r.credits_consommes as number) ?? '',
    },
    {
      header: 'Crédits restants',
      value: (r) => (r.credits_restants as number) ?? '',
    },
    {
      header: "Date d'achat",
      value: (r) => formatDateFr(r.date_achat as string),
    },
    {
      header: "Date d'expiration",
      value: (r) => formatDateFr(r.date_expiration as string),
    },
    { header: 'Statut', value: (r) => libelle(STATUT_PACK_LIBELLE, r.statut) },
  ];

  return { filenamePrefix: 'packs-ag', csv: toCsv(rows, columns) };
}

// ===========================================================================
// ASSOCIATIONS BÉNÉFICIAIRES AG — admin/ops, traiteur_manager.
//  - staff : référentiel complet des associations.
//  - traiteur_manager : associations bénéficiaires de SES dons AG (via attributions),
//    avec nb de collectes et repas donnés agrégés.
// ===========================================================================
export async function buildAssociationsAgExport(
  ctx: ExportContext,
  _sp: URLSearchParams,
): Promise<ExportOutput> {
  void _sp;

  if (ctx.isStaff) {
    const { data, error } = await ctx.supabase
      .from('associations')
      .select(
        `nom, adresse, ville, region, contact_nom, contact_email,
         habilitee_attestation_fiscale, actif`,
      )
      .order('nom');
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    const columns: CsvColumn<Row>[] = [
      { header: 'Association', value: (r) => r.nom as string },
      { header: 'Adresse', value: (r) => r.adresse as string },
      { header: 'Ville', value: (r) => r.ville as string },
      { header: 'Région', value: (r) => r.region as string },
      { header: 'Contact', value: (r) => r.contact_nom as string },
      { header: 'Email', value: (r) => r.contact_email as string },
      {
        header: 'Habilitée fiscale',
        value: (r) => (r.habilitee_attestation_fiscale ? 'Oui' : 'Non'),
      },
      { header: 'Active', value: (r) => (r.actif ? 'Oui' : 'Non') },
    ];
    return { filenamePrefix: 'associations', csv: toCsv(rows, columns) };
  }

  // traiteur_manager : bénéficiaires via ses collectes AG (RLS-scopées).
  const { data, error } = await ctx.supabase
    .from('collectes')
    .select(
      `id, type,
       attributions_antgaspi(association_id, volume_repas_realise,
         associations!association_id(nom, ville, region))`,
    )
    .eq('type', 'anti_gaspi');
  if (error) throw new Error(error.message);

  interface Agg {
    nom: string;
    ville: string;
    region: string;
    nb_collectes: number;
    repas: number;
  }
  const byAsso = new Map<string, Agg>();
  for (const c of (data ?? []) as Row[]) {
    const attrs = (
      Array.isArray(c.attributions_antgaspi) ? c.attributions_antgaspi : []
    ) as Row[];
    for (const a of attrs) {
      const assoId = a.association_id as string | null;
      if (!assoId) continue;
      const asso = unwrap(a.associations);
      const cur = byAsso.get(assoId) ?? {
        nom: (asso.nom as string) ?? '',
        ville: (asso.ville as string) ?? '',
        region: (asso.region as string) ?? '',
        nb_collectes: 0,
        repas: 0,
      };
      cur.nb_collectes += 1;
      cur.repas += Number(a.volume_repas_realise ?? 0);
      byAsso.set(assoId, cur);
    }
  }
  const rows = [...byAsso.values()].sort((a, b) => a.nom.localeCompare(b.nom));

  const columns: CsvColumn<Agg>[] = [
    { header: 'Association', value: (r) => r.nom },
    { header: 'Ville', value: (r) => r.ville },
    { header: 'Région', value: (r) => r.region },
    { header: 'Nb collectes', value: (r) => r.nb_collectes },
    { header: 'Repas donnés', value: (r) => r.repas },
  ];
  return { filenamePrefix: 'associations', csv: toCsv(rows, columns) };
}

// ===========================================================================
// IMPACT RSE CONSOLIDÉ (grain collecte) — admin/ops, mgr, agence, gestionnaire, client.
// CO₂ induit/évité/net + énergie + tonnage + taux + repas AG (valeurs figées DB).
// ===========================================================================
export async function buildImpactRseExport(
  ctx: ExportContext,
  sp: URLSearchParams,
): Promise<ExportOutput> {
  const type = sp.get('type');
  const from = sp.get('from');
  const to = sp.get('to');

  let q = ctx.supabase
    .from('collectes')
    .select(
      `id, type, statut, date_collecte, taux_recyclage,
       co2_induit_kg, co2_evite_kg, co2_net_kg, energie_primaire_evitee_kwh,
       collecte_flux(poids_reel_kg),
       evenements!inner(nom_evenement, date_evenement,
         traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom, ville))`,
    )
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') q = q.eq('type', type);
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const traiteurNoms = await resolveTraiteurNoms(
    ctx.supabase,
    rows.map(
      (r) =>
        (unwrap(r.evenements)
          .traiteur_operationnel_organisation_id as string) ?? '',
    ),
  );
  const repas = await resolveRepas(
    ctx.supabase,
    rows.filter((r) => r.type === 'anti_gaspi').map((r) => r.id as string),
    ctx.isStaff,
  );

  const evt = (r: Row) => unwrap(r.evenements);
  const lieuOf = (r: Row) => unwrap(evt(r).lieux);

  const columns: CsvColumn<Row>[] = [
    {
      header: 'Date événement',
      value: (r) => formatDateFr(evt(r).date_evenement as string),
    },
    { header: 'Événement', value: (r) => evt(r).nom_evenement as string },
    { header: 'Lieu', value: (r) => lieuOf(r).nom as string },
    { header: 'Ville', value: (r) => lieuOf(r).ville as string },
    {
      header: 'Traiteur',
      value: (r) =>
        traiteurNoms.get(
          evt(r).traiteur_operationnel_organisation_id as string,
        ) ?? '',
    },
    { header: 'Type', value: (r) => libelle(TYPE_COLLECTE_LIBELLE, r.type) },
    {
      header: 'Tonnage ZD (kg)',
      value: (r) =>
        r.type === 'zero_dechet'
          ? formatPoidsKg(
              sommePoidsFlux(
                r.collecte_flux as { poids_reel_kg?: number | null }[],
              ),
            )
          : '',
    },
    {
      header: 'Taux recyclage (%)',
      value: (r) => formatNombreFr(r.taux_recyclage as number),
    },
    {
      header: 'CO2 évité (kg)',
      value: (r) => formatPoidsKg(r.co2_evite_kg as number),
    },
    {
      header: 'CO2 induit (kg)',
      value: (r) => formatPoidsKg(r.co2_induit_kg as number),
    },
    {
      header: 'CO2 net (kg)',
      value: (r) => formatPoidsKg(r.co2_net_kg as number),
    },
    {
      header: 'Énergie primaire évitée (kWh)',
      value: (r) => formatNombreFr(r.energie_primaire_evitee_kwh as number),
    },
    {
      header: 'Repas AG',
      value: (r) =>
        r.type === 'anti_gaspi' ? (repas.get(r.id as string) ?? '') : '',
    },
  ];

  return { filenamePrefix: 'impact-rse', csv: toCsv(rows, columns) };
}
