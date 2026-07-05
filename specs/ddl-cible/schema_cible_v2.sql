-- =====================================================================
-- SAVR — SCHÉMA CIBLE V2 (GELÉ) — DDL de référence pour le diff garde-fou 1
-- =====================================================================
-- Objet : représentation EXÉCUTABLE et STRUCTURELLE du data model complet
--         V1+V2 (Plateforme + TMS natif). Sert de référence immuable contre
--         laquelle on diff les migrations V1 (garde-fou 1 : V1 ⊂ cible V2).
--
-- Source de vérité :
--   - plateforme.* + shared.fichiers : 01 - Cahier des charges App/04 - Data Model.md (living, 2026-06-07)
--   - shared.prestataires + tms.*     : 02 - Cahier des charges TMS/04 - Data Model TMS.md
--   - Modules V2 reportés (Module 19 impact enrichi) inclus car cible = CDC complet.
--
-- Périmètre du fichier (décision Val 2026-06-08) : STRUCTURE DIFFABLE.
--   INCLUS  : CREATE SCHEMA, CREATE TYPE (enums), CREATE TABLE
--             (colonnes, types, NOT NULL, DEFAULT, PK, UNIQUE, CHECK, GENERATED),
--             foreign keys (section dédiée en fin de fichier).
--   EXCLUS  : policies RLS (auditées par cdc-audit-rls), triggers, fonctions,
--             vues (dérivées). Les colonnes GENERATED alimentées par trigger
--             (ex tournees.cout_final_ht) sont des colonnes simples ici.
--
-- Conventions de typage retenues (choix figés ici, cf. § AMBIGUÏTÉS) :
--   - montants HT/TTC/TVA non précisés .... numeric(12,2)
--   - poids kg non précisés ................ numeric(10,3)   (pesees garde numeric(7,2) du CDC)
--   - taux/pourcent remise (0..1) .......... numeric(5,4)
--   - taux_tva ............................. numeric(5,2)
--   - latitude/longitude « float » du CDC .. double precision
--   - PK technique ......................... uuid DEFAULT gen_random_uuid()
--   - timestamps ........................... timestamptz DEFAULT now()
--
-- AMBIGUÏTÉS RÉSOLUES dans ce DDL — TOUTES CONFIRMÉES (A4 le 2026-06-09, A1-A3/A5-A7 le 2026-06-10, challenge Frontière) :
--   A1. factures_collectes : ajout d'un id uuid PK technique (composite impossible,
--       collecte_id nullable).
--   A2. sequences_facturation : PK = (serie, annee).
--   A3. tarif_applique_id (factures_collectes) : uuid SANS FK (polymorphe zd/ag).
--   A4. Audit (RÉVERSÉ 2026-06-11, audit data model) : DEUX tables distinctes par schéma —
--       plateforme.audit_log (App, singulier, canonique) et tms.audit_logs (TMS, partitionnée,
--       porte la colonne migration `contexte`). shared.audit_logs N'EXISTE PLUS : le CDC TMS
--       référence partout tms.audit_logs (acteur_user_id, table_name). acteur_user_id =
--       snapshot uuid SANS FK (append-only, conforme §2). PK composite (id, created_at) pour
--       le partitionnement mensuel. [Ex-décision 2026-06-09 « shared.audit_logs partagée » abandonnée.]
--   A5. pesees : colonne canonique = poids_net_kg (le `poids_net_g` d'un trigger = coquille).
--   A6. tms.types_vehicules.categorie_plateforme : text + CHECK (5 valeurs), pas un enum partagé.
--   A7. Colonnes « decimal » non précisées du CDC : précisions figées par convention ci-dessus.
--
-- COLONNES TEXT+CHECK volontaires (NE PAS convertir en enum SQL — extensibilité V2) :
--   plateforme : flux_dechets.code, attributions_antgaspi.branche_attribution,
--                attributions_antgaspi.motif_override, outbox_events.event_type,
--                outbox_events.status.
--   tms        : la quasi-totalité des « statut/enum » (statut_dispatch, statut_operationnel,
--                statut_rapprochement, statut_everest, flux, etc.). Seuls alerte_criticite /
--                alerte_statut / alerte_resolution_source sont des CREATE TYPE formels.
--
-- Régénération : ce fichier est DÉRIVÉ. À regeler après toute modif des deux Data Model.
-- Gelé le : 2026-06-08. Regelé le : 2026-06-10 (+ jobs_pdf, ambiguïtés confirmées).
-- Regelé le : 2026-06-11 (audit data model) : user_role 7 valeurs (+ops_savr), organisations.raison_sociale,
--   tournee_statut 4 valeurs (-confirmee_prestataire), heures réelles time→timestamptz (collectes+tournees),
--   UNIQUE collecte_flux(collecte_id,flux_id), géoloc TMS (collectes_tms.arrivee_gps/depart_gps,
--   tournees.cloture_gps/cloture_hors_zone), A4 RÉVERSÉ shared.audit_logs→tms.audit_logs,
--   PK composite (id,created_at) sur tms.audit_logs + tms.integrations_logs.
-- Regelé le : 2026-06-11 bis (revue adversariale concurrence) : outbox_events +txid/+claimed_until/
--   +requires_reconciliation (lease/claim, advisory lock supprimé), + table plateforme.pesees_tournees
--   (pesées brutes par tour, INC-0).
-- Regelé le : 2026-06-30 (divergence M0.4 / lot R13 onboarding SIRET) : + table
--   plateforme.file_revalidation_siret (V1-only, job revalidation SIRET §15 §2.6) + index UNIQUE
--   partiel uniq_entites_facturation_siret sur entites_facturation.siret (détection doublon §15 §2.6
--   l.69). Recompté pglast : 92 tables (58 plateforme, 32 tms, 2 shared), 319 statements — l'en-tête
--   « 89/55 » du 06-11 avait dérivé (tables ajoutées par les divergences 06-15/06-24 non recomptées).
-- Regelé le : 2026-07-05 (divergence M3.1 « Mon profil ») : + colonne plateforme.users.telephone
--   (text nullable, profil transverse tous rôles §06.04 §7 ; V1 migration 20260705110000). Convergence
--   V1⊂cible rétablie — plus une divergence à tracer. Revalidé pglast v7.14 : 319 statements, 92 tables,
--   56 enums, 3 schémas — comptes inchangés (une colonne nullable n'ajoute aucun statement).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. EXTENSIONS & SCHÉMAS
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE sur grilles_tarifaires_prestataires

CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS plateforme;
CREATE SCHEMA IF NOT EXISTS tms;

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------

-- 1.1 shared
CREATE TYPE shared.storage_provider AS ENUM ('supabase','r2');

-- 1.2 plateforme — organisations / users
CREATE TYPE plateforme.organisation_type AS ENUM ('traiteur','agence','gestionnaire_lieux','client_organisateur');
CREATE TYPE plateforme.statut_verification_siret AS ENUM ('en_attente','verifie','echec'); -- ajout 2026-06-10 challenge onboarding
CREATE TYPE plateforme.statut_verification_tva AS ENUM ('en_attente','verifie','echec','non_applicable'); -- ajout 2026-06-10
CREATE TYPE plateforme.user_role AS ENUM ('admin_savr','ops_savr','traiteur_manager','traiteur_commercial','agence','gestionnaire_lieux','client_organisateur'); -- 7 valeurs alignées §09 (corrigé 2026-06-11, audit data model : ex commercial/manager renommés, ops_savr ajouté)
CREATE TYPE plateforme.mode_paiement AS ENUM ('virement','prelevement','cb','cheque');

-- 1.3 plateforme — lieux / véhicules
CREATE TYPE plateforme.region AS ENUM ('idf','province');
CREATE TYPE plateforme.acces_difficulte AS ENUM ('facile','difficile','tres_difficile');
CREATE TYPE plateforme.type_vehicule AS ENUM ('velo_cargo','camionnette','fourgon','vul','poids_lourd');

-- 1.4 plateforme — tournées
CREATE TYPE plateforme.creneau AS ENUM ('matin','apres_midi','soir','nuit','journee_complete');
CREATE TYPE plateforme.tournee_statut AS ENUM ('planifiee','en_cours','terminee','annulee'); -- 4 valeurs (confirmee_prestataire retirée, corrigé 2026-06-11 audit data model)

-- 1.5 plateforme — remises
CREATE TYPE plateforme.activite_remise AS ENUM ('zd','ag');
CREATE TYPE plateforme.scope_remise AS ENUM ('organisation','gestionnaire');
CREATE TYPE plateforme.type_tms AS ENUM ('mts1','a_toutes','autre','par_mail','par_telephone');
CREATE TYPE plateforme.type_document_pdf AS ENUM ('bordereau_zd','rapport_recyclage','attestation_don');  -- ajout 2026-06-10 (jobs_pdf)

-- 1.6 plateforme — flux déchets / paramètres CO2
CREATE TYPE plateforme.unite_mesure AS ENUM ('kg','litre','bac');
CREATE TYPE plateforme.filiere_valorisation AS ENUM ('recyclage','compostage','methanisation','valorisation_energetique','enfouissement','don_alimentaire');
CREATE TYPE plateforme.code_filiere AS ENUM ('verre','carton','biodechet','emballage');
CREATE TYPE plateforme.code_flux AS ENUM ('verre','carton','biodechet','emballage','dechet_residuel');
CREATE TYPE plateforme.code_materiau AS ENUM ('carton_papier','pet','pehd','acier','alu','briques','autres');
CREATE TYPE plateforme.type_valeur AS ENUM ('int','time','bool','decimal','string');

-- 1.7 plateforme — collectes
CREATE TYPE plateforme.collecte_type AS ENUM ('zero_dechet','anti_gaspi');
CREATE TYPE plateforme.collecte_statut AS ENUM (
  'brouillon','programmee','validee','en_cours','realisee','realisee_sans_collecte',
  'cloturee','annulation_demandee','annulee','rejetee_par_prestataire'); -- 10 valeurs (M1.8 A2 2026-06-15 — migration 20260615115900)
CREATE TYPE plateforme.collecte_statut_tms AS ENUM (
  'non_envoye','a_attribuer','attribuee_en_attente_acceptation','acceptee',
  'en_attente_execution','rejetee_par_prestataire','annulee_par_traiteur','rejetee_par_tms'); -- 8 valeurs
CREATE TYPE plateforme.incident_imputable AS ENUM ('prestataire','client','association','savr','externe');

-- 1.8 plateforme — attributions AG
CREATE TYPE plateforme.mode_validation AS ENUM ('manuel_top1','manuel_override','auto_accept');

-- 1.9 plateforme — tarification / packs
CREATE TYPE plateforme.mode_grille_zd AS ENUM ('paliers','fixe_variable');
CREATE TYPE plateforme.type_pack_tarif AS ENUM ('unitaire','pack_10','pack_30','pack_60');
CREATE TYPE plateforme.type_pack AS ENUM ('unitaire','pack_10','pack_30','pack_60','personnalise');
CREATE TYPE plateforme.mode_facturation_zd_enum AS ENUM ('par_collecte', 'mensuelle'); -- ajout 2026-06-19 (patch M1.7) : préférence facturation ZD par org, lue par batch J+1
CREATE TYPE plateforme.mode_facturation_pack AS ENUM ('globale_achat','par_collecte');
CREATE TYPE plateforme.pack_statut AS ENUM ('actif','epuise','annule');

-- 1.10 plateforme — factures
CREATE TYPE plateforme.facture_type AS ENUM ('zero_dechet','achat_pack_antigaspi','collecte_antigaspi','avoir');
CREATE TYPE plateforme.facture_mode AS ENUM ('par_collecte','mensuelle','globale_pack');
CREATE TYPE plateforme.facture_statut AS ENUM ('brouillon','en_attente_pennylane','emise','payee','annulee');
CREATE TYPE plateforme.tarif_source AS ENUM ('zd_grille','ag_unitaire','libre');

-- 1.11 plateforme — reporting / traçabilité réglementaire
CREATE TYPE plateforme.genere_par AS ENUM ('automatique','manuel');
CREATE TYPE plateforme.bordereau_statut AS ENUM ('brouillon','emis','corrige','annule');
CREATE TYPE plateforme.attestation_statut AS ENUM ('brouillon','emise','corrigee','annulee');
CREATE TYPE plateforme.document_general_type AS ENUM ('methodologie','cgv','politique_confidentialite','autre');
CREATE TYPE plateforme.type_export AS ENUM ('registre_dechets','bordereaux_batch','attestations_batch');
CREATE TYPE plateforme.export_format AS ENUM ('csv','zip','pdf');

-- 1.12 plateforme — intégrations
CREATE TYPE plateforme.integration_system AS ENUM ('tms','pennylane','resend','everest','mts1');
CREATE TYPE plateforme.integration_direction AS ENUM ('entrant','sortant');
CREATE TYPE plateforme.integration_log_statut AS ENUM ('succes','echec_retryable','echec_final');
CREATE TYPE plateforme.inbox_source AS ENUM ('tms','mts1');
CREATE TYPE plateforme.inbox_statut AS ENUM ('traite','ignore_doublon','ignore_out_of_order');
CREATE TYPE plateforme.email_statut AS ENUM ('envoye','ouvert','clique','bounce','echec');

-- 1.13 plateforme — Module 19 (V2)
CREATE TYPE plateforme.brief_fichier_type AS ENUM ('pdf','xlsx','docx','image','autre');
CREATE TYPE plateforme.statut_parsing AS ENUM ('en_attente','en_cours','termine','echec','valide_admin');
CREATE TYPE plateforme.referentiel_unite AS ENUM ('unite','kg','litre','km','kwh','pax');
CREATE TYPE plateforme.recyclabilite AS ENUM ('recyclable','compostable','reutilisable','non_recyclable');
CREATE TYPE plateforme.brief_item_statut AS ENUM ('auto_detecte','valide_admin','corrige_admin','ignore');

-- 1.14 tms — enums formels (alerting M11)
CREATE TYPE tms.alerte_criticite AS ENUM ('warning','critical');
CREATE TYPE tms.alerte_statut AS ENUM ('ouverte','snoozee','resolue');
CREATE TYPE tms.alerte_resolution_source AS ENUM ('manuel','auto');

-- ---------------------------------------------------------------------
-- 2. TABLES  shared.*
-- ---------------------------------------------------------------------

CREATE TABLE shared.fichiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_provider shared.storage_provider NOT NULL,
  bucket          text NOT NULL,
  key             text NOT NULL,
  content_hash    text,
  size_bytes      bigint NOT NULL,
  content_type    text NOT NULL,
  entity_type     text NOT NULL,                 -- propriétaire polymorphe (pas de FK)
  entity_id       uuid NOT NULL,                 -- polymorphe (pas de FK)
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Table unique prestataires logistiques (fusion ex plateforme.prestataires_logistiques + ex tms.prestataires)
CREATE TABLE shared.prestataires (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                      text NOT NULL,
  code                     text NOT NULL UNIQUE,          -- slug immuable (trigger)
  type_prestation          text[] NOT NULL,               -- {zd, ag}
  mode_integration         text NOT NULL CHECK (mode_integration IN ('api','email','manuel')),
  api_config               jsonb,
  siret                    text UNIQUE,                   -- nullable (prestataires étrangers)
  tva_intracom             text,
  adresse_siege            jsonb,
  contact_operationnel     jsonb,
  contact_facturation      jsonb,
  rayon_intervention_km    integer,
  coords_siege_lat         numeric(9,6),
  coords_siege_lng         numeric(9,6),
  integration_externe      text CHECK (integration_externe IS NULL OR integration_externe IN ('aucune','everest')),
  everest_client_id        text,
  statut                   text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','archive')),
  date_fin_contrat         date,
  has_portail_self_service boolean NOT NULL DEFAULT false,
  nb_collectes_6_mois_cache integer NOT NULL DEFAULT 0,
  commentaire_interne      text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

-- ---------------------------------------------------------------------
-- 3. TABLES  plateforme.*   — Niveau 1 : organisations & utilisateurs
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.organisations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                       text NOT NULL,
  raison_sociale            text,                          -- ajout 2026-06-11 (audit data model) : nullable, fallback COALESCE(raison_sociale,nom) dans v_registre_dechets + v_referentiel_traiteurs
  type                      plateforme.organisation_type NOT NULL,
  email_principal           text,
  telephone                 text,
  adresse                   text,
  siret                     text,                          -- shadow-only
  logo_url                  text,
  notes_internes            text,
  actif                     boolean NOT NULL DEFAULT true,
  est_shadow                boolean NOT NULL DEFAULT false,
  cree_par_organisation_id  uuid,                          -- FK self (section 7)
  mode_facturation_zd       plateforme.mode_facturation_zd_enum NOT NULL DEFAULT 'par_collecte', -- ajout 2026-06-19 (patch M1.7, décision Val 2026-06-14) : par_collecte=1 brouillon/collecte cloturée | mensuelle=agrégé mensuel par traiteur
  tarif_refacture_pax_zd    numeric(10,2) NOT NULL DEFAULT 1.50 CHECK (tarif_refacture_pax_zd >= 0),
  grille_tarifaire_zd_id    uuid,                          -- FK -> grilles_tarifaires_zd (section 7)
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (est_shadow = false OR type = 'traiteur'),
  CHECK (est_shadow = false OR cree_par_organisation_id IS NOT NULL)
);

CREATE TABLE plateforme.users (
  id                 uuid PRIMARY KEY,                     -- = Supabase Auth id
  organisation_id    uuid NOT NULL,
  email              text NOT NULL UNIQUE,
  prenom             text NOT NULL,
  nom                text NOT NULL,
  telephone          text,                                 -- profil « Mon compte » (transverse tous rôles, §06.04 §7) ; V1 migration 20260705110000
  role               plateforme.user_role NOT NULL,
  actif              boolean NOT NULL DEFAULT true,
  derniere_connexion timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  cgu_accepte_le     timestamptz,                          -- acceptation CGU = création compte (Art. 11/22, preuve opposable) ; NULL = compte migré sans trace
  cgu_version        text                                  -- version CGU acceptée (CGU_VERSION_COURANTE) ; NULL = compte migré
);

CREATE TABLE plateforme.entites_facturation (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           uuid NOT NULL,
  raison_sociale            text NOT NULL,
  siret                     text NOT NULL,
  tva_intracom              text,
  pennylane_customer_id     text,
  adresse_facturation       text NOT NULL,
  code_postal               text NOT NULL,
  ville                     text NOT NULL,
  pays                      text NOT NULL DEFAULT 'FR',
  email_facturation         text,
  contact_compta_nom        text,
  conditions_paiement_jours integer NOT NULL DEFAULT 30,
  mode_paiement             plateforme.mode_paiement,
  siret_verification        plateforme.statut_verification_siret NOT NULL DEFAULT 'en_attente', -- ajout 2026-06-10 challenge onboarding (§15 §2.6 matérialisé)
  siret_verifie_le          timestamptz,
  tva_verification          plateforme.statut_verification_tva NOT NULL DEFAULT 'en_attente',   -- non bloquant facturation (arbitrage Val 2026-06-10)
  tva_verifiee_le           timestamptz,
  entite_par_defaut         boolean NOT NULL DEFAULT false,
  actif                     boolean NOT NULL DEFAULT true,
  commentaires              text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- nouvelle V1 (ajout 2026-06-30, divergence M0.4 / lot R13) : file du job de revalidation SIRET
-- (§15 §2.6 l.73 — 3 paliers 15 min/1 h/24 h si INSEE injoignable au signup). V1-only assumé
-- (liste fermée Frontière G1) : purement plateforme, aucune sémantique partagée TMS.
CREATE TABLE plateforme.file_revalidation_siret (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entite_facturation_id  uuid NOT NULL,
  statut                 text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','resolu','epuise')),
  tentatives             integer NOT NULL DEFAULT 0,
  prochaine_tentative_le timestamptz NOT NULL DEFAULT now(),
  derniere_erreur        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.organisations_lieux (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  lieu_id         uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  UNIQUE (organisation_id, lieu_id)
);

CREATE TABLE IF NOT EXISTS plateforme.organisations_domaines_email (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL REFERENCES plateforme.organisations(id) ON DELETE CASCADE,
  domaine         text        NOT NULL,
  verifie_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_domaine_email UNIQUE (domaine)
);

CREATE TABLE IF NOT EXISTS plateforme.domaines_email_publics (
  domaine    text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3b. plateforme.*  — Niveau 2 : référentiel
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.types_evenements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  libelle         text NOT NULL,
  ordre_affichage integer NOT NULL DEFAULT 0,
  actif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.lieux (
  id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                            text NOT NULL,
  nom_alternatif                 text,
  adresse_acces                  text NOT NULL,
  code_postal                    text NOT NULL,
  ville                          text NOT NULL,
  latitude                       double precision,
  longitude                      double precision,
  region                         plateforme.region,
  acces_details                  text,
  acces_office                   plateforme.acces_difficulte,
  stationnement                  plateforme.acces_difficulte,
  type_vehicule_max              plateforme.type_vehicule NOT NULL,
  contraintes_horaires           text,
  flux_autorises                 text[],
  volume_max_bacs                integer,
  capacite_maximum               integer,
  traiteurs_operant              uuid[],                   -- FK implicites (pas de contrainte)
  controle_acces_requis_default  boolean NOT NULL DEFAULT false,
  photos_urls                    text[],
  commentaires_internes          text,
  commentaire_lieu               text,
  siren                          text CHECK (siren ~ '^[0-9]{9}$'),
  email_gestionnaire             text,
  reference_citeo                boolean NOT NULL DEFAULT false,
  actif                          boolean NOT NULL DEFAULT true,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.contacts_traiteurs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid NOT NULL,
  prenom               text NOT NULL,
  nom                  text NOT NULL,
  telephone            text NOT NULL,
  email                text,
  fonction             text,
  utilise_nb_fois      integer NOT NULL DEFAULT 0,
  derniere_utilisation timestamptz,
  actif                boolean NOT NULL DEFAULT true,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, telephone)
);

CREATE TABLE plateforme.tournees (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_interne        text NOT NULL UNIQUE,
  date_tournee             date NOT NULL,
  creneau                  plateforme.creneau NOT NULL,
  heure_debut_prevue       time,
  heure_fin_prevue         time,
  heure_debut_reelle       timestamptz,                    -- time→timestamptz (2026-06-11 audit : collectes de nuit, passage minuit)
  heure_fin_reelle         timestamptz,                    -- time→timestamptz (2026-06-11 idem)
  prestataire_logistique_id uuid NOT NULL,                 -- FK -> shared.prestataires
  type_vehicule            plateforme.type_vehicule,
  plaque_immatriculation   text,
  plaque_saisie_at         timestamptz,
  chauffeur_nom            text,
  chauffeur_telephone      text,
  statut                   plateforme.tournee_statut NOT NULL,
  tms_reference            text,
  external_ref_commande    text,                           -- neutre TMS-Ready (idempotence retry)
  notes_internes           text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.collecte_tournees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id uuid NOT NULL,
  tournee_id  uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collecte_id, tournee_id)
);

CREATE TABLE plateforme.tarifs_negocie (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activite                     plateforme.activite_remise NOT NULL,
  scope                        plateforme.scope_remise NOT NULL,
  organisation_id              uuid,
  gestionnaire_organisation_id uuid,
  lieu_id                      uuid,
  remise_pct                   numeric(5,4) NOT NULL CHECK (remise_pct > 0 AND remise_pct <= 1),
  valide_du                    date NOT NULL,
  valide_jusqu_au              date,
  commentaires                 text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.flux_dechets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                  text NOT NULL,
  code                 text NOT NULL UNIQUE,               -- text+CHECK applicatif (extensible V2)
  unite_mesure         plateforme.unite_mesure NOT NULL,
  ordre_affichage      integer NOT NULL DEFAULT 0,
  exutoire             text,
  exutoire_adresse     text,
  exutoire_siret       text,
  code_dechet_europeen text,
  filiere_valorisation plateforme.filiere_valorisation NOT NULL,
  eligible_citeo       boolean DEFAULT false,
  actif                boolean NOT NULL DEFAULT true
);

CREATE TABLE plateforme.parametres_taux_recyclage (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_filiere  plateforme.code_filiere NOT NULL UNIQUE,
  nom_filiere   text NOT NULL,
  taux_captation numeric(5,4) NOT NULL CHECK (taux_captation >= 0 AND taux_captation <= 1),
  prestataire   text,
  source_donnee text,
  commentaire   text,
  actif         boolean NOT NULL DEFAULT true,
  date_maj      timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_taux_recyclage_history (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id         uuid NOT NULL,
  code_filiere         plateforme.code_filiere NOT NULL,
  taux_captation_avant numeric(5,4) NOT NULL,
  taux_captation_apres numeric(5,4) NOT NULL,
  prestataire_avant    text,
  prestataire_apres    text,
  source_donnee_avant  text,
  source_donnee_apres  text,
  commentaire_modif    text NOT NULL,
  modifie_par          uuid NOT NULL,
  modifie_le           timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_facteurs_co2 (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_flux                     plateforme.code_flux NOT NULL UNIQUE,
  nom_flux                      text NOT NULL,
  fe_induit_kg_t                numeric(8,2) NOT NULL CHECK (fe_induit_kg_t >= 0),
  fe_evite_kg_t                 numeric(8,2) NOT NULL CHECK (fe_evite_kg_t >= 0),
  energie_primaire_evitee_kwh_t numeric(10,2) NOT NULL DEFAULT 0,
  source_donnee                 text,
  commentaire                   text,
  actif                         boolean NOT NULL DEFAULT true,
  date_maj                      timestamptz NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_facteurs_co2_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id    uuid NOT NULL,
  code_flux       plateforme.code_flux NOT NULL,
  fe_induit_avant numeric(8,2) NOT NULL,
  fe_induit_apres numeric(8,2) NOT NULL,
  fe_evite_avant  numeric(8,2) NOT NULL,
  fe_evite_apres  numeric(8,2) NOT NULL,
  energie_avant   numeric(10,2),
  energie_apres   numeric(10,2),
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif text NOT NULL,
  modifie_par     uuid NOT NULL,
  modifie_le      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_mix_emballages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_materiau  plateforme.code_materiau NOT NULL UNIQUE,
  nom_materiau   text NOT NULL,
  part_pct       numeric(5,2) NOT NULL CHECK (part_pct >= 0 AND part_pct <= 100),
  fe_induit_kg_t numeric(8,2) NOT NULL CHECK (fe_induit_kg_t >= 0),
  fe_evite_kg_t  numeric(8,2) NOT NULL CHECK (fe_evite_kg_t >= 0),
  source_donnee  text,
  commentaire    text,
  actif          boolean NOT NULL DEFAULT true,
  date_maj       timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_mix_emballages_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id     uuid NOT NULL,
  code_materiau    plateforme.code_materiau NOT NULL,
  part_pct_avant   numeric(5,2) NOT NULL,
  part_pct_apres   numeric(5,2) NOT NULL,
  fe_induit_avant  numeric(8,2) NOT NULL,
  fe_induit_apres  numeric(8,2) NOT NULL,
  fe_evite_avant   numeric(8,2) NOT NULL,
  fe_evite_apres   numeric(8,2) NOT NULL,
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif text NOT NULL,
  modifie_par      uuid NOT NULL,
  modifie_le       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_co2_divers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle         text NOT NULL UNIQUE,
  valeur      numeric(12,4) NOT NULL,
  unite       text NOT NULL,
  description text NOT NULL,
  source_donnee text,
  valide_par  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_facteurs_co2_ag (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle         text NOT NULL UNIQUE,
  facteur_co2_evite_par_repas_kg numeric(8,4) NOT NULL CHECK (facteur_co2_evite_par_repas_kg >= 0),
  source_donnee text,
  commentaire text,
  actif       boolean NOT NULL DEFAULT true,
  date_maj    timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_facteurs_co2_ag_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parametre_id    uuid NOT NULL,
  facteur_avant   numeric(8,4) NOT NULL,
  facteur_apres   numeric(8,4) NOT NULL,
  source_donnee_avant text,
  source_donnee_apres text,
  commentaire_modif text NOT NULL,
  modifie_par     uuid NOT NULL,
  modifie_le      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.parametres_algo (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cle                  text NOT NULL UNIQUE,
  valeur               jsonb NOT NULL,
  type_valeur          plateforme.type_valeur NOT NULL,
  description          text NOT NULL,
  valide_par           uuid,
  motif_derniere_modif text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.associations (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                           text NOT NULL,
  adresse                       text NOT NULL,
  latitude                      double precision,
  longitude                     double precision,
  region                        plateforme.region NOT NULL,
  ville                         text NOT NULL,
  capacite_max_beneficiaires    integer,
  types_aliments_acceptes       text[],
  horaires_ouverture            jsonb,
  contact_nom                   text,
  contact_email                 text NOT NULL,
  contact_telephone             text,
  habilitee_attestation_fiscale boolean NOT NULL DEFAULT false,
  date_expiration_habilitation  date,
  actif                         boolean NOT NULL DEFAULT true,
  derniere_verification         date,
  commentaires_internes         text,
  description_rapport_impact    text NOT NULL,
  logo_url                      text,
  instructions_acces            text,
  siren                         text CHECK (siren IS NULL OR siren ~ '^[0-9]{9}$'),
  id_point_collecte_mts1        text,                      -- V1 only, déprécié V2
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.transporteurs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom                     text NOT NULL,
  siren                   text NOT NULL CHECK (siren ~ '^[0-9]{9}$'),
  adresse                 text NOT NULL,
  code_postal             text NOT NULL,
  ville                   text NOT NULL,
  latitude                double precision,
  longitude               double precision,
  types_vehicules         text[] NOT NULL,
  types_collecte          text[],
  type_tms                plateforme.type_tms NOT NULL,
  description_process_collecte text,
  code_transporteur_mts1  text,                            -- V1 only, déprécié V2
  contact_nom             text NOT NULL,
  contact_email           text NOT NULL,
  contact_telephone       text NOT NULL,
  tarif_par_course        numeric(12,2),
  actif                   boolean NOT NULL DEFAULT true,
  derniere_verification   date,
  commentaires_internes   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3c. plateforme.*  — Niveau 3 : opérationnel
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.evenements (
  id                                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id                        uuid NOT NULL,
  traiteur_operationnel_organisation_id  uuid NOT NULL,
  entite_facturation_id                  uuid NOT NULL,
  lieu_id                                uuid NOT NULL,
  created_by                             uuid NOT NULL,
  nom_evenement                          text,
  type_evenement_id                      uuid NOT NULL,
  date_evenement                         date,             -- auto-dérivé MIN(collectes.date_collecte) ; NULL = brouillon
  pax                                    integer NOT NULL,
  contact_principal_nom                  text NOT NULL,
  contact_principal_telephone            text NOT NULL,
  contact_secours_nom                    text,
  contact_secours_telephone              text,
  nom_client_organisateur                text,
  logo_client_organisateur_url           text,
  client_organisateur_organisation_id    uuid,
  reference_affaire                      text,
  notes_internes                         text,
  created_at                             timestamptz NOT NULL DEFAULT now(),
  updated_at                             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.collectes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id             uuid NOT NULL,
  type                     plateforme.collecte_type NOT NULL,
  prestataire_logistique_id uuid,                          -- FK -> shared.prestataires
  nb_camions_demande       smallint NOT NULL DEFAULT 1,    -- V1-only MTS-1
  statut                   plateforme.collecte_statut NOT NULL,
  aucun_repas_motif        text,
  aucun_repas_photo_url    text,
  statut_tms               plateforme.collecte_statut_tms NOT NULL DEFAULT 'non_envoye',
  statut_tms_at            timestamptz,
  collecte_remplacee_id    uuid,                           -- FK self
  motif_incident           text,
  incident_imputable_a     plateforme.incident_imputable,
  date_collecte            date NOT NULL,
  heure_collecte           time NOT NULL,
  heure_debut_reelle       timestamptz,                    -- time→timestamptz (2026-06-11 audit : collectes de nuit, passage minuit ; aligné tms)
  heure_fin_reelle         timestamptz,                    -- time→timestamptz (2026-06-11 idem)
  volume_estime_repas      integer,
  controle_acces_requis    boolean NOT NULL DEFAULT false,
  notes_internes           text,
  informations_supplementaires text,
  tms_reference            text,
  informations_completes   boolean NOT NULL DEFAULT true,
  annulee_cote_savr        boolean NOT NULL DEFAULT false,
  dirty_tms                boolean NOT NULL DEFAULT false,
  motif_override_prestataire text,
  annulee_cote_savr_motif  text,
  historique_partiel       boolean NOT NULL DEFAULT false,
  taux_recyclage           numeric(5,2),                   -- ZD only
  caps_appliques           jsonb,                          -- ZD only
  co2_induit_kg            numeric(10,2),                  -- ZD only
  co2_evite_kg             numeric(10,2),                  -- ZD + AG
  co2_net_kg               numeric(10,2),                  -- ZD only
  energie_primaire_evitee_kwh numeric(12,2),               -- ZD only
  co2_facteurs_snapshot    jsonb,                          -- ZD + AG
  pack_antgaspi_id         uuid,                           -- FK -> packs_antgaspi
  lieu_overrides           jsonb,
  realisee_at              timestamptz,                    -- base embargo H+24
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.collecte_flux (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id   uuid NOT NULL,
  flux_id       uuid NOT NULL,
  poids_reel_kg numeric(10,3),
  equivalent_roll numeric(10,3),
  nb_bacs       integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collecte_id, flux_id)                            -- ajout 2026-06-11 (audit data model) : idempotence re-poll adapter MTS-1 (UPSERT ON CONFLICT)
);

CREATE TABLE plateforme.attributions_antgaspi (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id            uuid NOT NULL UNIQUE,
  association_id         uuid NOT NULL,
  transporteur_id        uuid NOT NULL,
  branche_attribution    text NOT NULL,                    -- text+CHECK applicatif (valeurs canoniques)
  confirmation_transporteur jsonb,
  mode_validation        plateforme.mode_validation NOT NULL,
  valide_par             uuid,
  valide_at              timestamptz,
  volume_repas_realise   integer,
  poids_repas_kg         numeric(10,3),
  motif_override         text,
  motif_override_libre   text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3d. plateforme.*  — Niveau 4 : financier
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.grilles_tarifaires_zd (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom             text NOT NULL,
  mode            plateforme.mode_grille_zd NOT NULL,
  est_defaut      boolean NOT NULL DEFAULT false,
  valide_du       date NOT NULL,
  valide_jusqu    date,
  commentaires    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.tarifs_zero_dechet (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grille_id           uuid NOT NULL,
  pax_min             integer NOT NULL,
  pax_max             integer,
  prix_base_ht        numeric(12,2) NOT NULL DEFAULT 0,
  prix_par_couvert_ht numeric(12,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.tarifs_packs_ag (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_pack         plateforme.type_pack_tarif NOT NULL,
  credits           integer NOT NULL,
  prix_unitaire_ht  numeric(12,2) NOT NULL,
  montant_total_ht  numeric(12,2) NOT NULL,
  mensualisable     boolean NOT NULL DEFAULT false,
  nb_mensualites    integer,
  valide_du         date NOT NULL,
  valide_jusqu_au   date,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.packs_antgaspi (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid NOT NULL,
  type_pack         plateforme.type_pack NOT NULL,
  credits_initiaux  integer NOT NULL,
  credits_consommes integer NOT NULL DEFAULT 0,
  credits_restants  integer GENERATED ALWAYS AS (credits_initiaux - credits_consommes) STORED,
  montant_total_ht  numeric(12,2) NOT NULL,
  mode_facturation  plateforme.mode_facturation_pack NOT NULL,
  date_achat        date NOT NULL,
  date_expiration   date,
  facture_achat_id  uuid,                                  -- FK -> factures
  statut            plateforme.pack_statut NOT NULL,
  commentaires      text,
  prix_unitaire_ht  numeric(12,2),                           -- snapshot prix/collecte à la création (Option A, M2.1b 2026-06-15)
  idempotency_key   text UNIQUE,                             -- dédup POST API création pack (Option A, M2.1b 2026-06-15)
  cree_par_user_id  uuid,                                    -- FK -> shared.users — traçabilité Admin créateur (Option A, M2.1b 2026-06-15)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.factures (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL,
  entite_facturation_id uuid NOT NULL,
  numero_facture        text NOT NULL UNIQUE,
  facture_origine_id    uuid,                              -- FK self (si avoir)
  type                  plateforme.facture_type NOT NULL,
  mode_facturation      plateforme.facture_mode NOT NULL,
  pack_antgaspi_id      uuid,
  montant_ht            numeric(12,2) NOT NULL,
  taux_tva              numeric(5,2) NOT NULL DEFAULT 20.0,
  montant_ttc           numeric(12,2) NOT NULL,
  statut                plateforme.facture_statut NOT NULL,
  pennylane_id          text,
  pdf_url_pennylane     text,
  pdf_url_savr          text,
  date_emission         date,
  date_echeance         date,
  date_paiement         date,
  erreur_synchro        text,
  erreur_synchro_at     timestamptz,
  derniere_tentative_pennylane_at timestamptz,
  marge_logistique      numeric(12,2),                     -- jamais exposée clients
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.factures_collectes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- A1 confirmé Val 2026-06-10 : PK technique
  facture_id            uuid NOT NULL,
  collecte_id           uuid,                              -- NULL = ligne libre
  designation           text,
  quantite              numeric(10,2) NOT NULL DEFAULT 1,
  taux_tva              numeric(5,2) NOT NULL DEFAULT 20.0,
  tarif_applique_id     uuid,                              -- A3 confirmé Val 2026-06-10 : polymorphe, pas de FK
  tarif_applique_source plateforme.tarif_source,
  tarif_detail          jsonb,
  montant_ligne_ht      numeric(12,2) NOT NULL,
  libelle_ligne         text,
  CHECK (collecte_id IS NOT NULL OR designation IS NOT NULL)
);

CREATE TABLE plateforme.sequences_facturation (
  serie          text NOT NULL,
  annee          integer NOT NULL,
  dernier_numero integer NOT NULL DEFAULT 0,
  PRIMARY KEY (serie, annee)                               -- A2 confirmé Val 2026-06-10
);

-- ---------------------------------------------------------------------
-- 3e. plateforme.*  — Niveau 5 : reporting & traçabilité réglementaire
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.rapports_rse (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id          uuid NOT NULL,
  collecte_id           uuid,
  version               integer NOT NULL DEFAULT 1,
  pdf_url               text,
  genere_at             timestamptz,
  genere_par            plateforme.genere_par,
  regenere_at           timestamptz,
  regenere_par_user_id  uuid,
  disponible_a          timestamptz NOT NULL,
  envoye_client         boolean DEFAULT false,
  envoye_at             timestamptz,
  consulte_par_user_at  timestamptz,
  filtres_benchmark     jsonb,
  template_version      text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.bordereaux_savr (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id                     uuid NOT NULL UNIQUE,
  numero                          text NOT NULL UNIQUE,
  date_emission                   date NOT NULL,
  date_collecte                   date NOT NULL,
  producteur_entite_facturation_id uuid,
  producteur_raison_sociale       text NOT NULL,
  producteur_siret                text,
  producteur_adresse              text NOT NULL,
  transporteur_nom                text NOT NULL,
  transporteur_siret              text,
  exutoire_nom                    text NOT NULL,
  exutoire_adresse                text,
  exutoire_siret                  text,
  detail_flux                     jsonb NOT NULL,
  poids_total_kg                  numeric(10,3) NOT NULL,
  pdf_url                         text NOT NULL,
  statut                          plateforme.bordereau_statut NOT NULL,
  version                         integer NOT NULL DEFAULT 1,
  template_version                text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.attestations_don (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id                   uuid NOT NULL UNIQUE,
  attribution_antgaspi_id       uuid NOT NULL,
  numero                        text NOT NULL UNIQUE,
  date_emission                 date NOT NULL,
  date_collecte                 date NOT NULL,
  donateur_entite_facturation_id uuid NOT NULL,
  donateur_raison_sociale       text NOT NULL,
  donateur_siret                text NOT NULL,
  association_id                uuid NOT NULL,
  association_nom               text NOT NULL,
  association_numero_rup        text,
  association_habilitation      text NOT NULL,
  volume_repas                  integer,
  poids_kg                      numeric(10,3),
  valeur_estimee_ht             numeric(12,2),
  pdf_url                       text NOT NULL,
  statut                        plateforme.attestation_statut NOT NULL,
  version                       integer NOT NULL DEFAULT 1,
  template_version              text,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.documents_generaux_savr (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           plateforme.document_general_type NOT NULL,
  titre          text NOT NULL,
  version        text NOT NULL,
  pdf_url        text NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  uploaded_by    uuid NOT NULL,
  actif          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.exports_registre (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  organisation_id   uuid NOT NULL,
  type_export       plateforme.type_export NOT NULL,
  periode_debut     date NOT NULL,
  periode_fin       date NOT NULL,
  filtres_appliques jsonb,
  format            plateforme.export_format NOT NULL,
  nb_lignes         integer,
  genere_at         timestamptz NOT NULL
);

CREATE TABLE plateforme.coefficients_perte_labo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       uuid NOT NULL,
  annee_reference       integer NOT NULL CHECK (annee_reference BETWEEN 2020 AND 2100),
  coefficient_kg_couvert numeric(6,4) NOT NULL CHECK (coefficient_kg_couvert >= 0),
  source_commentaire    text,
  saisi_par             uuid NOT NULL,
  saisi_le              timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, annee_reference)
);

-- ---------------------------------------------------------------------
-- 3f. plateforme.*  — Niveau 6 : Module 19 impact enrichi (V2 — cible CDC complet)
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.briefs_evenement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id    uuid NOT NULL,
  fichier_url     text NOT NULL,
  fichier_nom     text NOT NULL,
  fichier_type    plateforme.brief_fichier_type NOT NULL,
  version         integer NOT NULL DEFAULT 1,
  statut_parsing  plateforme.statut_parsing NOT NULL,
  parsing_resultat jsonb,
  parsing_provider text,
  parsing_cout    numeric(12,2),
  uploaded_by     uuid NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.referentiel_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  libelle         text NOT NULL,
  ordre_affichage integer NOT NULL DEFAULT 0,
  actif           boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.referentiel_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categorie_id        uuid NOT NULL,
  code                text NOT NULL UNIQUE,
  libelle             text NOT NULL,
  description         text,
  unite_mesure        plateforme.referentiel_unite NOT NULL,
  facteur_co2_kg      numeric(12,4),
  facteur_eau_litre   numeric(12,4),
  recyclabilite       plateforme.recyclabilite,
  source              text,
  date_validite_debut date NOT NULL,
  date_validite_fin   date,
  actif               boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.brief_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id           uuid NOT NULL,
  referentiel_item_id uuid,
  texte_brut         text NOT NULL,
  quantite           numeric(12,3) NOT NULL,
  unite_detectee     text,
  confiance_mapping  numeric(5,4),
  statut             plateforme.brief_item_statut NOT NULL,
  valide_par         uuid,
  valide_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.impact_calculs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id        uuid NOT NULL,
  brief_item_id       uuid NOT NULL,
  referentiel_item_id uuid NOT NULL,
  quantite_appliquee  numeric(12,3) NOT NULL,
  co2_kg              numeric(12,4),
  eau_litre           numeric(12,4),
  genere_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.impact_synthese_evenement (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evenement_id        uuid NOT NULL UNIQUE,
  version             integer NOT NULL DEFAULT 1,
  co2_total_kg        numeric(12,4),
  co2_par_categorie   jsonb,
  eau_total_litre     numeric(12,4),
  dechets_detournes_kg numeric(12,3),
  nb_items_analyses   integer,
  nb_items_non_mappes integer,
  calcule_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 3g. plateforme.*  — Niveau 7 : intégrations & synchronisation
-- ---------------------------------------------------------------------

CREATE TABLE plateforme.integrations_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid,
  system           plateforme.integration_system NOT NULL,
  direction        plateforme.integration_direction NOT NULL,
  endpoint         text NOT NULL,
  request_headers  jsonb,
  request_body     jsonb,
  response_status  integer,
  response_body    jsonb,
  latence_ms       integer,
  tentative_numero integer NOT NULL DEFAULT 1,
  statut           plateforme.integration_log_statut NOT NULL,
  erreur_code      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.integrations_inbox (
  event_id    uuid PRIMARY KEY,
  type        text NOT NULL,
  source      plateforme.inbox_source NOT NULL,
  occurred_at timestamptz NOT NULL,
  recu_le     timestamptz NOT NULL DEFAULT now(),
  traite_le   timestamptz,
  statut      plateforme.inbox_statut NOT NULL
);

CREATE TABLE plateforme.outbox_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigserial NOT NULL UNIQUE,                 -- ordering déterministe (jamais created_at)
  event_type    text NOT NULL,                             -- text (E1/E2/E3/E5) — extensible
  aggregate_id  uuid NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  consumer      text,
  attempts      integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'pending',           -- pending | processing | failed | dead (processing ajouté 2026-06-11, lease/claim)
  next_retry_at timestamptz,
  last_error    text,
  dead_at       timestamptz,
  txid          bigint NOT NULL DEFAULT txid_current(),    -- ajout 2026-06-11 (revue adversariale R1) : garde de visibilité
  claimed_until timestamptz,                               -- ajout 2026-06-11 (R2/R3) : bail du claim worker
  requires_reconciliation boolean NOT NULL DEFAULT false   -- ajout 2026-06-11 (R3/R4) : réconciliation avant re-POST
);

-- Ajout 2026-06-10 (challenge Frontière G1) : file PDF — table technique V1, forward-compatible V2.
CREATE TABLE plateforme.jobs_pdf (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_document plateforme.type_document_pdf NOT NULL,
  entity_type   text NOT NULL CHECK (entity_type IN ('bordereaux_savr','rapports_rse','attestations_don')),
  entity_id     uuid NOT NULL,
  payload       jsonb NOT NULL,
  statut        text NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending','processing','done','failed','dead')),
  attempts      integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error    text,
  fichier_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Ajout 2026-06-11 (revue adversariale concurrence INC-0) : pesées brutes par tour,
-- source de l'agrégation terminale (collecte_flux = agrégat dérivé). V1-only assumé
-- (alimentée par l'adapter MTS-1 ; dormante en V2 — même statut que nb_camions_demande).
CREATE TABLE plateforme.pesees_tournees (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournee_id uuid NOT NULL,
  stop_id    text NOT NULL,
  flux_id    uuid NOT NULL,
  poids_kg   numeric(10,3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournee_id, stop_id, flux_id)
);

CREATE TABLE plateforme.email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  objet      text NOT NULL,
  corps_html text NOT NULL,
  corps_text text NOT NULL,
  variables  jsonb NOT NULL,
  actif      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.emails_envoyes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destinataire_user_id uuid,
  destinataire_email  text NOT NULL,
  template_slug       text NOT NULL,
  objet               text NOT NULL,
  variables_jsonb     jsonb NOT NULL,
  resend_id           text UNIQUE,
  statut              plateforme.email_statut NOT NULL,
  tentative_numero    integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  delivered_at        timestamptz
);

CREATE TABLE plateforme.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid,
  impersonator_id uuid,
  role_auteur     text,
  action          text NOT NULL,
  table_cible     text,
  entite_id       uuid,
  ancienne_valeur jsonb,
  nouvelle_valeur jsonb,
  motif           text,
  details         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plateforme.config_auto_accept_ag (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid NOT NULL,
  association_id      uuid,
  transporteur_id     uuid,
  auto_accept_actif   boolean NOT NULL DEFAULT false,
  seuil_pax_min       integer,
  seuil_pax_max       integer,
  notes               text,
  modifie_par         uuid,
  modifie_le          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 4. TABLES  tms.*   (CDC complet V2 — non développé en V1, gelé comme cible)
--    FK cross-schema vers plateforme.* INTERDITES → refs uuid nues.
--    Partitionnement (audit_logs, integrations_logs) non matérialisé ici.
-- ---------------------------------------------------------------------

-- 4a. Niveau 1 : identité & authentification

CREATE TABLE tms.users_tms (
  id                      uuid PRIMARY KEY,                -- = auth.users(id), FK gérée hors scope
  email                   text NOT NULL UNIQUE,
  nom                     text NOT NULL,
  prenom                  text NOT NULL,
  telephone               text,
  roles                   text[] NOT NULL,                -- {ops_savr, admin_tms, manager_prestataire, chauffeur}
  prestataire_id          uuid,                           -- FK -> shared.prestataires
  chauffeur_id            uuid,                           -- FK -> tms.chauffeurs
  statut                  text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','archive')),
  derniere_connexion_at   timestamptz,
  desactivee_at           timestamptz,
  desactivee_par_user_id  uuid,
  raison_desactivation    text CHECK (raison_desactivation IS NULL OR char_length(raison_desactivation) >= 20),
  mfa_active              boolean NOT NULL DEFAULT false,
  consentements           jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CHECK (NOT ('chauffeur' = ANY(roles)) OR chauffeur_id IS NOT NULL),
  CHECK (NOT ('manager_prestataire' = ANY(roles) OR 'chauffeur' = ANY(roles)) OR prestataire_id IS NOT NULL)
);

CREATE TABLE tms.users_tms_devices_trusted (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  device_fingerprint         text NOT NULL,
  user_agent                 text NOT NULL,
  ip_premiere_reconnaissance inet NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  derniere_activite_at       timestamptz NOT NULL,
  actif                      boolean NOT NULL DEFAULT true,
  revoque_at                 timestamptz,
  revoque_par_user_id        uuid
);

CREATE TABLE tms.chauffeurs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id           uuid NOT NULL,                 -- FK -> shared.prestataires
  user_tms_id              uuid UNIQUE,                    -- FK -> tms.users_tms
  nom                      text NOT NULL,
  prenom                   text NOT NULL,
  telephone                text NOT NULL,
  email                    text,
  peut_conduire            boolean NOT NULL DEFAULT true,
  numero_permis            text,
  date_fin_validite_permis date,
  permis_url               text,
  piece_identite_url       text,
  vehicule_prefere_id      uuid,                           -- FK -> tms.vehicules
  zones_preferees          text[],
  statut                   text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','archive')),
  commentaire_interne      text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE TABLE tms.types_vehicules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  libelle               text NOT NULL,
  categorie             text NOT NULL CHECK (categorie IN ('camion','fourgon','velo','autre')),
  categorie_plateforme  text NOT NULL CHECK (categorie_plateforme IN ('velo_cargo','camionnette','fourgon','vul','poids_lourd')), -- /* A6 confirmé Val 2026-06-10 */
  volume_m3_standard    numeric(5,2),
  co2_g_par_km_standard integer,
  frigorifique          boolean NOT NULL DEFAULT false,
  hayon                 boolean NOT NULL DEFAULT false,
  valide_ops            boolean NOT NULL DEFAULT true,
  cree_par              uuid,                              -- FK -> tms.users_tms
  ordre_affichage       integer NOT NULL DEFAULT 100,
  statut                text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','archive')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.vehicules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id   uuid NOT NULL,                          -- FK -> shared.prestataires
  type_vehicule_id uuid NOT NULL,                          -- FK -> tms.types_vehicules
  plaque           text NOT NULL,
  plaque_canonique text UNIQUE GENERATED ALWAYS AS (regexp_replace(upper(plaque),'[^A-Z0-9]','','g')) STORED,
  volume_m3        numeric(5,2),
  co2_g_par_km     integer,
  statut           text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','maintenance','archive')),
  commentaire_interne text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE TABLE tms.auth_sessions_tms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id        uuid NOT NULL,                       -- FK -> tms.chauffeurs
  device_fingerprint  text NOT NULL,
  user_agent_snapshot text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text,
  revoked_by_user_id  uuid                                 -- FK -> tms.users_tms
);

CREATE TABLE tms.chauffeurs_geolocalisation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chauffeur_id uuid NOT NULL,                              -- FK -> tms.chauffeurs
  tournee_id   uuid,                                       -- FK -> tms.tournees
  captured_at  timestamptz NOT NULL DEFAULT now(),
  latitude     numeric(9,6) NOT NULL,
  longitude    numeric(9,6) NOT NULL,
  accuracy_m   integer,
  source       text NOT NULL DEFAULT 'pwa_chauffeur' CHECK (source IN ('pwa_chauffeur','pwa_chauffeur_fallback','tournee_cloture')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4b. Niveau 2 : opérationnel

CREATE TABLE tms.collectes_tms (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme_collecte_id      uuid UNIQUE,                 -- ref nue (UNIQUE ignore NULL)
  plateforme_evenement_id     uuid,                        -- ref nue
  origine                     text NOT NULL DEFAULT 'webhook_e1' CHECK (origine IN ('webhook_e1','manuelle_tms')),
  plateforme_traiteur_id      uuid NOT NULL,               -- ref nue
  plateforme_programmateur_id uuid NOT NULL,               -- ref nue
  programmateur_nom           text NOT NULL,
  programmateur_type          text NOT NULL CHECK (programmateur_type IN ('traiteur','agence','gestionnaire_lieux')),
  traiteur_est_shadow         boolean NOT NULL DEFAULT false,
  plateforme_lieu_id          uuid NOT NULL,               -- ref nue
  traiteur_nom                text NOT NULL,
  lieu_adresse                jsonb NOT NULL,
  parcours                    text NOT NULL CHECK (parcours IN ('zd','ag')),
  heure_collecte              timestamptz NOT NULL,
  nb_pax                      integer,
  contenants_prevus           jsonb,
  statut_dispatch             text NOT NULL DEFAULT 'a_attribuer'
                              CHECK (statut_dispatch IN ('a_attribuer','attribuee_en_attente_acceptation','acceptee','en_attente_execution','rejetee_par_prestataire','annulee_par_traiteur')),
  prestataire_id              uuid,                         -- FK -> shared.prestataires
  date_attribution            timestamptz,
  date_acceptation            timestamptz,
  date_assignation_execution  timestamptz,
  date_refus                  timestamptz,
  motif_refus                 text,
  statut_operationnel         text NOT NULL DEFAULT 'planifiee'
                              CHECK (statut_operationnel IN ('planifiee','en_cours','realisee','realisee_sans_collecte','incident','annulee')),
  aucun_repas_motif           text,
  aucun_repas_photo_url       text,
  date_debut_reelle           timestamptz,
  date_fin_reelle             timestamptz,
  arrivee_gps                 jsonb,                        -- ajout 2026-06-11 (audit) : {lat,lng,accuracy_m,captured_at}, géofence M05, purge RGPD J+30
  depart_gps                  jsonb,                        -- ajout 2026-06-11 (audit) : idem, départ site M05
  coords_manquantes           boolean NOT NULL DEFAULT false,
  re_confirmation_requise     boolean NOT NULL DEFAULT false,
  annulee_pendant_en_cours    boolean NOT NULL DEFAULT false,
  lieu_snapshot               jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_principal_nom       text NOT NULL,
  contact_principal_telephone text NOT NULL,
  contact_secours_nom         text,
  contact_secours_telephone   text,
  last_occurred_at            timestamptz NOT NULL DEFAULT now(),
  controle_acces_requis       boolean NOT NULL DEFAULT false,
  informations_supplementaires text,
  association_snapshot        jsonb,                        -- AG only
  suggestion_prestataire_id   uuid,                         -- FK -> shared.prestataires
  suggestion_branche_r1_code  text,                         -- enum 9 valeurs (text+CHECK applicatif)
  suggestion_detail           jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestion_calculee_at      timestamptz,
  everest_service_id_target   smallint CHECK (everest_service_id_target IS NULL OR everest_service_id_target IN (71,75,91)),
  sync_last_event_id          uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.tournees (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme_tournee_id       uuid UNIQUE,                  -- ref nue
  prestataire_id              uuid NOT NULL,                -- FK -> shared.prestataires
  chauffeur_id                uuid,                         -- FK -> tms.chauffeurs
  equipier_id                 uuid,                         -- FK -> tms.chauffeurs
  vehicule_id                 uuid,                         -- FK -> tms.vehicules
  plaque_preassignee_manager  text,
  plaque_preassignee_par_user_id uuid,                      -- FK -> tms.users_tms
  plaque_preassignee_at       timestamptz,
  grille_tarifaire_id         uuid,                         -- FK -> tms.grilles_tarifaires_prestataires
  date_planifiee              date NOT NULL,
  heure_planifiee_debut       timestamptz,
  heure_planifiee_fin         timestamptz,
  heure_reelle_debut          timestamptz,
  heure_reelle_fin            timestamptz,
  duree_reelle_minutes        integer GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (heure_reelle_fin - heure_reelle_debut))/60) STORED,
  nb_personnes_facturation    integer NOT NULL DEFAULT 1,
  nb_unites_strike            integer,
  cout_calcule_ht             numeric(10,2),
  cout_detail                 jsonb,
  cout_ajuste_ht              numeric(10,2),
  motif_ajustement            text,
  ajuste_par_user_id          uuid,                         -- FK -> tms.users_tms
  ajuste_at                   timestamptz,
  cout_final_ht               numeric(10,2),                -- écrit par trigger (PAS generated ici)
  cout_final_verrouille       boolean NOT NULL DEFAULT false,
  verrouillee_par_facture_id  uuid,                         -- FK -> tms.factures_prestataires
  statut_financier            text NOT NULL DEFAULT 'calcule' CHECK (statut_financier IN ('calcule','ajuste')),
  cout_calculated_at          timestamptz,
  push_s6_version             integer NOT NULL DEFAULT 0,
  statut                      text NOT NULL DEFAULT 'planifiee' CHECK (statut IN ('planifiee','acceptee','en_cours','terminee','annulee')),
  commentaire_chauffeur       text,
  commentaire_ops             text,
  cloture_gps                 jsonb,                        -- ajout 2026-06-11 (audit) : {lat,lng,accuracy_m,captured_at}, géofence clôture M04, purge RGPD J+30
  cloture_hors_zone           boolean NOT NULL DEFAULT false, -- ajout 2026-06-11 (audit) : true si clôture hors rayon → alerte m04_cloture_hors_zone ; survit à la purge GPS
  stock_entrepot_update_at    timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK ((cout_ajuste_ht IS NULL) = (motif_ajustement IS NULL)),
  CHECK (motif_ajustement IS NULL OR char_length(motif_ajustement) >= 30),
  CHECK (cout_ajuste_ht IS NULL OR cout_ajuste_ht > 0),
  CHECK ((cout_ajuste_ht IS NULL AND statut_financier = 'calcule') OR (cout_ajuste_ht IS NOT NULL AND statut_financier = 'ajuste'))
);

CREATE TABLE tms.collecte_tournees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_tms_id     uuid NOT NULL,                        -- FK -> tms.collectes_tms
  tournee_id          uuid NOT NULL,                        -- FK -> tms.tournees
  ordre_dans_tournee  smallint NOT NULL CHECK (ordre_dans_tournee >= 1),
  cout_reparti_centimes integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collecte_tms_id, tournee_id),
  CONSTRAINT uq_tms_collecte_tournees_ordre UNIQUE (tournee_id, ordre_dans_tournee) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE tms.pesees (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_tms_id       uuid NOT NULL,                      -- FK -> tms.collectes_tms
  tournee_id            uuid NOT NULL,                      -- FK -> tms.tournees
  flux                  text NOT NULL CHECK (flux IN ('biodechet','emballage','carton','verre','dechet_residuel','don_alimentaire')),  -- CHECK DB durci 2026-06-11 (§04 TMS « Compat flux » : don_alimentaire canonique écriture, repas normalisé à l'import — ex-CHECK applicatif)
  ordre_pesee           integer NOT NULL DEFAULT 1,
  type_contenant_id     uuid,                               -- FK -> tms.types_contenants
  nb_contenants         integer NOT NULL DEFAULT 1,
  poids_brut_kg         numeric(7,2) NOT NULL,
  tare_kg               numeric(7,2) NOT NULL DEFAULT 0,
  poids_net_kg          numeric(7,2) GENERATED ALWAYS AS (GREATEST(poids_brut_kg - tare_kg, 0)) STORED,  -- A5 confirmé Val 2026-06-10 : kg canonique
  saisi_par_chauffeur_id uuid NOT NULL,                     -- FK -> tms.chauffeurs
  idempotency_key       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source                text NOT NULL DEFAULT 'chauffeur' CHECK (source IN ('chauffeur','ag_sans_collecte')),
  tare_override_motif   text,
  photos                text[] DEFAULT '{}',
  ajuste_par_ops_user_id uuid,                              -- FK -> tms.users_tms
  motif_ajustement      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collecte_tms_id, flux, ordre_pesee)
);

CREATE TABLE tms.types_contenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  libelle          text NOT NULL,
  categorie        text NOT NULL CHECK (categorie IN ('roll','bac','sac','autre')),
  volume_litres    integer,
  tare_kg          numeric(7,2) NOT NULL DEFAULT 0,
  flux_compatibles text[],
  ordre_affichage  integer NOT NULL DEFAULT 100,
  statut           text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','archive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.rolls_mouvements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL CHECK (source IN ('cloture_collecte','recompte_ops')),
  collecte_tms_id       uuid,                               -- FK -> tms.collectes_tms ON DELETE SET NULL
  tournee_id            uuid,                               -- FK -> tms.tournees
  plateforme_traiteur_id uuid NOT NULL,                     -- ref nue
  plateforme_lieu_id    uuid,                               -- ref nue
  type_contenant_id     uuid NOT NULL,                      -- FK -> tms.types_contenants ON DELETE RESTRICT
  nb_pleins_recuperes   integer NOT NULL DEFAULT 0 CHECK (nb_pleins_recuperes >= 0),
  nb_vides_laisses      integer NOT NULL DEFAULT 0 CHECK (nb_vides_laisses >= 0),
  delta                 integer NOT NULL,
  stock_apres           integer NOT NULL,
  motif                 text,
  saisi_par_chauffeur_id uuid,                              -- FK -> tms.chauffeurs
  user_id               uuid,                               -- FK -> tms.users_tms
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'cloture_collecte' AND collecte_tms_id IS NOT NULL AND saisi_par_chauffeur_id IS NOT NULL)
      OR (source = 'recompte_ops' AND user_id IS NOT NULL))
);

CREATE TABLE tms.incidents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_tms_id       uuid,                               -- FK -> tms.collectes_tms
  tournee_id            uuid,                               -- FK -> tms.tournees
  type_incident         text NOT NULL CHECK (type_incident IN ('acces_refuse','client_absent','probleme_tri','autre','client_annule_avant_arrivee')),
  gravite               text NOT NULL DEFAULT 'warning' CHECK (gravite IN ('warning','critical')),
  description           text NOT NULL,
  photos                text[] DEFAULT '{}',
  declarant_chauffeur_id uuid,                              -- FK -> tms.chauffeurs
  declarant_ops_user_id uuid,                               -- FK -> tms.users_tms
  resolu                boolean NOT NULL DEFAULT false,
  commentaire_resolution text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CHECK (declarant_chauffeur_id IS NOT NULL OR declarant_ops_user_id IS NOT NULL)
);

-- 4c. Niveau 3 : tarification & financier

CREATE TABLE tms.formules_catalogue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE,
  libelle           text NOT NULL,
  description       text,
  schema_parametres jsonb NOT NULL,
  exemple_parametres jsonb,
  statut            text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','desactive','archive')),
  ordre_affichage   integer NOT NULL DEFAULT 100,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.grilles_tarifaires_prestataires (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id      uuid NOT NULL,                        -- FK -> shared.prestataires
  type_vehicule_id    uuid,                                 -- FK -> tms.types_vehicules
  libelle             text NOT NULL,
  formule_id          uuid NOT NULL,                        -- FK -> tms.formules_catalogue
  parametres_formule  jsonb NOT NULL,
  date_debut_validite date NOT NULL,
  date_fin_validite   date,
  notes_negociation   text,
  pdf_contractuel_url text,
  cree_par_user_id    uuid NOT NULL,                        -- FK -> tms.users_tms
  statut              text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','archive')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (date_debut_validite > created_at::date),          -- anti-rétroactivité R2.8
  CONSTRAINT excl_grille_chevauchement EXCLUDE USING gist (
    prestataire_id WITH =,
    COALESCE(type_vehicule_id::text, '*') WITH =,
    daterange(date_debut_validite, COALESCE(date_fin_validite, 'infinity'::date), '[]') WITH &&
  ) WHERE (statut = 'actif')
);

CREATE TABLE tms.factures_prestataires (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prestataire_id           uuid NOT NULL,                   -- FK -> shared.prestataires
  numero_facture           text NOT NULL,
  date_facture             date NOT NULL,
  date_reception           timestamptz NOT NULL DEFAULT now(),
  periode_debut            date NOT NULL,
  periode_fin              date NOT NULL,
  montant_ht_prestataire   numeric(10,2) NOT NULL,
  montant_tva              numeric(10,2) NOT NULL DEFAULT 0,
  montant_ttc_prestataire  numeric(10,2) NOT NULL,
  montant_ht_calcule_tms   numeric(10,2),
  ecart_ht                 numeric(10,2) GENERATED ALWAYS AS (montant_ht_prestataire - montant_ht_calcule_tms) STORED,
  ecart_pourcent           numeric(7,2) GENERATED ALWAYS AS (
                             CASE WHEN montant_ht_calcule_tms > 0
                                  THEN (montant_ht_prestataire - montant_ht_calcule_tms) / montant_ht_calcule_tms * 100
                                  ELSE NULL END) STORED,     -- réécrit sur colonnes de base (pas sur ecart_ht généré)
  statut_rapprochement     text NOT NULL DEFAULT 'en_attente'
                           CHECK (statut_rapprochement IN ('en_attente','ecart_detecte','rapprochement_manuel_requis','conteste','valide','regle','remplacee_par_avoir')),
  conteste_apres_validation boolean NOT NULL DEFAULT false,
  pdf_url                  text NOT NULL,
  pdf_extraction_json      jsonb,
  source_upload            text NOT NULL DEFAULT 'manager_m03' CHECK (source_upload IN ('manager_m03','ops_manuel')),
  facture_corrigee_id      uuid,                            -- FK self
  remplacee_par_facture_id uuid,                            -- FK self
  motif_contestation       text,
  type_contestation        text,
  conteste_par_user_id     uuid,                            -- FK -> tms.users_tms
  conteste_at              timestamptz,
  motif_validation_ecart   text,
  commentaire_ops          text,
  uploade_par_user_id      uuid NOT NULL,                   -- FK -> tms.users_tms
  valide_at                timestamptz,
  reference_reglement      text,
  commentaire_reglement    text,
  regle_at                 timestamptz,
  exporte_pennylane_at     timestamptz,
  action_deverrouillage    text CHECK (action_deverrouillage IS NULL OR action_deverrouillage IN ('rejetee_pour_correction','reouverte_pour_validation')),
  motif_deverrouillage     text,
  deverrouillee_at         timestamptz,
  migration_test           boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

-- 4d. Niveau 4 : stock & exutoires

CREATE TABLE tms.stocks_rolls_traiteurs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plateforme_traiteur_id uuid NOT NULL,                     -- ref nue
  plateforme_lieu_id     uuid,                              -- ref nue
  type_contenant_id      uuid NOT NULL,                     -- FK -> tms.types_contenants
  quantite_actuelle      integer NOT NULL DEFAULT 0,
  quantite_cible         integer,
  derniere_maj_at        timestamptz NOT NULL DEFAULT now(),
  derniere_maj_par_chauffeur_id uuid,                       -- FK -> tms.chauffeurs
  derniere_maj_collecte_id uuid,                            -- FK -> tms.collectes_tms
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.stocks_bacs_entrepot (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_contenant_id        uuid NOT NULL,                   -- FK -> tms.types_contenants
  flux                     text NOT NULL,                   -- enum fermée ZD (text+CHECK applicatif)
  quantite_pleine          integer NOT NULL DEFAULT 0 CHECK (quantite_pleine >= 0),
  quantite_vide_disponible integer NOT NULL DEFAULT 0 CHECK (quantite_vide_disponible >= 0),
  quantite_vide_cible      integer,
  capacite_max             integer NOT NULL DEFAULT 0 CHECK (capacite_max >= 0),
  seuil_saturation_pleins  integer NOT NULL DEFAULT 0 CHECK (seuil_saturation_pleins >= 0),
  emplacement_entrepot     text,
  derniere_maj_at          timestamptz NOT NULL DEFAULT now(),
  derniere_maj_par_user_id uuid,                            -- FK -> tms.users_tms
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type_contenant_id, flux)
);

CREATE TABLE tms.passages_veolia (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_prevue           date NOT NULL,
  statut                text NOT NULL DEFAULT 'planifie' CHECK (statut IN ('planifie','realise','annule')),
  statut_realise_at     timestamptz,
  verification_video_at timestamptz,
  flux                  text NOT NULL,
  nb_bacs_enleves       integer CHECK (nb_bacs_enleves IS NULL OR nb_bacs_enleves >= 0),
  type_contenant_id     uuid,                               -- FK -> tms.types_contenants
  poids_total_kg        numeric(8,2),
  bsd_numero            text,
  bsd_url               text,
  commentaire           text,
  cree_par_action       text NOT NULL DEFAULT 'saisie_manuelle' CHECK (cree_par_action IN ('saisie_manuelle','bouton_declencher')),
  motif_annulation      text CHECK (motif_annulation IS NULL OR motif_annulation IN ('annulation','report','autre')),
  motif_annulation_libre text,
  passage_origine_id    uuid,                               -- FK self
  saisi_par_user_id     uuid NOT NULL,                      -- FK -> tms.users_tms
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut <> 'annule' AND motif_annulation IS NULL AND motif_annulation_libre IS NULL)
      OR (statut = 'annule' AND motif_annulation IS NOT NULL)),
  CHECK ((statut = 'realise' AND statut_realise_at IS NOT NULL)
      OR (statut <> 'realise' AND statut_realise_at IS NULL))
);

CREATE TABLE tms.recomptages_stocks_entrepot_log (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocks_bacs_entrepot_id         uuid NOT NULL,            -- FK -> tms.stocks_bacs_entrepot
  flux                            text NOT NULL,
  type_contenant_id               uuid NOT NULL,            -- FK -> tms.types_contenants ON DELETE RESTRICT
  quantite_pleine_avant           integer NOT NULL,
  quantite_pleine_apres           integer NOT NULL,
  ecart_pleins                    integer GENERATED ALWAYS AS (quantite_pleine_apres - quantite_pleine_avant) STORED,
  quantite_vide_disponible_avant  integer NOT NULL,
  quantite_vide_disponible_apres  integer NOT NULL,
  ecart_vides                     integer GENERATED ALWAYS AS (quantite_vide_disponible_apres - quantite_vide_disponible_avant) STORED,
  motif                           text,
  recompte_par_user_id            uuid NOT NULL,            -- FK -> tms.users_tms
  created_at                      timestamptz NOT NULL DEFAULT now()
);

-- 4e. Niveau 5 : admin & audit

CREATE TABLE tms.parametres_tms (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace               text NOT NULL,
  cle                     text NOT NULL,
  libelle                 text NOT NULL,
  description             text,
  type_valeur             text NOT NULL CHECK (type_valeur IN ('number','integer','string','boolean','json','date')),
  valeur                  jsonb NOT NULL,
  unite                   text,
  valeur_min              jsonb,
  valeur_max              jsonb,
  modifiable_par          text[] NOT NULL DEFAULT '{admin_tms}',
  requires_redeploy       boolean NOT NULL DEFAULT false,
  deprecated              boolean NOT NULL DEFAULT false,
  derniere_maj_par_user_id uuid,                            -- FK -> tms.users_tms
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (namespace, cle)
);

-- Partitionnée mensuellement sur created_at en implémentation (PK composite (id, created_at) obligatoire pour partitionner)
-- A4 RÉVERSÉ (2026-06-11 audit data model) : audit TMS canonique = tms.audit_logs (App = plateforme.audit_log).
-- shared.audit_logs N'EXISTE PLUS — le CDC TMS référence partout tms.audit_logs (acteur_user_id, table_name).
CREATE TABLE tms.audit_logs (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  acteur_user_id uuid,                                      -- snapshot uuid, PAS de FK (append-only, §2)
  acteur_type    text NOT NULL CHECK (acteur_type IN ('user','systeme','webhook','cron','migration')), -- D2 : 5 valeurs
  acteur_meta    jsonb,
  table_name     text NOT NULL,
  row_id         uuid NOT NULL,
  action         text NOT NULL CHECK (action ~ '^[A-Z][A-Z0-9_]*$'),
  diff           jsonb NOT NULL,
  commentaire    text,
  request_id     uuid,
  contexte       text CHECK (contexte IS NULL OR contexte = 'migration_test'),  -- prédicat corrigé 2026-06-11 (ex IN(x,NULL) ne rejetait rien)
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)                              -- partition key (2026-06-11)
);

CREATE TABLE tms.impersonation_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonator_user_id uuid NOT NULL,                       -- FK -> tms.users_tms
  target_user_id       uuid NOT NULL,                       -- FK -> tms.users_tms
  motif                text NOT NULL CHECK (char_length(motif) >= 20),
  started_at           timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  end_reason           text CHECK (end_reason IS NULL OR end_reason IN ('manual_stop','auto_expiration','forced_logout')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.secrets_metadata (
  secret_name              text PRIMARY KEY,
  service                  text NOT NULL CHECK (service IN ('pennylane','everest','strike','marathon','bridge','autre')),
  type_secret              text NOT NULL CHECK (type_secret IN ('bearer_token','webhook_url','signing_key','client_id','client_secret')),
  description              text,
  expire_le                timestamptz,
  derniere_rotation_at     timestamptz,
  derniere_rotation_par_user_id uuid,                       -- FK -> tms.users_tms
  derniere_utilisation_at  timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.alertes_catalogue (
  code                     text PRIMARY KEY,
  titre_par_defaut         text NOT NULL,
  description              text,
  criticite_par_defaut     tms.alerte_criticite NOT NULL,
  destinataires_par_defaut jsonb NOT NULL DEFAULT '{"roles":["ops_savr"],"users":[],"manager_prestataire_scope":"none"}',
  module_origine           text NOT NULL,
  active                   boolean NOT NULL DEFAULT true,
  desactive_par_user_id    uuid,                            -- FK -> tms.users_tms
  desactive_at             timestamptz,
  desactive_motif          text,
  supprime_at              timestamptz,
  supprime_par_user_id     uuid,                            -- FK -> tms.users_tms
  cree_at                  timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.alertes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text NOT NULL,                     -- FK -> tms.alertes_catalogue.code
  criticite              tms.alerte_criticite NOT NULL,
  titre                  text NOT NULL,
  entity_type            text,
  entity_id              uuid,
  payload                jsonb NOT NULL DEFAULT '{}',
  dedup_key              text GENERATED ALWAYS AS (code || ':' || COALESCE(entity_type,'') || ':' || COALESCE(entity_id::text,'')) STORED,
  occurrences            integer NOT NULL DEFAULT 1,
  derniere_occurrence_at timestamptz NOT NULL,
  statut                 tms.alerte_statut NOT NULL DEFAULT 'ouverte',
  destinataires_user_ids uuid[] NOT NULL DEFAULT '{}',
  emise_at               timestamptz NOT NULL DEFAULT now(),
  ackee_par_user_id      uuid,                              -- FK -> tms.users_tms
  ackee_at               timestamptz,
  snoozee_jusqu_a        timestamptz,
  snoozee_par_user_id    uuid,                              -- FK -> tms.users_tms
  snoozee_motif          text,
  resolue_par_user_id    uuid,                              -- FK -> tms.users_tms
  resolue_at             timestamptz,
  resolue_source         tms.alerte_resolution_source,
  resolue_raison         text,
  resolue_motif          text,
  contexte               text CHECK (contexte IS NULL OR contexte IN ('migration_test')),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.alertes_archive_critical (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL,
  criticite           text NOT NULL CHECK (criticite = 'critical'),
  emise_at            timestamptz NOT NULL,
  resolue_at          timestamptz NOT NULL,
  entity_type         text,
  entity_id           uuid,
  dedup_key           text,
  occurrences         integer NOT NULL DEFAULT 1,
  ackee_par_user_id   uuid,
  ackee_at            timestamptz,
  resolue_par_user_id uuid,
  resolue_source      text,
  resolue_raison      text,
  contexte            text,
  archive_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tms.suggestions_attribution_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collecte_id     uuid NOT NULL,                            -- FK -> tms.collectes_tms
  trigger_source  text NOT NULL,                            -- T1_creation, T2_refus, T3_re_confirmation
  prestataire_id  uuid,                                     -- FK -> shared.prestataires
  branche_r1_code text,
  detail          jsonb,
  duree_calcul_ms integer,
  cree_le         timestamptz NOT NULL DEFAULT now()
);

-- 4f. Niveau 6 : intégrations

-- Partitionnée mensuellement sur created_at en implémentation (PK composite (id, created_at) obligatoire pour partitionner)
CREATE TABLE tms.integrations_logs (
  id                  uuid NOT NULL DEFAULT gen_random_uuid(),
  system              text NOT NULL CHECK (system IN ('plateforme','everest','autre')),
  direction           text NOT NULL CHECK (direction IN ('entrant','sortant')),
  type_event          text NOT NULL,
  event_id            uuid,
  ressource_type      text,
  ressource_id        uuid,
  url                 text,
  http_method         text,
  http_status         integer,
  payload             jsonb,
  reponse             jsonb,
  occurred_at         timestamptz,
  tentative_num       integer NOT NULL DEFAULT 1,
  statut              text NOT NULL CHECK (statut IN ('succes','echec_retry','echec_final','duplique')),
  prochaine_tentative_at timestamptz,
  duree_ms            integer,
  request_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)                              -- partition key (2026-06-11)
);

CREATE TABLE tms.integrations_inbox (
  event_id     uuid PRIMARY KEY,
  type         text NOT NULL,
  source       text NOT NULL CHECK (source IN ('plateforme','everest','autre')),
  occurred_at  timestamptz NOT NULL,
  recu_le      timestamptz NOT NULL DEFAULT now(),
  traite_le    timestamptz,
  statut       text NOT NULL CHECK (statut IN ('traite','ignore_doublon','ignore_out_of_order')),
  payload_hash text
);

CREATE TABLE tms.everest_missions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournee_id          uuid NOT NULL,                        -- FK -> tms.tournees
  collecte_tms_id     uuid,                                 -- FK -> tms.collectes_tms
  everest_mission_id  text UNIQUE,                          -- NULL autorisé (creation_failed/created_manually)
  everest_service_id  smallint NOT NULL CHECK (everest_service_id IN (71,75,91)),
  everest_client_id   text NOT NULL,
  statut_everest      text NOT NULL
                      CHECK (statut_everest IN ('created','assigned','in_progress','completed','completed_incomplete','cancelled','cancelled_externally','failed','creation_failed','created_manually')),
  coursier_nom        text,
  coursier_telephone  text,
  vehicule_type_everest text,
  cout_everest_ht     numeric(10,2),
  preuve_course_url   text,
  payload_create      jsonb,
  payload_latest_update jsonb,
  push_create_at      timestamptz,
  manual_acceptance_at timestamptz,
  manual_acceptance_by_user_id uuid,                        -- FK -> tms.users_tms
  manual_acceptance_contact text,
  manual_acceptance_commentaire text,
  derniere_sync_at    timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut_everest = 'created_manually') = (manual_acceptance_at IS NOT NULL AND manual_acceptance_by_user_id IS NOT NULL AND manual_acceptance_contact IS NOT NULL)),
  CHECK ((statut_everest IN ('creation_failed','created_manually')) OR everest_mission_id IS NOT NULL)
);

-- Partial unique indexes (stocks rolls : unicité conditionnelle au lieu)
CREATE UNIQUE INDEX uq_stocks_rolls_traiteur_global
  ON tms.stocks_rolls_traiteurs (plateforme_traiteur_id, type_contenant_id)
  WHERE plateforme_lieu_id IS NULL;
CREATE UNIQUE INDEX uq_stocks_rolls_traiteur_lieu
  ON tms.stocks_rolls_traiteurs (plateforme_traiteur_id, plateforme_lieu_id, type_contenant_id)
  WHERE plateforme_lieu_id IS NOT NULL;

-- Partial unique indexes (onboarding SIRET — divergence M0.4 2026-06-30)
--   détection de doublon SIRET (§15 §2.6 l.69) : les entités sans SIRET portent siret='' et ne collisionnent pas
CREATE UNIQUE INDEX uniq_entites_facturation_siret
  ON plateforme.entites_facturation (siret)
  WHERE siret <> '';
--   idempotence de l'enqueue : une entité n'a qu'une revalidation active à la fois
CREATE UNIQUE INDEX uq_file_revalidation_siret_active
  ON plateforme.file_revalidation_siret (entite_facturation_id)
  WHERE statut = 'en_attente';

-- ---------------------------------------------------------------------
-- 5. FOREIGN KEYS  (toutes différées en fin de fichier — ordre-indépendant)
--    Règle : FK cross-schema autorisées UNIQUEMENT vers shared.prestataires
--            et shared.fichiers. tms.* n'a AUCUNE FK vers plateforme.*.
-- ---------------------------------------------------------------------

-- 5a. plateforme.* (intra-schéma + vers shared.prestataires)
ALTER TABLE plateforme.organisations            ADD FOREIGN KEY (cree_par_organisation_id) REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.organisations            ADD FOREIGN KEY (grille_tarifaire_zd_id)   REFERENCES plateforme.grilles_tarifaires_zd(id);
ALTER TABLE plateforme.users                    ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.jobs_pdf                 ADD FOREIGN KEY (fichier_id)               REFERENCES shared.fichiers(id);  -- ajout 2026-06-10
ALTER TABLE plateforme.entites_facturation      ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.file_revalidation_siret  ADD FOREIGN KEY (entite_facturation_id)    REFERENCES plateforme.entites_facturation(id);  -- ajout 2026-06-30 divergence M0.4
ALTER TABLE plateforme.organisations_lieux      ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.organisations_lieux      ADD FOREIGN KEY (lieu_id)                  REFERENCES plateforme.lieux(id);
ALTER TABLE plateforme.organisations_lieux      ADD FOREIGN KEY (created_by)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.contacts_traiteurs       ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.contacts_traiteurs       ADD FOREIGN KEY (created_by)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.tournees                 ADD FOREIGN KEY (prestataire_logistique_id) REFERENCES shared.prestataires(id);
ALTER TABLE plateforme.collecte_tournees        ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.collecte_tournees        ADD FOREIGN KEY (tournee_id)               REFERENCES plateforme.tournees(id);
ALTER TABLE plateforme.tarifs_negocie           ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.tarifs_negocie           ADD FOREIGN KEY (gestionnaire_organisation_id) REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.tarifs_negocie           ADD FOREIGN KEY (lieu_id)                  REFERENCES plateforme.lieux(id);
ALTER TABLE plateforme.parametres_taux_recyclage_history ADD FOREIGN KEY (parametre_id)    REFERENCES plateforme.parametres_taux_recyclage(id);
ALTER TABLE plateforme.parametres_taux_recyclage_history ADD FOREIGN KEY (modifie_par)     REFERENCES plateforme.users(id);
ALTER TABLE plateforme.parametres_facteurs_co2_history   ADD FOREIGN KEY (parametre_id)    REFERENCES plateforme.parametres_facteurs_co2(id);
ALTER TABLE plateforme.parametres_facteurs_co2_history   ADD FOREIGN KEY (modifie_par)     REFERENCES plateforme.users(id);
ALTER TABLE plateforme.parametres_mix_emballages_history ADD FOREIGN KEY (parametre_id)    REFERENCES plateforme.parametres_mix_emballages(id);
ALTER TABLE plateforme.parametres_mix_emballages_history ADD FOREIGN KEY (modifie_par)     REFERENCES plateforme.users(id);
ALTER TABLE plateforme.parametres_co2_divers    ADD FOREIGN KEY (valide_par)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.parametres_facteurs_co2_ag_history ADD FOREIGN KEY (parametre_id)   REFERENCES plateforme.parametres_facteurs_co2_ag(id);
ALTER TABLE plateforme.parametres_facteurs_co2_ag_history ADD FOREIGN KEY (modifie_par)    REFERENCES plateforme.users(id);
ALTER TABLE plateforme.parametres_algo          ADD FOREIGN KEY (valide_par)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (traiteur_operationnel_organisation_id) REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (entite_facturation_id)    REFERENCES plateforme.entites_facturation(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (lieu_id)                  REFERENCES plateforme.lieux(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (created_by)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (type_evenement_id)        REFERENCES plateforme.types_evenements(id);
ALTER TABLE plateforme.evenements               ADD FOREIGN KEY (client_organisateur_organisation_id) REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.collectes                ADD FOREIGN KEY (evenement_id)             REFERENCES plateforme.evenements(id);
ALTER TABLE plateforme.collectes                ADD FOREIGN KEY (prestataire_logistique_id) REFERENCES shared.prestataires(id);
ALTER TABLE plateforme.collectes                ADD FOREIGN KEY (collecte_remplacee_id)    REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.collectes                ADD FOREIGN KEY (pack_antgaspi_id)         REFERENCES plateforme.packs_antgaspi(id);
ALTER TABLE plateforme.collecte_flux            ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.collecte_flux            ADD FOREIGN KEY (flux_id)                  REFERENCES plateforme.flux_dechets(id);
ALTER TABLE plateforme.pesees_tournees          ADD FOREIGN KEY (tournee_id)               REFERENCES plateforme.tournees(id) ON DELETE CASCADE;  -- ajout 2026-06-11 (INC-0)
ALTER TABLE plateforme.pesees_tournees          ADD FOREIGN KEY (flux_id)                  REFERENCES plateforme.flux_dechets(id);  -- ajout 2026-06-11 (INC-0)
ALTER TABLE plateforme.attributions_antgaspi    ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.attributions_antgaspi    ADD FOREIGN KEY (association_id)           REFERENCES plateforme.associations(id);
ALTER TABLE plateforme.attributions_antgaspi    ADD FOREIGN KEY (transporteur_id)          REFERENCES plateforme.transporteurs(id);
ALTER TABLE plateforme.attributions_antgaspi    ADD FOREIGN KEY (valide_par)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.tarifs_zero_dechet       ADD FOREIGN KEY (grille_id)                REFERENCES plateforme.grilles_tarifaires_zd(id);
ALTER TABLE plateforme.packs_antgaspi           ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.packs_antgaspi           ADD FOREIGN KEY (facture_achat_id)         REFERENCES plateforme.factures(id);
ALTER TABLE plateforme.factures                 ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.factures                 ADD FOREIGN KEY (entite_facturation_id)    REFERENCES plateforme.entites_facturation(id);
ALTER TABLE plateforme.factures                 ADD FOREIGN KEY (facture_origine_id)       REFERENCES plateforme.factures(id);
ALTER TABLE plateforme.factures                 ADD FOREIGN KEY (pack_antgaspi_id)         REFERENCES plateforme.packs_antgaspi(id);
ALTER TABLE plateforme.factures_collectes       ADD FOREIGN KEY (facture_id)               REFERENCES plateforme.factures(id);
ALTER TABLE plateforme.factures_collectes       ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.rapports_rse             ADD FOREIGN KEY (evenement_id)             REFERENCES plateforme.evenements(id);
ALTER TABLE plateforme.rapports_rse             ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.rapports_rse             ADD FOREIGN KEY (regenere_par_user_id)     REFERENCES plateforme.users(id);
ALTER TABLE plateforme.bordereaux_savr          ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.bordereaux_savr          ADD FOREIGN KEY (producteur_entite_facturation_id) REFERENCES plateforme.entites_facturation(id);
ALTER TABLE plateforme.attestations_don         ADD FOREIGN KEY (collecte_id)              REFERENCES plateforme.collectes(id);
ALTER TABLE plateforme.attestations_don         ADD FOREIGN KEY (attribution_antgaspi_id)  REFERENCES plateforme.attributions_antgaspi(id);
ALTER TABLE plateforme.attestations_don         ADD FOREIGN KEY (donateur_entite_facturation_id) REFERENCES plateforme.entites_facturation(id);
ALTER TABLE plateforme.attestations_don         ADD FOREIGN KEY (association_id)           REFERENCES plateforme.associations(id);
ALTER TABLE plateforme.documents_generaux_savr  ADD FOREIGN KEY (uploaded_by)              REFERENCES plateforme.users(id);
ALTER TABLE plateforme.exports_registre         ADD FOREIGN KEY (user_id)                  REFERENCES plateforme.users(id);
ALTER TABLE plateforme.exports_registre         ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.coefficients_perte_labo  ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.coefficients_perte_labo  ADD FOREIGN KEY (saisi_par)                REFERENCES plateforme.users(id);
-- Module 19 (V2)
ALTER TABLE plateforme.briefs_evenement         ADD FOREIGN KEY (evenement_id)             REFERENCES plateforme.evenements(id);
ALTER TABLE plateforme.briefs_evenement         ADD FOREIGN KEY (uploaded_by)              REFERENCES plateforme.users(id);
ALTER TABLE plateforme.referentiel_items        ADD FOREIGN KEY (categorie_id)             REFERENCES plateforme.referentiel_categories(id);
ALTER TABLE plateforme.brief_items              ADD FOREIGN KEY (brief_id)                 REFERENCES plateforme.briefs_evenement(id);
ALTER TABLE plateforme.brief_items              ADD FOREIGN KEY (referentiel_item_id)      REFERENCES plateforme.referentiel_items(id);
ALTER TABLE plateforme.brief_items              ADD FOREIGN KEY (valide_par)               REFERENCES plateforme.users(id);
ALTER TABLE plateforme.impact_calculs           ADD FOREIGN KEY (evenement_id)             REFERENCES plateforme.evenements(id);
ALTER TABLE plateforme.impact_calculs           ADD FOREIGN KEY (brief_item_id)            REFERENCES plateforme.brief_items(id);
ALTER TABLE plateforme.impact_calculs           ADD FOREIGN KEY (referentiel_item_id)      REFERENCES plateforme.referentiel_items(id);
ALTER TABLE plateforme.impact_synthese_evenement ADD FOREIGN KEY (evenement_id)            REFERENCES plateforme.evenements(id);
ALTER TABLE plateforme.emails_envoyes           ADD FOREIGN KEY (destinataire_user_id)     REFERENCES plateforme.users(id);
ALTER TABLE plateforme.audit_log                ADD FOREIGN KEY (user_id)                  REFERENCES plateforme.users(id);
ALTER TABLE plateforme.audit_log                ADD FOREIGN KEY (impersonator_id)          REFERENCES plateforme.users(id);
ALTER TABLE plateforme.config_auto_accept_ag    ADD FOREIGN KEY (organisation_id)          REFERENCES plateforme.organisations(id);
ALTER TABLE plateforme.config_auto_accept_ag    ADD FOREIGN KEY (association_id)           REFERENCES plateforme.associations(id);
ALTER TABLE plateforme.config_auto_accept_ag    ADD FOREIGN KEY (transporteur_id)          REFERENCES plateforme.transporteurs(id);
ALTER TABLE plateforme.config_auto_accept_ag    ADD FOREIGN KEY (modifie_par)              REFERENCES plateforme.users(id);

-- 5b. tms.* (intra-schéma + vers shared.prestataires uniquement)
ALTER TABLE tms.users_tms                    ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.users_tms                    ADD FOREIGN KEY (chauffeur_id)           REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.users_tms                    ADD FOREIGN KEY (desactivee_par_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.users_tms_devices_trusted    ADD FOREIGN KEY (user_id)                REFERENCES tms.users_tms(id);
ALTER TABLE tms.users_tms_devices_trusted    ADD FOREIGN KEY (revoque_par_user_id)    REFERENCES tms.users_tms(id);
ALTER TABLE tms.chauffeurs                   ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.chauffeurs                   ADD FOREIGN KEY (user_tms_id)            REFERENCES tms.users_tms(id);
ALTER TABLE tms.chauffeurs                   ADD FOREIGN KEY (vehicule_prefere_id)    REFERENCES tms.vehicules(id);
ALTER TABLE tms.types_vehicules              ADD FOREIGN KEY (cree_par)               REFERENCES tms.users_tms(id);
ALTER TABLE tms.vehicules                    ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.vehicules                    ADD FOREIGN KEY (type_vehicule_id)       REFERENCES tms.types_vehicules(id);
ALTER TABLE tms.auth_sessions_tms            ADD FOREIGN KEY (chauffeur_id)           REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.auth_sessions_tms            ADD FOREIGN KEY (revoked_by_user_id)     REFERENCES tms.users_tms(id);
ALTER TABLE tms.chauffeurs_geolocalisation   ADD FOREIGN KEY (chauffeur_id)           REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.chauffeurs_geolocalisation   ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.collectes_tms                ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.collectes_tms                ADD FOREIGN KEY (suggestion_prestataire_id) REFERENCES shared.prestataires(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (chauffeur_id)           REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (equipier_id)            REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (vehicule_id)            REFERENCES tms.vehicules(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (plaque_preassignee_par_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (grille_tarifaire_id)    REFERENCES tms.grilles_tarifaires_prestataires(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (ajuste_par_user_id)     REFERENCES tms.users_tms(id);
ALTER TABLE tms.tournees                     ADD FOREIGN KEY (verrouillee_par_facture_id) REFERENCES tms.factures_prestataires(id);
ALTER TABLE tms.collecte_tournees            ADD FOREIGN KEY (collecte_tms_id)        REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.collecte_tournees            ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.pesees                       ADD FOREIGN KEY (collecte_tms_id)        REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.pesees                       ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.pesees                       ADD FOREIGN KEY (type_contenant_id)      REFERENCES tms.types_contenants(id);
ALTER TABLE tms.pesees                       ADD FOREIGN KEY (saisi_par_chauffeur_id) REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.pesees                       ADD FOREIGN KEY (ajuste_par_ops_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.rolls_mouvements             ADD FOREIGN KEY (collecte_tms_id)        REFERENCES tms.collectes_tms(id) ON DELETE SET NULL;
ALTER TABLE tms.rolls_mouvements             ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.rolls_mouvements             ADD FOREIGN KEY (type_contenant_id)      REFERENCES tms.types_contenants(id) ON DELETE RESTRICT;
ALTER TABLE tms.rolls_mouvements             ADD FOREIGN KEY (saisi_par_chauffeur_id) REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.rolls_mouvements             ADD FOREIGN KEY (user_id)                REFERENCES tms.users_tms(id);
ALTER TABLE tms.incidents                    ADD FOREIGN KEY (collecte_tms_id)        REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.incidents                    ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.incidents                    ADD FOREIGN KEY (declarant_chauffeur_id) REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.incidents                    ADD FOREIGN KEY (declarant_ops_user_id)  REFERENCES tms.users_tms(id);
ALTER TABLE tms.grilles_tarifaires_prestataires ADD FOREIGN KEY (prestataire_id)      REFERENCES shared.prestataires(id);
ALTER TABLE tms.grilles_tarifaires_prestataires ADD FOREIGN KEY (type_vehicule_id)    REFERENCES tms.types_vehicules(id);
ALTER TABLE tms.grilles_tarifaires_prestataires ADD FOREIGN KEY (formule_id)          REFERENCES tms.formules_catalogue(id);
ALTER TABLE tms.grilles_tarifaires_prestataires ADD FOREIGN KEY (cree_par_user_id)    REFERENCES tms.users_tms(id);
ALTER TABLE tms.factures_prestataires        ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.factures_prestataires        ADD FOREIGN KEY (facture_corrigee_id)    REFERENCES tms.factures_prestataires(id);
ALTER TABLE tms.factures_prestataires        ADD FOREIGN KEY (remplacee_par_facture_id) REFERENCES tms.factures_prestataires(id);
ALTER TABLE tms.factures_prestataires        ADD FOREIGN KEY (conteste_par_user_id)   REFERENCES tms.users_tms(id);
ALTER TABLE tms.factures_prestataires        ADD FOREIGN KEY (uploade_par_user_id)    REFERENCES tms.users_tms(id);
ALTER TABLE tms.stocks_rolls_traiteurs       ADD FOREIGN KEY (type_contenant_id)      REFERENCES tms.types_contenants(id);
ALTER TABLE tms.stocks_rolls_traiteurs       ADD FOREIGN KEY (derniere_maj_par_chauffeur_id) REFERENCES tms.chauffeurs(id);
ALTER TABLE tms.stocks_rolls_traiteurs       ADD FOREIGN KEY (derniere_maj_collecte_id) REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.stocks_bacs_entrepot         ADD FOREIGN KEY (type_contenant_id)      REFERENCES tms.types_contenants(id);
ALTER TABLE tms.stocks_bacs_entrepot         ADD FOREIGN KEY (derniere_maj_par_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.passages_veolia              ADD FOREIGN KEY (type_contenant_id)      REFERENCES tms.types_contenants(id);
ALTER TABLE tms.passages_veolia              ADD FOREIGN KEY (passage_origine_id)     REFERENCES tms.passages_veolia(id);
ALTER TABLE tms.passages_veolia              ADD FOREIGN KEY (saisi_par_user_id)      REFERENCES tms.users_tms(id);
ALTER TABLE tms.recomptages_stocks_entrepot_log ADD FOREIGN KEY (stocks_bacs_entrepot_id) REFERENCES tms.stocks_bacs_entrepot(id);
ALTER TABLE tms.recomptages_stocks_entrepot_log ADD FOREIGN KEY (type_contenant_id)   REFERENCES tms.types_contenants(id) ON DELETE RESTRICT;
ALTER TABLE tms.recomptages_stocks_entrepot_log ADD FOREIGN KEY (recompte_par_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.parametres_tms               ADD FOREIGN KEY (derniere_maj_par_user_id) REFERENCES tms.users_tms(id);
-- tms.audit_logs.acteur_user_id : snapshot uuid SANS FK (append-only, conforme §2 ; A4 réversé 2026-06-11 — table TMS, plus de shared.audit_logs)
ALTER TABLE tms.impersonation_sessions       ADD FOREIGN KEY (impersonator_user_id)   REFERENCES tms.users_tms(id);
ALTER TABLE tms.impersonation_sessions       ADD FOREIGN KEY (target_user_id)         REFERENCES tms.users_tms(id);
ALTER TABLE tms.secrets_metadata             ADD FOREIGN KEY (derniere_rotation_par_user_id) REFERENCES tms.users_tms(id);
ALTER TABLE tms.alertes_catalogue            ADD FOREIGN KEY (desactive_par_user_id)  REFERENCES tms.users_tms(id);
ALTER TABLE tms.alertes_catalogue            ADD FOREIGN KEY (supprime_par_user_id)   REFERENCES tms.users_tms(id);
ALTER TABLE tms.alertes                      ADD FOREIGN KEY (code)                   REFERENCES tms.alertes_catalogue(code);
ALTER TABLE tms.alertes                      ADD FOREIGN KEY (ackee_par_user_id)      REFERENCES tms.users_tms(id);
ALTER TABLE tms.alertes                      ADD FOREIGN KEY (snoozee_par_user_id)    REFERENCES tms.users_tms(id);
ALTER TABLE tms.alertes                      ADD FOREIGN KEY (resolue_par_user_id)    REFERENCES tms.users_tms(id);
ALTER TABLE tms.suggestions_attribution_log  ADD FOREIGN KEY (collecte_id)            REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.suggestions_attribution_log  ADD FOREIGN KEY (prestataire_id)         REFERENCES shared.prestataires(id);
ALTER TABLE tms.everest_missions             ADD FOREIGN KEY (tournee_id)             REFERENCES tms.tournees(id);
ALTER TABLE tms.everest_missions             ADD FOREIGN KEY (collecte_tms_id)        REFERENCES tms.collectes_tms(id);
ALTER TABLE tms.everest_missions             ADD FOREIGN KEY (manual_acceptance_by_user_id) REFERENCES tms.users_tms(id);

-- =====================================================================
-- FIN — SCHÉMA CIBLE V2 GELÉ
-- =====================================================================
