/**
 * Champs admin-only de `plateforme.associations` — source UNIQUE pour les deux
 * verbes du back-office (création POST et édition PATCH).
 *
 * CDC §06.06 §5 « Associations » l.425-426 : SIREN, habilitation 2041-GE
 * (booléen + date d'expiration), identifiant point de collecte MTS-1 et
 * désactivation (`actif`) sont réservés à `admin_savr`. `ops_savr` édite le
 * reste (contacts, horaires, capacité, description, logo, instructions d'accès).
 *
 * Pourquoi une constante partagée : la liste vivait en local dans le PATCH et la
 * création ne la connaissait pas — un `ops_savr` pouvait donc POSER à la
 * création les valeurs que le PATCH lui refuse (asymétrie relevée par
 * reviewer-rls-securite sur la PR #299). Un seul tableau = plus de dérive
 * possible : toute colonne ajoutée ici couvre création ET édition du même coup.
 *
 * ⚠ Le trigger DB `trg_ops_immutable_cols` (migration 20260629120000, étendu
 * 20260702020100) ne rattrape PAS ces routes : elles écrivent en service_role,
 * or `f_app_role()` est NULL sous service_role et le trigger s'exempte dans ce
 * cas. Il ne protège que les écritures PostgREST directes d'un JWT `ops_savr`.
 * Côté INSERT il n'y a d'ailleurs rien à rattraper : `associations` n'a aucune
 * policy INSERT pour ops (RLS `asso_ops_select` + `asso_ops_update` seulement,
 * épinglé par supabase/tests/SECU__admin_only_cols_insert.test.sql). La garde de
 * route ci-dessous est donc la SEULE barrière — pas une ceinture parmi d'autres.
 */
export const ASSOCIATIONS_ADMIN_FIELDS = [
  'habilitee_attestation_fiscale',
  'date_expiration_habilitation',
  'siren',
  // Ajout Val 2026-09-14 (PR #299) : source de l'instantané fiscal
  // `attestations_don.association_numero_rup` → même régime que l'habilitation.
  'numero_rup',
  'id_point_collecte_mts1',
  'actif',
] as const;

/**
 * Champs admin-only effectivement « posés » par une requête.
 *
 * Une valeur neutre (absente, `null`, chaîne vide, `false`) ne pose rien : elle
 * laisse la colonne à son état par défaut. On ne refuse donc que la requête qui
 * tente réellement d'écrire une valeur admin-only — sinon la modale association,
 * qui envoie TOUJOURS les clés du bloc admin (`siren: null`,
 * `habilitee_attestation_fiscale: false`…), rendrait toute création impossible
 * à `ops_savr`.
 *
 * NB `actif` : la création ne persiste jamais cette colonne (elle prend son
 * défaut `true`) ; `actif: false` passe donc la garde et reste sans effet. La
 * désactivation d'une association est un PATCH, où la garde est stricte.
 */
export function champsAdminPoses(body: Record<string, unknown>): string[] {
  return ASSOCIATIONS_ADMIN_FIELDS.filter((champ) => {
    const valeur = body[champ];
    return (
      valeur !== undefined &&
      valeur !== null &&
      valeur !== '' &&
      valeur !== false
    );
  });
}
