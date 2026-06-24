export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  plateforme: {
    Tables: {
      alertes_admin: {
        Row: {
          code: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string | null
          resolue_at: string | null
          resolue_par_user_id: string | null
          statut: string
          titre: string
        }
        Insert: {
          code: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          resolue_at?: string | null
          resolue_par_user_id?: string | null
          statut?: string
          titre: string
        }
        Update: {
          code?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          resolue_at?: string | null
          resolue_par_user_id?: string | null
          statut?: string
          titre?: string
        }
        Relationships: [
          {
            foreignKeyName: "alertes_admin_resolue_par_user_id_fkey"
            columns: ["resolue_par_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      associations: {
        Row: {
          actif: boolean
          adresse: string
          capacite_max_beneficiaires: number | null
          commentaires_internes: string | null
          contact_email: string
          contact_nom: string | null
          contact_telephone: string | null
          created_at: string
          derniere_verification: string | null
          description_rapport_impact: string
          habilitee_attestation_fiscale: boolean
          horaires_ouverture: Json | null
          id: string
          id_point_collecte_mts1: string | null
          latitude: number | null
          longitude: number | null
          nom: string
          region: Database["plateforme"]["Enums"]["region"]
          types_aliments_acceptes: string[] | null
          updated_at: string
          ville: string
        }
        Insert: {
          actif?: boolean
          adresse: string
          capacite_max_beneficiaires?: number | null
          commentaires_internes?: string | null
          contact_email: string
          contact_nom?: string | null
          contact_telephone?: string | null
          created_at?: string
          derniere_verification?: string | null
          description_rapport_impact?: string
          habilitee_attestation_fiscale?: boolean
          horaires_ouverture?: Json | null
          id?: string
          id_point_collecte_mts1?: string | null
          latitude?: number | null
          longitude?: number | null
          nom: string
          region: Database["plateforme"]["Enums"]["region"]
          types_aliments_acceptes?: string[] | null
          updated_at?: string
          ville: string
        }
        Update: {
          actif?: boolean
          adresse?: string
          capacite_max_beneficiaires?: number | null
          commentaires_internes?: string | null
          contact_email?: string
          contact_nom?: string | null
          contact_telephone?: string | null
          created_at?: string
          derniere_verification?: string | null
          description_rapport_impact?: string
          habilitee_attestation_fiscale?: boolean
          horaires_ouverture?: Json | null
          id?: string
          id_point_collecte_mts1?: string | null
          latitude?: number | null
          longitude?: number | null
          nom?: string
          region?: Database["plateforme"]["Enums"]["region"]
          types_aliments_acceptes?: string[] | null
          updated_at?: string
          ville?: string
        }
        Relationships: []
      }
      attestations_don: {
        Row: {
          association_habilitation: string | null
          association_id: string
          association_nom: string | null
          association_numero_rup: string | null
          attribution_antgaspi_id: string | null
          co2_evite_kg: number | null
          co2_facteurs_snapshot: Json | null
          collecte_id: string
          created_at: string
          date_collecte: string | null
          date_emission: string | null
          donateur_entite_facturation_id: string | null
          donateur_raison_sociale: string | null
          donateur_siret: string | null
          eligible_at: string | null
          erreur_detail: string | null
          genere_at: string | null
          id: string
          mention_fiscale_2041ge: boolean
          nb_repas: number | null
          numero: string | null
          pdf_fichier_id: string | null
          pdf_url: string | null
          poids_kg: number | null
          statut: Database["plateforme"]["Enums"]["attestation_statut"]
          updated_at: string
          valeur_don_estimee_ht: number | null
          version: number
          volume_repas: number | null
        }
        Insert: {
          association_habilitation?: string | null
          association_id: string
          association_nom?: string | null
          association_numero_rup?: string | null
          attribution_antgaspi_id?: string | null
          co2_evite_kg?: number | null
          co2_facteurs_snapshot?: Json | null
          collecte_id: string
          created_at?: string
          date_collecte?: string | null
          date_emission?: string | null
          donateur_entite_facturation_id?: string | null
          donateur_raison_sociale?: string | null
          donateur_siret?: string | null
          eligible_at?: string | null
          erreur_detail?: string | null
          genere_at?: string | null
          id?: string
          mention_fiscale_2041ge?: boolean
          nb_repas?: number | null
          numero?: string | null
          pdf_fichier_id?: string | null
          pdf_url?: string | null
          poids_kg?: number | null
          statut?: Database["plateforme"]["Enums"]["attestation_statut"]
          updated_at?: string
          valeur_don_estimee_ht?: number | null
          version?: number
          volume_repas?: number | null
        }
        Update: {
          association_habilitation?: string | null
          association_id?: string
          association_nom?: string | null
          association_numero_rup?: string | null
          attribution_antgaspi_id?: string | null
          co2_evite_kg?: number | null
          co2_facteurs_snapshot?: Json | null
          collecte_id?: string
          created_at?: string
          date_collecte?: string | null
          date_emission?: string | null
          donateur_entite_facturation_id?: string | null
          donateur_raison_sociale?: string | null
          donateur_siret?: string | null
          eligible_at?: string | null
          erreur_detail?: string | null
          genere_at?: string | null
          id?: string
          mention_fiscale_2041ge?: boolean
          nb_repas?: number | null
          numero?: string | null
          pdf_fichier_id?: string | null
          pdf_url?: string | null
          poids_kg?: number | null
          statut?: Database["plateforme"]["Enums"]["attestation_statut"]
          updated_at?: string
          valeur_don_estimee_ht?: number | null
          version?: number
          volume_repas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attestations_don_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "associations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_don_attribution_antgaspi_id_fkey"
            columns: ["attribution_antgaspi_id"]
            isOneToOne: false
            referencedRelation: "attributions_antgaspi"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_don_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_don_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attestations_don_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "attestations_don_donateur_entite_facturation_id_fkey"
            columns: ["donateur_entite_facturation_id"]
            isOneToOne: false
            referencedRelation: "entites_facturation"
            referencedColumns: ["id"]
          },
        ]
      }
      attributions_antgaspi: {
        Row: {
          association_id: string
          branche_attribution: string
          collecte_id: string
          confirmation_transporteur: Json | null
          created_at: string
          id: string
          mode_validation: Database["plateforme"]["Enums"]["mode_validation"]
          motif_override: string | null
          motif_override_libre: string | null
          poids_repas_kg: number | null
          transporteur_id: string
          valide_at: string | null
          valide_par: string | null
          volume_repas_realise: number | null
        }
        Insert: {
          association_id: string
          branche_attribution: string
          collecte_id: string
          confirmation_transporteur?: Json | null
          created_at?: string
          id?: string
          mode_validation: Database["plateforme"]["Enums"]["mode_validation"]
          motif_override?: string | null
          motif_override_libre?: string | null
          poids_repas_kg?: number | null
          transporteur_id: string
          valide_at?: string | null
          valide_par?: string | null
          volume_repas_realise?: number | null
        }
        Update: {
          association_id?: string
          branche_attribution?: string
          collecte_id?: string
          confirmation_transporteur?: Json | null
          created_at?: string
          id?: string
          mode_validation?: Database["plateforme"]["Enums"]["mode_validation"]
          motif_override?: string | null
          motif_override_libre?: string | null
          poids_repas_kg?: number | null
          transporteur_id?: string
          valide_at?: string | null
          valide_par?: string | null
          volume_repas_realise?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attributions_antgaspi_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "associations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attributions_antgaspi_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attributions_antgaspi_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attributions_antgaspi_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "attributions_antgaspi_transporteur_id_fkey"
            columns: ["transporteur_id"]
            isOneToOne: false
            referencedRelation: "transporteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attributions_antgaspi_valide_par_fkey"
            columns: ["valide_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: number
          impersonator_id: string | null
          ip_address: unknown
          motif: string | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          role: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: number
          impersonator_id?: string | null
          ip_address?: unknown
          motif?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          role?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: number
          impersonator_id?: string | null
          ip_address?: unknown
          motif?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          role?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_impersonator_id_fkey"
            columns: ["impersonator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log_2026: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: number
          impersonator_id: string | null
          ip_address: unknown
          motif: string | null
          new_values: Json | null
          old_values: Json | null
          record_id: string | null
          role: string | null
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: number
          impersonator_id?: string | null
          ip_address?: unknown
          motif?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          role?: string | null
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: number
          impersonator_id?: string | null
          ip_address?: unknown
          motif?: string | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string | null
          role?: string | null
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bordereaux_savr: {
        Row: {
          collecte_id: string
          created_at: string
          date_collecte: string | null
          date_emission: string | null
          detail_flux: Json | null
          eligible_at: string | null
          erreur_detail: string | null
          exutoire_adresse: string | null
          exutoire_nom: string | null
          exutoire_siret: string | null
          genere_at: string | null
          id: string
          numero: string | null
          pdf_fichier_id: string | null
          poids_total_kg: number | null
          producteur_adresse: string | null
          producteur_entite_facturation_id: string | null
          producteur_raison_sociale: string | null
          producteur_siret: string | null
          statut: Database["plateforme"]["Enums"]["bordereau_statut"]
          transporteur_nom: string | null
          transporteur_siret: string | null
          updated_at: string
          version: number
        }
        Insert: {
          collecte_id: string
          created_at?: string
          date_collecte?: string | null
          date_emission?: string | null
          detail_flux?: Json | null
          eligible_at?: string | null
          erreur_detail?: string | null
          exutoire_adresse?: string | null
          exutoire_nom?: string | null
          exutoire_siret?: string | null
          genere_at?: string | null
          id?: string
          numero?: string | null
          pdf_fichier_id?: string | null
          poids_total_kg?: number | null
          producteur_adresse?: string | null
          producteur_entite_facturation_id?: string | null
          producteur_raison_sociale?: string | null
          producteur_siret?: string | null
          statut?: Database["plateforme"]["Enums"]["bordereau_statut"]
          transporteur_nom?: string | null
          transporteur_siret?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          collecte_id?: string
          created_at?: string
          date_collecte?: string | null
          date_emission?: string | null
          detail_flux?: Json | null
          eligible_at?: string | null
          erreur_detail?: string | null
          exutoire_adresse?: string | null
          exutoire_nom?: string | null
          exutoire_siret?: string | null
          genere_at?: string | null
          id?: string
          numero?: string | null
          pdf_fichier_id?: string | null
          poids_total_kg?: number | null
          producteur_adresse?: string | null
          producteur_entite_facturation_id?: string | null
          producteur_raison_sociale?: string | null
          producteur_siret?: string | null
          statut?: Database["plateforme"]["Enums"]["bordereau_statut"]
          transporteur_nom?: string | null
          transporteur_siret?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bordereaux_savr_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereaux_savr_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bordereaux_savr_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: true
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "bordereaux_savr_producteur_entite_facturation_id_fkey"
            columns: ["producteur_entite_facturation_id"]
            isOneToOne: false
            referencedRelation: "entites_facturation"
            referencedColumns: ["id"]
          },
        ]
      }
      coefficients_perte_labo: {
        Row: {
          annee_reference: number
          coefficient_kg_couvert: number
          created_at: string
          id: string
          organisation_id: string
          saisi_le: string
          saisi_par: string
          source_commentaire: string | null
          updated_at: string
        }
        Insert: {
          annee_reference: number
          coefficient_kg_couvert: number
          created_at?: string
          id?: string
          organisation_id: string
          saisi_le?: string
          saisi_par: string
          source_commentaire?: string | null
          updated_at?: string
        }
        Update: {
          annee_reference?: number
          coefficient_kg_couvert?: number
          created_at?: string
          id?: string
          organisation_id?: string
          saisi_le?: string
          saisi_par?: string
          source_commentaire?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coefficients_perte_labo_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coefficients_perte_labo_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coefficients_perte_labo_saisi_par_fkey"
            columns: ["saisi_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      collecte_flux: {
        Row: {
          collecte_id: string
          created_at: string
          equivalent_roll: number | null
          flux_id: string
          id: string
          nb_bacs: number | null
          poids_reel_kg: number | null
          updated_at: string
        }
        Insert: {
          collecte_id: string
          created_at?: string
          equivalent_roll?: number | null
          flux_id: string
          id?: string
          nb_bacs?: number | null
          poids_reel_kg?: number | null
          updated_at?: string
        }
        Update: {
          collecte_id?: string
          created_at?: string
          equivalent_roll?: number | null
          flux_id?: string
          id?: string
          nb_bacs?: number | null
          poids_reel_kg?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collecte_flux_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collecte_flux_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collecte_flux_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "collecte_flux_flux_id_fkey"
            columns: ["flux_id"]
            isOneToOne: false
            referencedRelation: "flux_dechets"
            referencedColumns: ["id"]
          },
        ]
      }
      collecte_tournees: {
        Row: {
          collecte_id: string
          created_at: string
          id: string
          rang: number
          tournee_id: string
          updated_at: string
        }
        Insert: {
          collecte_id: string
          created_at?: string
          id?: string
          rang?: number
          tournee_id: string
          updated_at?: string
        }
        Update: {
          collecte_id?: string
          created_at?: string
          id?: string
          rang?: number
          tournee_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collecte_tournees_tournee_id_fkey"
            columns: ["tournee_id"]
            isOneToOne: false
            referencedRelation: "tournees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collecte_tournees_collecte"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collecte_tournees_collecte"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collecte_tournees_collecte"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
        ]
      }
      collectes: {
        Row: {
          annulee_cote_savr: boolean
          annulee_cote_savr_motif: string | null
          aucun_repas_motif: string | null
          aucun_repas_photo_url: string | null
          caps_appliques: Json | null
          co2_evite_kg: number | null
          co2_facteurs_snapshot: Json | null
          co2_induit_kg: number | null
          co2_net_kg: number | null
          collecte_remplacee_id: string | null
          controle_acces_requis: boolean
          created_at: string
          date_collecte: string
          dirty_tms: boolean
          energie_primaire_evitee_kwh: number | null
          evenement_id: string
          heure_collecte: string
          heure_debut_reelle: string | null
          heure_fin_reelle: string | null
          historique_partiel: boolean
          id: string
          incident_imputable_a:
            | Database["plateforme"]["Enums"]["incident_imputable"]
            | null
          informations_completes: boolean
          informations_supplementaires: string | null
          lieu_overrides: Json | null
          motif_incident: string | null
          motif_override_prestataire: string | null
          nb_camions_demande: number
          notes_internes: string | null
          pack_antgaspi_id: string | null
          prestataire_logistique_id: string | null
          realisee_at: string | null
          statut: Database["plateforme"]["Enums"]["collecte_statut"]
          statut_tms: Database["plateforme"]["Enums"]["collecte_statut_tms"]
          statut_tms_at: string | null
          taux_recyclage: number | null
          tms_reference: string | null
          type: Database["plateforme"]["Enums"]["collecte_type"]
          updated_at: string
          volume_estime_repas: number | null
        }
        Insert: {
          annulee_cote_savr?: boolean
          annulee_cote_savr_motif?: string | null
          aucun_repas_motif?: string | null
          aucun_repas_photo_url?: string | null
          caps_appliques?: Json | null
          co2_evite_kg?: number | null
          co2_facteurs_snapshot?: Json | null
          co2_induit_kg?: number | null
          co2_net_kg?: number | null
          collecte_remplacee_id?: string | null
          controle_acces_requis?: boolean
          created_at?: string
          date_collecte: string
          dirty_tms?: boolean
          energie_primaire_evitee_kwh?: number | null
          evenement_id: string
          heure_collecte: string
          heure_debut_reelle?: string | null
          heure_fin_reelle?: string | null
          historique_partiel?: boolean
          id?: string
          incident_imputable_a?:
            | Database["plateforme"]["Enums"]["incident_imputable"]
            | null
          informations_completes?: boolean
          informations_supplementaires?: string | null
          lieu_overrides?: Json | null
          motif_incident?: string | null
          motif_override_prestataire?: string | null
          nb_camions_demande?: number
          notes_internes?: string | null
          pack_antgaspi_id?: string | null
          prestataire_logistique_id?: string | null
          realisee_at?: string | null
          statut?: Database["plateforme"]["Enums"]["collecte_statut"]
          statut_tms?: Database["plateforme"]["Enums"]["collecte_statut_tms"]
          statut_tms_at?: string | null
          taux_recyclage?: number | null
          tms_reference?: string | null
          type: Database["plateforme"]["Enums"]["collecte_type"]
          updated_at?: string
          volume_estime_repas?: number | null
        }
        Update: {
          annulee_cote_savr?: boolean
          annulee_cote_savr_motif?: string | null
          aucun_repas_motif?: string | null
          aucun_repas_photo_url?: string | null
          caps_appliques?: Json | null
          co2_evite_kg?: number | null
          co2_facteurs_snapshot?: Json | null
          co2_induit_kg?: number | null
          co2_net_kg?: number | null
          collecte_remplacee_id?: string | null
          controle_acces_requis?: boolean
          created_at?: string
          date_collecte?: string
          dirty_tms?: boolean
          energie_primaire_evitee_kwh?: number | null
          evenement_id?: string
          heure_collecte?: string
          heure_debut_reelle?: string | null
          heure_fin_reelle?: string | null
          historique_partiel?: boolean
          id?: string
          incident_imputable_a?:
            | Database["plateforme"]["Enums"]["incident_imputable"]
            | null
          informations_completes?: boolean
          informations_supplementaires?: string | null
          lieu_overrides?: Json | null
          motif_incident?: string | null
          motif_override_prestataire?: string | null
          nb_camions_demande?: number
          notes_internes?: string | null
          pack_antgaspi_id?: string | null
          prestataire_logistique_id?: string | null
          realisee_at?: string | null
          statut?: Database["plateforme"]["Enums"]["collecte_statut"]
          statut_tms?: Database["plateforme"]["Enums"]["collecte_statut_tms"]
          statut_tms_at?: string | null
          taux_recyclage?: number | null
          tms_reference?: string | null
          type?: Database["plateforme"]["Enums"]["collecte_type"]
          updated_at?: string
          volume_estime_repas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collectes_collecte_remplacee_id_fkey"
            columns: ["collecte_remplacee_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectes_collecte_remplacee_id_fkey"
            columns: ["collecte_remplacee_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collectes_collecte_remplacee_id_fkey"
            columns: ["collecte_remplacee_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "collectes_evenement_id_fkey"
            columns: ["evenement_id"]
            isOneToOne: false
            referencedRelation: "evenements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_collectes_pack_antgaspi"
            columns: ["pack_antgaspi_id"]
            isOneToOne: false
            referencedRelation: "packs_antgaspi"
            referencedColumns: ["id"]
          },
        ]
      }
      config_auto_accept_ag: {
        Row: {
          association_id: string | null
          auto_accept_actif: boolean
          created_at: string
          id: string
          notes: string | null
          organisation_id: string
          seuil_pax_max: number | null
          seuil_pax_min: number | null
          transporteur_id: string | null
          updated_at: string
        }
        Insert: {
          association_id?: string | null
          auto_accept_actif?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id: string
          seuil_pax_max?: number | null
          seuil_pax_min?: number | null
          transporteur_id?: string | null
          updated_at?: string
        }
        Update: {
          association_id?: string | null
          auto_accept_actif?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          seuil_pax_max?: number | null
          seuil_pax_min?: number | null
          transporteur_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "config_auto_accept_ag_association_id_fkey"
            columns: ["association_id"]
            isOneToOne: false
            referencedRelation: "associations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_auto_accept_ag_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_auto_accept_ag_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "config_auto_accept_ag_transporteur_id_fkey"
            columns: ["transporteur_id"]
            isOneToOne: false
            referencedRelation: "transporteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts_traiteurs: {
        Row: {
          actif: boolean
          created_at: string
          created_by: string | null
          derniere_utilisation: string | null
          email: string | null
          fonction: string | null
          id: string
          nom: string
          organisation_id: string
          prenom: string
          telephone: string
          updated_at: string
          utilise_nb_fois: number
        }
        Insert: {
          actif?: boolean
          created_at?: string
          created_by?: string | null
          derniere_utilisation?: string | null
          email?: string | null
          fonction?: string | null
          id?: string
          nom: string
          organisation_id: string
          prenom: string
          telephone: string
          updated_at?: string
          utilise_nb_fois?: number
        }
        Update: {
          actif?: boolean
          created_at?: string
          created_by?: string | null
          derniere_utilisation?: string | null
          email?: string | null
          fonction?: string | null
          id?: string
          nom?: string
          organisation_id?: string
          prenom?: string
          telephone?: string
          updated_at?: string
          utilise_nb_fois?: number
        }
        Relationships: [
          {
            foreignKeyName: "contacts_traiteurs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_traiteurs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_traiteurs_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      documents_generaux_savr: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          erreur_detail: string | null
          genere_at: string | null
          id: string
          pdf_fichier_id: string | null
          statut: Database["plateforme"]["Enums"]["document_general_statut"]
          type_document: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          erreur_detail?: string | null
          genere_at?: string | null
          id?: string
          pdf_fichier_id?: string | null
          statut?: Database["plateforme"]["Enums"]["document_general_statut"]
          type_document: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          erreur_detail?: string | null
          genere_at?: string | null
          id?: string
          pdf_fichier_id?: string | null
          statut?: Database["plateforme"]["Enums"]["document_general_statut"]
          type_document?: string
          updated_at?: string
        }
        Relationships: []
      }
      domaines_email_publics: {
        Row: {
          created_at: string
          domaine: string
        }
        Insert: {
          created_at?: string
          domaine: string
        }
        Update: {
          created_at?: string
          domaine?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          actif: boolean
          code: string
          corps_html: string
          corps_texte: string | null
          created_at: string
          description: string | null
          id: string
          sujet: string
          updated_at: string
          variables: string[] | null
        }
        Insert: {
          actif?: boolean
          code: string
          corps_html: string
          corps_texte?: string | null
          created_at?: string
          description?: string | null
          id?: string
          sujet: string
          updated_at?: string
          variables?: string[] | null
        }
        Update: {
          actif?: boolean
          code?: string
          corps_html?: string
          corps_texte?: string | null
          created_at?: string
          description?: string | null
          id?: string
          sujet?: string
          updated_at?: string
          variables?: string[] | null
        }
        Relationships: []
      }
      emails_envoyes: {
        Row: {
          created_at: string
          destinataire: string
          entity_id: string | null
          entity_type: string | null
          envoye_at: string | null
          erreur: string | null
          id: string
          resend_id: string | null
          statut: Database["plateforme"]["Enums"]["email_statut_enum"]
          sujet: string
          template_code: string
        }
        Insert: {
          created_at?: string
          destinataire: string
          entity_id?: string | null
          entity_type?: string | null
          envoye_at?: string | null
          erreur?: string | null
          id?: string
          resend_id?: string | null
          statut?: Database["plateforme"]["Enums"]["email_statut_enum"]
          sujet: string
          template_code: string
        }
        Update: {
          created_at?: string
          destinataire?: string
          entity_id?: string | null
          entity_type?: string | null
          envoye_at?: string | null
          erreur?: string | null
          id?: string
          resend_id?: string | null
          statut?: Database["plateforme"]["Enums"]["email_statut_enum"]
          sujet?: string
          template_code?: string
        }
        Relationships: []
      }
      entites_facturation: {
        Row: {
          actif: boolean
          adresse_facturation: string
          code_postal: string
          commentaires: string | null
          conditions_paiement_jours: number
          contact_compta_nom: string | null
          created_at: string
          email_facturation: string | null
          entite_par_defaut: boolean
          id: string
          mode_paiement: Database["plateforme"]["Enums"]["mode_paiement"] | null
          organisation_id: string
          pays: string
          pennylane_customer_id: string | null
          raison_sociale: string
          siret: string
          siret_verification: Database["plateforme"]["Enums"]["statut_verification_siret"]
          siret_verifie_le: string | null
          tva_intracom: string | null
          tva_verification: Database["plateforme"]["Enums"]["statut_verification_tva"]
          tva_verifiee_le: string | null
          updated_at: string
          ville: string
        }
        Insert: {
          actif?: boolean
          adresse_facturation: string
          code_postal: string
          commentaires?: string | null
          conditions_paiement_jours?: number
          contact_compta_nom?: string | null
          created_at?: string
          email_facturation?: string | null
          entite_par_defaut?: boolean
          id?: string
          mode_paiement?:
            | Database["plateforme"]["Enums"]["mode_paiement"]
            | null
          organisation_id: string
          pays?: string
          pennylane_customer_id?: string | null
          raison_sociale: string
          siret: string
          siret_verification?: Database["plateforme"]["Enums"]["statut_verification_siret"]
          siret_verifie_le?: string | null
          tva_intracom?: string | null
          tva_verification?: Database["plateforme"]["Enums"]["statut_verification_tva"]
          tva_verifiee_le?: string | null
          updated_at?: string
          ville: string
        }
        Update: {
          actif?: boolean
          adresse_facturation?: string
          code_postal?: string
          commentaires?: string | null
          conditions_paiement_jours?: number
          contact_compta_nom?: string | null
          created_at?: string
          email_facturation?: string | null
          entite_par_defaut?: boolean
          id?: string
          mode_paiement?:
            | Database["plateforme"]["Enums"]["mode_paiement"]
            | null
          organisation_id?: string
          pays?: string
          pennylane_customer_id?: string | null
          raison_sociale?: string
          siret?: string
          siret_verification?: Database["plateforme"]["Enums"]["statut_verification_siret"]
          siret_verifie_le?: string | null
          tva_intracom?: string | null
          tva_verification?: Database["plateforme"]["Enums"]["statut_verification_tva"]
          tva_verifiee_le?: string | null
          updated_at?: string
          ville?: string
        }
        Relationships: [
          {
            foreignKeyName: "entites_facturation_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entites_facturation_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      evenements: {
        Row: {
          client_organisateur_organisation_id: string | null
          contact_principal_nom: string
          contact_principal_telephone: string
          contact_secours_nom: string | null
          contact_secours_telephone: string | null
          created_at: string
          created_by: string
          date_evenement: string | null
          entite_facturation_id: string
          id: string
          lieu_id: string
          logo_client_organisateur_url: string | null
          nom_client_organisateur: string | null
          nom_evenement: string | null
          notes_internes: string | null
          organisation_id: string
          pax: number
          reference_affaire: string | null
          traiteur_operationnel_organisation_id: string
          type_evenement_id: string
          updated_at: string
        }
        Insert: {
          client_organisateur_organisation_id?: string | null
          contact_principal_nom: string
          contact_principal_telephone: string
          contact_secours_nom?: string | null
          contact_secours_telephone?: string | null
          created_at?: string
          created_by: string
          date_evenement?: string | null
          entite_facturation_id: string
          id?: string
          lieu_id: string
          logo_client_organisateur_url?: string | null
          nom_client_organisateur?: string | null
          nom_evenement?: string | null
          notes_internes?: string | null
          organisation_id: string
          pax: number
          reference_affaire?: string | null
          traiteur_operationnel_organisation_id: string
          type_evenement_id: string
          updated_at?: string
        }
        Update: {
          client_organisateur_organisation_id?: string | null
          contact_principal_nom?: string
          contact_principal_telephone?: string
          contact_secours_nom?: string | null
          contact_secours_telephone?: string | null
          created_at?: string
          created_by?: string
          date_evenement?: string | null
          entite_facturation_id?: string
          id?: string
          lieu_id?: string
          logo_client_organisateur_url?: string | null
          nom_client_organisateur?: string | null
          nom_evenement?: string | null
          notes_internes?: string | null
          organisation_id?: string
          pax?: number
          reference_affaire?: string | null
          traiteur_operationnel_organisation_id?: string
          type_evenement_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evenements_client_organisateur_organisation_id_fkey"
            columns: ["client_organisateur_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_client_organisateur_organisation_id_fkey"
            columns: ["client_organisateur_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_entite_facturation_id_fkey"
            columns: ["entite_facturation_id"]
            isOneToOne: false
            referencedRelation: "entites_facturation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "v_lieux_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_traiteur_operationnel_organisation_id_fkey"
            columns: ["traiteur_operationnel_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_traiteur_operationnel_organisation_id_fkey"
            columns: ["traiteur_operationnel_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_type_evenement_id_fkey"
            columns: ["type_evenement_id"]
            isOneToOne: false
            referencedRelation: "types_evenements"
            referencedColumns: ["id"]
          },
        ]
      }
      everest_missions: {
        Row: {
          collecte_id: string
          coursier_nom: string | null
          coursier_telephone: string | null
          cout_everest_ht: number | null
          cree_at: string
          derniere_sync_at: string
          everest_client_id: string | null
          everest_mission_id: string | null
          everest_service_id: number
          id: string
          manual_acceptance_at: string | null
          manual_acceptance_by_user_id: string | null
          manual_acceptance_commentaire: string | null
          manual_acceptance_contact: string | null
          payload_create: Json | null
          payload_latest_update: Json | null
          preuve_course_url: string | null
          push_create_at: string | null
          statut_everest: Database["plateforme"]["Enums"]["statut_mission_everest"]
          tournee_id: string
          vehicule_type_everest: string | null
        }
        Insert: {
          collecte_id: string
          coursier_nom?: string | null
          coursier_telephone?: string | null
          cout_everest_ht?: number | null
          cree_at?: string
          derniere_sync_at?: string
          everest_client_id?: string | null
          everest_mission_id?: string | null
          everest_service_id: number
          id?: string
          manual_acceptance_at?: string | null
          manual_acceptance_by_user_id?: string | null
          manual_acceptance_commentaire?: string | null
          manual_acceptance_contact?: string | null
          payload_create?: Json | null
          payload_latest_update?: Json | null
          preuve_course_url?: string | null
          push_create_at?: string | null
          statut_everest?: Database["plateforme"]["Enums"]["statut_mission_everest"]
          tournee_id: string
          vehicule_type_everest?: string | null
        }
        Update: {
          collecte_id?: string
          coursier_nom?: string | null
          coursier_telephone?: string | null
          cout_everest_ht?: number | null
          cree_at?: string
          derniere_sync_at?: string
          everest_client_id?: string | null
          everest_mission_id?: string | null
          everest_service_id?: number
          id?: string
          manual_acceptance_at?: string | null
          manual_acceptance_by_user_id?: string | null
          manual_acceptance_commentaire?: string | null
          manual_acceptance_contact?: string | null
          payload_create?: Json | null
          payload_latest_update?: Json | null
          preuve_course_url?: string | null
          push_create_at?: string | null
          statut_everest?: Database["plateforme"]["Enums"]["statut_mission_everest"]
          tournee_id?: string
          vehicule_type_everest?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "everest_missions_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everest_missions_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everest_missions_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "everest_missions_tournee_id_fkey"
            columns: ["tournee_id"]
            isOneToOne: true
            referencedRelation: "tournees"
            referencedColumns: ["id"]
          },
        ]
      }
      exports_registre: {
        Row: {
          fichier_id: string | null
          filtres_appliques: Json | null
          format: Database["plateforme"]["Enums"]["export_format"]
          genere_at: string
          id: string
          nb_lignes: number
          organisation_id: string
          periode_debut: string
          periode_fin: string
          type_export: Database["plateforme"]["Enums"]["type_export"]
          user_id: string
        }
        Insert: {
          fichier_id?: string | null
          filtres_appliques?: Json | null
          format?: Database["plateforme"]["Enums"]["export_format"]
          genere_at?: string
          id?: string
          nb_lignes?: number
          organisation_id: string
          periode_debut: string
          periode_fin: string
          type_export?: Database["plateforme"]["Enums"]["type_export"]
          user_id: string
        }
        Update: {
          fichier_id?: string | null
          filtres_appliques?: Json | null
          format?: Database["plateforme"]["Enums"]["export_format"]
          genere_at?: string
          id?: string
          nb_lignes?: number
          organisation_id?: string
          periode_debut?: string
          periode_fin?: string
          type_export?: Database["plateforme"]["Enums"]["type_export"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exports_registre_created_by_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_registre_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exports_registre_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      factures: {
        Row: {
          created_at: string
          date_echeance: string | null
          date_emission: string | null
          date_paiement: string | null
          derniere_tentative_pennylane_at: string | null
          devise: string
          entite_facturation_id: string
          erreur_synchro: string | null
          erreur_synchro_at: string | null
          facture_origine_id: string | null
          id: string
          marge_logistique: number | null
          mode_facturation:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht: number
          montant_ttc: number
          montant_tva: number
          motif_avoir: string | null
          notes: string | null
          numero_facture: string | null
          organisation_id: string
          pack_antgaspi_id: string | null
          pdf_url_pennylane: string | null
          pdf_url_savr: string | null
          pennylane_id: string | null
          pennylane_push_at: string | null
          pennylane_statut: string | null
          periode_debut: string | null
          periode_fin: string | null
          statut: Database["plateforme"]["Enums"]["facture_statut"]
          taux_tva: number
          type: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          date_echeance?: string | null
          date_emission?: string | null
          date_paiement?: string | null
          derniere_tentative_pennylane_at?: string | null
          devise?: string
          entite_facturation_id: string
          erreur_synchro?: string | null
          erreur_synchro_at?: string | null
          facture_origine_id?: string | null
          id?: string
          marge_logistique?: number | null
          mode_facturation?:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht?: number
          montant_ttc?: number
          montant_tva?: number
          motif_avoir?: string | null
          notes?: string | null
          numero_facture?: string | null
          organisation_id: string
          pack_antgaspi_id?: string | null
          pdf_url_pennylane?: string | null
          pdf_url_savr?: string | null
          pennylane_id?: string | null
          pennylane_push_at?: string | null
          pennylane_statut?: string | null
          periode_debut?: string | null
          periode_fin?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"]
          taux_tva?: number
          type?: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          date_echeance?: string | null
          date_emission?: string | null
          date_paiement?: string | null
          derniere_tentative_pennylane_at?: string | null
          devise?: string
          entite_facturation_id?: string
          erreur_synchro?: string | null
          erreur_synchro_at?: string | null
          facture_origine_id?: string | null
          id?: string
          marge_logistique?: number | null
          mode_facturation?:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht?: number
          montant_ttc?: number
          montant_tva?: number
          motif_avoir?: string | null
          notes?: string | null
          numero_facture?: string | null
          organisation_id?: string
          pack_antgaspi_id?: string | null
          pdf_url_pennylane?: string | null
          pdf_url_savr?: string | null
          pennylane_id?: string | null
          pennylane_push_at?: string | null
          pennylane_statut?: string | null
          periode_debut?: string | null
          periode_fin?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"]
          taux_tva?: number
          type?: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "factures_entite_facturation_id_fkey"
            columns: ["entite_facturation_id"]
            isOneToOne: false
            referencedRelation: "entites_facturation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "factures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "v_factures_client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "v_ops_factures_bloquees"
            referencedColumns: ["facture_id"]
          },
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_pack_antgaspi_id_fkey"
            columns: ["pack_antgaspi_id"]
            isOneToOne: false
            referencedRelation: "packs_antgaspi"
            referencedColumns: ["id"]
          },
        ]
      }
      factures_collectes: {
        Row: {
          collecte_id: string | null
          created_at: string
          description: string | null
          designation: string | null
          facture_id: string
          id: string
          libelle_ligne: string | null
          montant_ht: number
          montant_ligne_ht: number | null
          quantite: number
          tarif_applique_id: string | null
          tarif_applique_source:
            | Database["plateforme"]["Enums"]["tarif_source"]
            | null
          tarif_detail: Json | null
          taux_tva: number
        }
        Insert: {
          collecte_id?: string | null
          created_at?: string
          description?: string | null
          designation?: string | null
          facture_id: string
          id?: string
          libelle_ligne?: string | null
          montant_ht?: number
          montant_ligne_ht?: number | null
          quantite?: number
          tarif_applique_id?: string | null
          tarif_applique_source?:
            | Database["plateforme"]["Enums"]["tarif_source"]
            | null
          tarif_detail?: Json | null
          taux_tva?: number
        }
        Update: {
          collecte_id?: string | null
          created_at?: string
          description?: string | null
          designation?: string | null
          facture_id?: string
          id?: string
          libelle_ligne?: string | null
          montant_ht?: number
          montant_ligne_ht?: number | null
          quantite?: number
          tarif_applique_id?: string | null
          tarif_applique_source?:
            | Database["plateforme"]["Enums"]["tarif_source"]
            | null
          tarif_detail?: Json | null
          taux_tva?: number
        }
        Relationships: [
          {
            foreignKeyName: "factures_collectes_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_collectes_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_collectes_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "factures_collectes_facture_id_fkey"
            columns: ["facture_id"]
            isOneToOne: false
            referencedRelation: "factures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_collectes_facture_id_fkey"
            columns: ["facture_id"]
            isOneToOne: false
            referencedRelation: "v_factures_client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_collectes_facture_id_fkey"
            columns: ["facture_id"]
            isOneToOne: false
            referencedRelation: "v_ops_factures_bloquees"
            referencedColumns: ["facture_id"]
          },
        ]
      }
      flux_dechets: {
        Row: {
          actif: boolean
          code: string
          code_dechet_europeen: string | null
          eligible_citeo: boolean | null
          exutoire: string | null
          exutoire_adresse: string | null
          exutoire_siret: string | null
          filiere_valorisation: Database["plateforme"]["Enums"]["filiere_valorisation"]
          id: string
          nom: string
          ordre_affichage: number
          unite_mesure: Database["plateforme"]["Enums"]["unite_mesure"]
        }
        Insert: {
          actif?: boolean
          code: string
          code_dechet_europeen?: string | null
          eligible_citeo?: boolean | null
          exutoire?: string | null
          exutoire_adresse?: string | null
          exutoire_siret?: string | null
          filiere_valorisation: Database["plateforme"]["Enums"]["filiere_valorisation"]
          id?: string
          nom: string
          ordre_affichage?: number
          unite_mesure: Database["plateforme"]["Enums"]["unite_mesure"]
        }
        Update: {
          actif?: boolean
          code?: string
          code_dechet_europeen?: string | null
          eligible_citeo?: boolean | null
          exutoire?: string | null
          exutoire_adresse?: string | null
          exutoire_siret?: string | null
          filiere_valorisation?: Database["plateforme"]["Enums"]["filiere_valorisation"]
          id?: string
          nom?: string
          ordre_affichage?: number
          unite_mesure?: Database["plateforme"]["Enums"]["unite_mesure"]
        }
        Relationships: []
      }
      grilles_tarifaires_zd: {
        Row: {
          actif: boolean
          created_at: string
          description: string | null
          est_defaut: boolean
          id: string
          nom: string
          updated_at: string
          valide_du: string
          valide_jusqu: string | null
        }
        Insert: {
          actif?: boolean
          created_at?: string
          description?: string | null
          est_defaut?: boolean
          id?: string
          nom: string
          updated_at?: string
          valide_du: string
          valide_jusqu?: string | null
        }
        Update: {
          actif?: boolean
          created_at?: string
          description?: string | null
          est_defaut?: boolean
          id?: string
          nom?: string
          updated_at?: string
          valide_du?: string
          valide_jusqu?: string | null
        }
        Relationships: []
      }
      integrations_inbox: {
        Row: {
          created_at: string
          erreur: string | null
          event_id_externe: string | null
          event_type: string
          id: string
          payload: Json
          source: string
          traite: boolean
          traite_at: string | null
        }
        Insert: {
          created_at?: string
          erreur?: string | null
          event_id_externe?: string | null
          event_type: string
          id?: string
          payload: Json
          source: string
          traite?: boolean
          traite_at?: string | null
        }
        Update: {
          created_at?: string
          erreur?: string | null
          event_id_externe?: string | null
          event_type?: string
          id?: string
          payload?: Json
          source?: string
          traite?: boolean
          traite_at?: string | null
        }
        Relationships: []
      }
      integrations_logs: {
        Row: {
          correlation_id: string | null
          created_at: string
          direction: string
          duree_ms: number | null
          endpoint: string | null
          erreur: string | null
          id: string
          integration: string
          methode: string | null
          payload_in: Json | null
          payload_out: Json | null
          statut_http: number | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          direction: string
          duree_ms?: number | null
          endpoint?: string | null
          erreur?: string | null
          id?: string
          integration: string
          methode?: string | null
          payload_in?: Json | null
          payload_out?: Json | null
          statut_http?: number | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          direction?: string
          duree_ms?: number | null
          endpoint?: string | null
          erreur?: string | null
          id?: string
          integration?: string
          methode?: string | null
          payload_in?: Json | null
          payload_out?: Json | null
          statut_http?: number | null
        }
        Relationships: []
      }
      integrations_logs_2026: {
        Row: {
          correlation_id: string | null
          created_at: string
          direction: string
          duree_ms: number | null
          endpoint: string | null
          erreur: string | null
          id: string
          integration: string
          methode: string | null
          payload_in: Json | null
          payload_out: Json | null
          statut_http: number | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          direction: string
          duree_ms?: number | null
          endpoint?: string | null
          erreur?: string | null
          id?: string
          integration: string
          methode?: string | null
          payload_in?: Json | null
          payload_out?: Json | null
          statut_http?: number | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          direction?: string
          duree_ms?: number | null
          endpoint?: string | null
          erreur?: string | null
          id?: string
          integration?: string
          methode?: string | null
          payload_in?: Json | null
          payload_out?: Json | null
          statut_http?: number | null
        }
        Relationships: []
      }
      jobs_pdf: {
        Row: {
          attempts: number
          created_at: string
          entity_id: string
          entity_type: string
          fichier_id: string | null
          id: string
          last_error: string | null
          next_retry_at: string | null
          payload: Json
          statut: string
          type_document: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          entity_id: string
          entity_type: string
          fichier_id?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload?: Json
          statut?: string
          type_document: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          entity_id?: string
          entity_type?: string
          fichier_id?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload?: Json
          statut?: string
          type_document?: string
          updated_at?: string
        }
        Relationships: []
      }
      lieux: {
        Row: {
          acces_details: string | null
          acces_office:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif: boolean
          adresse_acces: string
          code_postal: string
          commentaire_lieu: string | null
          commentaires_internes: string | null
          contraintes_horaires: string | null
          controle_acces_requis_default: boolean
          created_at: string
          email_gestionnaire: string | null
          flux_autorises: string[] | null
          id: string
          latitude: number | null
          longitude: number | null
          nom: string
          nom_alternatif: string | null
          photos_urls: string[] | null
          reference_citeo: boolean
          region: Database["plateforme"]["Enums"]["region"] | null
          siren: string | null
          stationnement:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant: string[] | null
          type_vehicule_max: Database["plateforme"]["Enums"]["type_vehicule"]
          updated_at: string
          ville: string
          volume_max_bacs: number | null
        }
        Insert: {
          acces_details?: string | null
          acces_office?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif?: boolean
          adresse_acces: string
          code_postal: string
          commentaire_lieu?: string | null
          commentaires_internes?: string | null
          contraintes_horaires?: string | null
          controle_acces_requis_default?: boolean
          created_at?: string
          email_gestionnaire?: string | null
          flux_autorises?: string[] | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nom: string
          nom_alternatif?: string | null
          photos_urls?: string[] | null
          reference_citeo?: boolean
          region?: Database["plateforme"]["Enums"]["region"] | null
          siren?: string | null
          stationnement?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant?: string[] | null
          type_vehicule_max: Database["plateforme"]["Enums"]["type_vehicule"]
          updated_at?: string
          ville: string
          volume_max_bacs?: number | null
        }
        Update: {
          acces_details?: string | null
          acces_office?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif?: boolean
          adresse_acces?: string
          code_postal?: string
          commentaire_lieu?: string | null
          commentaires_internes?: string | null
          contraintes_horaires?: string | null
          controle_acces_requis_default?: boolean
          created_at?: string
          email_gestionnaire?: string | null
          flux_autorises?: string[] | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nom?: string
          nom_alternatif?: string | null
          photos_urls?: string[] | null
          reference_citeo?: boolean
          region?: Database["plateforme"]["Enums"]["region"] | null
          siren?: string | null
          stationnement?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant?: string[] | null
          type_vehicule_max?: Database["plateforme"]["Enums"]["type_vehicule"]
          updated_at?: string
          ville?: string
          volume_max_bacs?: number | null
        }
        Relationships: []
      }
      organisations: {
        Row: {
          actif: boolean
          adresse: string | null
          created_at: string
          cree_par_organisation_id: string | null
          email_principal: string | null
          est_shadow: boolean
          grille_tarifaire_zd_id: string | null
          id: string
          logo_url: string | null
          mode_facturation_zd: Database["plateforme"]["Enums"]["mode_facturation_zd_enum"]
          nom: string
          notes_internes: string | null
          raison_sociale: string | null
          siret: string | null
          tarif_refacture_pax_zd: number
          telephone: string | null
          type: Database["plateforme"]["Enums"]["organisation_type"]
          updated_at: string
        }
        Insert: {
          actif?: boolean
          adresse?: string | null
          created_at?: string
          cree_par_organisation_id?: string | null
          email_principal?: string | null
          est_shadow?: boolean
          grille_tarifaire_zd_id?: string | null
          id?: string
          logo_url?: string | null
          mode_facturation_zd?: Database["plateforme"]["Enums"]["mode_facturation_zd_enum"]
          nom: string
          notes_internes?: string | null
          raison_sociale?: string | null
          siret?: string | null
          tarif_refacture_pax_zd?: number
          telephone?: string | null
          type: Database["plateforme"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Update: {
          actif?: boolean
          adresse?: string | null
          created_at?: string
          cree_par_organisation_id?: string | null
          email_principal?: string | null
          est_shadow?: boolean
          grille_tarifaire_zd_id?: string | null
          id?: string
          logo_url?: string | null
          mode_facturation_zd?: Database["plateforme"]["Enums"]["mode_facturation_zd_enum"]
          nom?: string
          notes_internes?: string | null
          raison_sociale?: string | null
          siret?: string | null
          tarif_refacture_pax_zd?: number
          telephone?: string | null
          type?: Database["plateforme"]["Enums"]["organisation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_org_grille_tarifaire"
            columns: ["grille_tarifaire_zd_id"]
            isOneToOne: false
            referencedRelation: "grilles_tarifaires_zd"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_cree_par_organisation_id_fkey"
            columns: ["cree_par_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_cree_par_organisation_id_fkey"
            columns: ["cree_par_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations_domaines_email: {
        Row: {
          created_at: string
          domaine: string
          id: string
          organisation_id: string
          verifie_at: string | null
        }
        Insert: {
          created_at?: string
          domaine: string
          id?: string
          organisation_id: string
          verifie_at?: string | null
        }
        Update: {
          created_at?: string
          domaine?: string
          id?: string
          organisation_id?: string
          verifie_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_domaines_email_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_domaines_email_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations_lieux: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lieu_id: string
          organisation_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lieu_id: string
          organisation_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lieu_id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_org_lieux_lieu"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_org_lieux_lieu"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "v_lieux_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_lieux_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_lieux_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organisations_lieux_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_events: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempts: number
          claimed_until: string | null
          consumer: string | null
          created_at: string
          event_type: string
          id: string
          last_error: string | null
          next_retry_at: string | null
          payload: Json
          processed_at: string | null
          requires_reconciliation: boolean
          seq: number
          statut: Database["plateforme"]["Enums"]["outbox_statut_enum"]
          txid: number
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempts?: number
          claimed_until?: string | null
          consumer?: string | null
          created_at?: string
          event_type: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload: Json
          processed_at?: string | null
          requires_reconciliation?: boolean
          seq?: number
          statut?: Database["plateforme"]["Enums"]["outbox_statut_enum"]
          txid?: number
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempts?: number
          claimed_until?: string | null
          consumer?: string | null
          created_at?: string
          event_type?: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          requires_reconciliation?: boolean
          seq?: number
          statut?: Database["plateforme"]["Enums"]["outbox_statut_enum"]
          txid?: number
        }
        Relationships: []
      }
      packs_antgaspi: {
        Row: {
          commentaires: string | null
          created_at: string
          credits_consommes: number
          credits_initiaux: number
          credits_restants: number | null
          cree_par_user_id: string | null
          date_achat: string
          date_expiration: string | null
          facture_achat_id: string | null
          facture_pack_id: string | null
          id: string
          idempotency_key: string | null
          mode_facturation: string
          montant_total_ht: number | null
          nb_annulees: number
          nb_collectes: number
          nb_utilisees: number
          notes: string | null
          organisation_id: string
          prix_unitaire_ht: number | null
          statut: Database["plateforme"]["Enums"]["pack_statut"]
          tarif_pack_id: string
          type_pack: string
          updated_at: string
        }
        Insert: {
          commentaires?: string | null
          created_at?: string
          credits_consommes?: number
          credits_initiaux: number
          credits_restants?: number | null
          cree_par_user_id?: string | null
          date_achat: string
          date_expiration?: string | null
          facture_achat_id?: string | null
          facture_pack_id?: string | null
          id?: string
          idempotency_key?: string | null
          mode_facturation?: string
          montant_total_ht?: number | null
          nb_annulees?: number
          nb_collectes: number
          nb_utilisees?: number
          notes?: string | null
          organisation_id: string
          prix_unitaire_ht?: number | null
          statut?: Database["plateforme"]["Enums"]["pack_statut"]
          tarif_pack_id: string
          type_pack: string
          updated_at?: string
        }
        Update: {
          commentaires?: string | null
          created_at?: string
          credits_consommes?: number
          credits_initiaux?: number
          credits_restants?: number | null
          cree_par_user_id?: string | null
          date_achat?: string
          date_expiration?: string | null
          facture_achat_id?: string | null
          facture_pack_id?: string | null
          id?: string
          idempotency_key?: string | null
          mode_facturation?: string
          montant_total_ht?: number | null
          nb_annulees?: number
          nb_collectes?: number
          nb_utilisees?: number
          notes?: string | null
          organisation_id?: string
          prix_unitaire_ht?: number | null
          statut?: Database["plateforme"]["Enums"]["pack_statut"]
          tarif_pack_id?: string
          type_pack?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_pack_facture"
            columns: ["facture_pack_id"]
            isOneToOne: false
            referencedRelation: "factures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pack_facture"
            columns: ["facture_pack_id"]
            isOneToOne: false
            referencedRelation: "v_factures_client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pack_facture"
            columns: ["facture_pack_id"]
            isOneToOne: false
            referencedRelation: "v_ops_factures_bloquees"
            referencedColumns: ["facture_id"]
          },
          {
            foreignKeyName: "packs_antgaspi_facture_achat_id_fkey"
            columns: ["facture_achat_id"]
            isOneToOne: false
            referencedRelation: "factures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packs_antgaspi_facture_achat_id_fkey"
            columns: ["facture_achat_id"]
            isOneToOne: false
            referencedRelation: "v_factures_client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packs_antgaspi_facture_achat_id_fkey"
            columns: ["facture_achat_id"]
            isOneToOne: false
            referencedRelation: "v_ops_factures_bloquees"
            referencedColumns: ["facture_id"]
          },
          {
            foreignKeyName: "packs_antgaspi_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packs_antgaspi_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packs_antgaspi_tarif_pack_id_fkey"
            columns: ["tarif_pack_id"]
            isOneToOne: false
            referencedRelation: "tarifs_packs_ag"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_algo: {
        Row: {
          cle: string
          created_at: string
          description: string
          id: string
          motif_derniere_modif: string | null
          type_valeur: string
          updated_at: string
          valeur: Json
          valide_par: string | null
        }
        Insert: {
          cle: string
          created_at?: string
          description: string
          id?: string
          motif_derniere_modif?: string | null
          type_valeur: string
          updated_at?: string
          valeur: Json
          valide_par?: string | null
        }
        Update: {
          cle?: string
          created_at?: string
          description?: string
          id?: string
          motif_derniere_modif?: string | null
          type_valeur?: string
          updated_at?: string
          valeur?: Json
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametres_algo_valide_par_fkey"
            columns: ["valide_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_co2_divers: {
        Row: {
          cle: string
          created_at: string
          description: string
          id: string
          source_donnee: string | null
          unite: string
          updated_at: string
          valeur: number
          valide_par: string | null
        }
        Insert: {
          cle: string
          created_at?: string
          description: string
          id?: string
          source_donnee?: string | null
          unite: string
          updated_at?: string
          valeur: number
          valide_par?: string | null
        }
        Update: {
          cle?: string
          created_at?: string
          description?: string
          id?: string
          source_donnee?: string | null
          unite?: string
          updated_at?: string
          valeur?: number
          valide_par?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametres_co2_divers_valide_par_fkey"
            columns: ["valide_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_facteurs_co2: {
        Row: {
          actif: boolean
          code_flux: Database["plateforme"]["Enums"]["code_flux"]
          commentaire: string | null
          created_at: string
          date_maj: string
          energie_primaire_evitee_kwh_t: number
          fe_evite_kg_t: number
          fe_induit_kg_t: number
          id: string
          nom_flux: string
          source_donnee: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code_flux: Database["plateforme"]["Enums"]["code_flux"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          energie_primaire_evitee_kwh_t?: number
          fe_evite_kg_t: number
          fe_induit_kg_t: number
          id?: string
          nom_flux: string
          source_donnee?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code_flux?: Database["plateforme"]["Enums"]["code_flux"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          energie_primaire_evitee_kwh_t?: number
          fe_evite_kg_t?: number
          fe_induit_kg_t?: number
          id?: string
          nom_flux?: string
          source_donnee?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      parametres_facteurs_co2_ag: {
        Row: {
          actif: boolean
          cle: string
          commentaire: string | null
          created_at: string
          date_maj: string
          facteur_co2_evite_par_repas_kg: number
          id: string
          source_donnee: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          cle: string
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          facteur_co2_evite_par_repas_kg: number
          id?: string
          source_donnee?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          cle?: string
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          facteur_co2_evite_par_repas_kg?: number
          id?: string
          source_donnee?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      parametres_facteurs_co2_ag_history: {
        Row: {
          commentaire_modif: string
          created_at: string
          facteur_apres: number
          facteur_avant: number
          id: string
          modifie_le: string
          modifie_par: string
          parametre_id: string
          source_donnee_apres: string | null
          source_donnee_avant: string | null
        }
        Insert: {
          commentaire_modif: string
          created_at?: string
          facteur_apres: number
          facteur_avant: number
          id?: string
          modifie_le?: string
          modifie_par: string
          parametre_id: string
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Update: {
          commentaire_modif?: string
          created_at?: string
          facteur_apres?: number
          facteur_avant?: number
          id?: string
          modifie_le?: string
          modifie_par?: string
          parametre_id?: string
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametres_facteurs_co2_ag_history_modifie_par_fkey"
            columns: ["modifie_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametres_facteurs_co2_ag_history_parametre_id_fkey"
            columns: ["parametre_id"]
            isOneToOne: false
            referencedRelation: "parametres_facteurs_co2_ag"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_facteurs_co2_history: {
        Row: {
          code_flux: Database["plateforme"]["Enums"]["code_flux"]
          commentaire_modif: string
          created_at: string
          energie_apres: number | null
          energie_avant: number | null
          fe_evite_apres: number
          fe_evite_avant: number
          fe_induit_apres: number
          fe_induit_avant: number
          id: string
          modifie_le: string
          modifie_par: string
          parametre_id: string
          source_donnee_apres: string | null
          source_donnee_avant: string | null
        }
        Insert: {
          code_flux: Database["plateforme"]["Enums"]["code_flux"]
          commentaire_modif: string
          created_at?: string
          energie_apres?: number | null
          energie_avant?: number | null
          fe_evite_apres: number
          fe_evite_avant: number
          fe_induit_apres: number
          fe_induit_avant: number
          id?: string
          modifie_le?: string
          modifie_par: string
          parametre_id: string
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Update: {
          code_flux?: Database["plateforme"]["Enums"]["code_flux"]
          commentaire_modif?: string
          created_at?: string
          energie_apres?: number | null
          energie_avant?: number | null
          fe_evite_apres?: number
          fe_evite_avant?: number
          fe_induit_apres?: number
          fe_induit_avant?: number
          id?: string
          modifie_le?: string
          modifie_par?: string
          parametre_id?: string
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametres_facteurs_co2_history_modifie_par_fkey"
            columns: ["modifie_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametres_facteurs_co2_history_parametre_id_fkey"
            columns: ["parametre_id"]
            isOneToOne: false
            referencedRelation: "parametres_facteurs_co2"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_mix_emballages: {
        Row: {
          actif: boolean
          code_materiau: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire: string | null
          created_at: string
          date_maj: string
          fe_evite_kg_t: number
          fe_induit_kg_t: number
          id: string
          nom_materiau: string
          part_pct: number
          source_donnee: string | null
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code_materiau: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          fe_evite_kg_t: number
          fe_induit_kg_t: number
          id?: string
          nom_materiau: string
          part_pct: number
          source_donnee?: string | null
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code_materiau?: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          fe_evite_kg_t?: number
          fe_induit_kg_t?: number
          id?: string
          nom_materiau?: string
          part_pct?: number
          source_donnee?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      parametres_mix_emballages_history: {
        Row: {
          code_materiau: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire_modif: string
          created_at: string
          fe_evite_apres: number
          fe_evite_avant: number
          fe_induit_apres: number
          fe_induit_avant: number
          id: string
          modifie_le: string
          modifie_par: string
          parametre_id: string
          part_pct_apres: number
          part_pct_avant: number
          source_donnee_apres: string | null
          source_donnee_avant: string | null
        }
        Insert: {
          code_materiau: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire_modif: string
          created_at?: string
          fe_evite_apres: number
          fe_evite_avant: number
          fe_induit_apres: number
          fe_induit_avant: number
          id?: string
          modifie_le?: string
          modifie_par: string
          parametre_id: string
          part_pct_apres: number
          part_pct_avant: number
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Update: {
          code_materiau?: Database["plateforme"]["Enums"]["code_materiau"]
          commentaire_modif?: string
          created_at?: string
          fe_evite_apres?: number
          fe_evite_avant?: number
          fe_induit_apres?: number
          fe_induit_avant?: number
          id?: string
          modifie_le?: string
          modifie_par?: string
          parametre_id?: string
          part_pct_apres?: number
          part_pct_avant?: number
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parametres_mix_emballages_history_modifie_par_fkey"
            columns: ["modifie_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametres_mix_emballages_history_parametre_id_fkey"
            columns: ["parametre_id"]
            isOneToOne: false
            referencedRelation: "parametres_mix_emballages"
            referencedColumns: ["id"]
          },
        ]
      }
      parametres_taux_recyclage: {
        Row: {
          actif: boolean
          code_filiere: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire: string | null
          created_at: string
          date_maj: string
          id: string
          nom_filiere: string
          prestataire: string | null
          source_donnee: string | null
          taux_captation: number
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code_filiere: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          id?: string
          nom_filiere: string
          prestataire?: string | null
          source_donnee?: string | null
          taux_captation: number
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code_filiere?: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire?: string | null
          created_at?: string
          date_maj?: string
          id?: string
          nom_filiere?: string
          prestataire?: string | null
          source_donnee?: string | null
          taux_captation?: number
          updated_at?: string
        }
        Relationships: []
      }
      parametres_taux_recyclage_history: {
        Row: {
          code_filiere: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire_modif: string
          created_at: string
          id: string
          modifie_le: string
          modifie_par: string
          parametre_id: string
          prestataire_apres: string | null
          prestataire_avant: string | null
          source_donnee_apres: string | null
          source_donnee_avant: string | null
          taux_captation_apres: number
          taux_captation_avant: number
        }
        Insert: {
          code_filiere: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire_modif: string
          created_at?: string
          id?: string
          modifie_le?: string
          modifie_par: string
          parametre_id: string
          prestataire_apres?: string | null
          prestataire_avant?: string | null
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
          taux_captation_apres: number
          taux_captation_avant: number
        }
        Update: {
          code_filiere?: Database["plateforme"]["Enums"]["code_filiere"]
          commentaire_modif?: string
          created_at?: string
          id?: string
          modifie_le?: string
          modifie_par?: string
          parametre_id?: string
          prestataire_apres?: string | null
          prestataire_avant?: string | null
          source_donnee_apres?: string | null
          source_donnee_avant?: string | null
          taux_captation_apres?: number
          taux_captation_avant?: number
        }
        Relationships: [
          {
            foreignKeyName: "parametres_taux_recyclage_history_modifie_par_fkey"
            columns: ["modifie_par"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parametres_taux_recyclage_history_parametre_id_fkey"
            columns: ["parametre_id"]
            isOneToOne: false
            referencedRelation: "parametres_taux_recyclage"
            referencedColumns: ["id"]
          },
        ]
      }
      pesees_tournees: {
        Row: {
          created_at: string
          flux_id: string
          id: string
          poids_kg: number
          stop_id: string
          tournee_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          flux_id: string
          id?: string
          poids_kg: number
          stop_id: string
          tournee_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          flux_id?: string
          id?: string
          poids_kg?: number
          stop_id?: string
          tournee_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pesees_tournees_flux_id_fkey"
            columns: ["flux_id"]
            isOneToOne: false
            referencedRelation: "flux_dechets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pesees_tournees_tournee_id_fkey"
            columns: ["tournee_id"]
            isOneToOne: false
            referencedRelation: "tournees"
            referencedColumns: ["id"]
          },
        ]
      }
      rapports_rse: {
        Row: {
          collecte_id: string
          consulte_par_user_at: string | null
          created_at: string
          disponible_a: string
          envoye_at: string | null
          envoye_client: boolean
          evenement_id: string
          filtres_benchmark: Json | null
          genere_at: string | null
          genere_par: Database["plateforme"]["Enums"]["genere_par"] | null
          id: string
          pdf_url: string | null
          regenere_at: string | null
          regenere_par_user_id: string | null
          version: number
        }
        Insert: {
          collecte_id: string
          consulte_par_user_at?: string | null
          created_at?: string
          disponible_a: string
          envoye_at?: string | null
          envoye_client?: boolean
          evenement_id: string
          filtres_benchmark?: Json | null
          genere_at?: string | null
          genere_par?: Database["plateforme"]["Enums"]["genere_par"] | null
          id?: string
          pdf_url?: string | null
          regenere_at?: string | null
          regenere_par_user_id?: string | null
          version?: number
        }
        Update: {
          collecte_id?: string
          consulte_par_user_at?: string | null
          created_at?: string
          disponible_a?: string
          envoye_at?: string | null
          envoye_client?: boolean
          evenement_id?: string
          filtres_benchmark?: Json | null
          genere_at?: string | null
          genere_par?: Database["plateforme"]["Enums"]["genere_par"] | null
          id?: string
          pdf_url?: string | null
          regenere_at?: string | null
          regenere_par_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rapports_rse_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "collectes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rapports_rse_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_collectes_gestionnaire_lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rapports_rse_collecte_id_fkey"
            columns: ["collecte_id"]
            isOneToOne: false
            referencedRelation: "v_registre_dechets"
            referencedColumns: ["collecte_id"]
          },
          {
            foreignKeyName: "rapports_rse_evenement_id_fkey"
            columns: ["evenement_id"]
            isOneToOne: false
            referencedRelation: "evenements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rapports_rse_regenere_par_user_id_fkey"
            columns: ["regenere_par_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences_facturation: {
        Row: {
          annee: number
          dernier_numero: number
          serie: string
          updated_at: string
        }
        Insert: {
          annee: number
          dernier_numero?: number
          serie: string
          updated_at?: string
        }
        Update: {
          annee?: number
          dernier_numero?: number
          serie?: string
          updated_at?: string
        }
        Relationships: []
      }
      tarifs_negocie: {
        Row: {
          activite: Database["plateforme"]["Enums"]["activite_remise"]
          commentaires: string | null
          created_at: string
          gestionnaire_organisation_id: string | null
          id: string
          lieu_id: string | null
          organisation_id: string | null
          remise_pct: number
          scope: Database["plateforme"]["Enums"]["scope_remise"]
          updated_at: string
          valide_du: string
          valide_jusqu_au: string | null
        }
        Insert: {
          activite: Database["plateforme"]["Enums"]["activite_remise"]
          commentaires?: string | null
          created_at?: string
          gestionnaire_organisation_id?: string | null
          id?: string
          lieu_id?: string | null
          organisation_id?: string | null
          remise_pct: number
          scope: Database["plateforme"]["Enums"]["scope_remise"]
          updated_at?: string
          valide_du: string
          valide_jusqu_au?: string | null
        }
        Update: {
          activite?: Database["plateforme"]["Enums"]["activite_remise"]
          commentaires?: string | null
          created_at?: string
          gestionnaire_organisation_id?: string | null
          id?: string
          lieu_id?: string | null
          organisation_id?: string | null
          remise_pct?: number
          scope?: Database["plateforme"]["Enums"]["scope_remise"]
          updated_at?: string
          valide_du?: string
          valide_jusqu_au?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifs_negocie_gestionnaire_organisation_id_fkey"
            columns: ["gestionnaire_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifs_negocie_gestionnaire_organisation_id_fkey"
            columns: ["gestionnaire_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifs_negocie_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifs_negocie_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "v_lieux_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifs_negocie_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarifs_negocie_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      tarifs_packs_ag: {
        Row: {
          actif: boolean
          commentaire: string | null
          created_at: string
          credits: number
          id: string
          mensualisable: boolean
          montant_total_ht: number | null
          nb_collectes: number
          nb_mensualites: number | null
          prix_ht: number
          prix_unitaire_ht: number
          type_pack: string
          valide_du: string
          valide_jusqu: string | null
          valide_jusqu_au: string | null
        }
        Insert: {
          actif?: boolean
          commentaire?: string | null
          created_at?: string
          credits: number
          id?: string
          mensualisable?: boolean
          montant_total_ht?: number | null
          nb_collectes: number
          nb_mensualites?: number | null
          prix_ht: number
          prix_unitaire_ht: number
          type_pack: string
          valide_du: string
          valide_jusqu?: string | null
          valide_jusqu_au?: string | null
        }
        Update: {
          actif?: boolean
          commentaire?: string | null
          created_at?: string
          credits?: number
          id?: string
          mensualisable?: boolean
          montant_total_ht?: number | null
          nb_collectes?: number
          nb_mensualites?: number | null
          prix_ht?: number
          prix_unitaire_ht?: number
          type_pack?: string
          valide_du?: string
          valide_jusqu?: string | null
          valide_jusqu_au?: string | null
        }
        Relationships: []
      }
      tarifs_zero_dechet: {
        Row: {
          created_at: string
          grille_id: string
          id: string
          pax_max: number | null
          pax_min: number
          prix_base_ht: number
          prix_par_couvert_ht: number | null
        }
        Insert: {
          created_at?: string
          grille_id: string
          id?: string
          pax_max?: number | null
          pax_min: number
          prix_base_ht: number
          prix_par_couvert_ht?: number | null
        }
        Update: {
          created_at?: string
          grille_id?: string
          id?: string
          pax_max?: number | null
          pax_min?: number
          prix_base_ht?: number
          prix_par_couvert_ht?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tarifs_zero_dechet_grille_id_fkey"
            columns: ["grille_id"]
            isOneToOne: false
            referencedRelation: "grilles_tarifaires_zd"
            referencedColumns: ["id"]
          },
        ]
      }
      tournees: {
        Row: {
          chauffeur_nom: string | null
          chauffeur_telephone: string | null
          created_at: string
          creneau: Database["plateforme"]["Enums"]["creneau"]
          date_tournee: string
          external_ref_commande: string | null
          heure_debut_prevue: string | null
          heure_debut_reelle: string | null
          heure_fin_prevue: string | null
          heure_fin_reelle: string | null
          id: string
          notes_internes: string | null
          plaque_immatriculation: string | null
          plaque_saisie_at: string | null
          prestataire_logistique_id: string
          reference_interne: string
          statut: Database["plateforme"]["Enums"]["tournee_statut"]
          tms_reference: string | null
          type_vehicule: Database["plateforme"]["Enums"]["type_vehicule"] | null
          updated_at: string
        }
        Insert: {
          chauffeur_nom?: string | null
          chauffeur_telephone?: string | null
          created_at?: string
          creneau: Database["plateforme"]["Enums"]["creneau"]
          date_tournee: string
          external_ref_commande?: string | null
          heure_debut_prevue?: string | null
          heure_debut_reelle?: string | null
          heure_fin_prevue?: string | null
          heure_fin_reelle?: string | null
          id?: string
          notes_internes?: string | null
          plaque_immatriculation?: string | null
          plaque_saisie_at?: string | null
          prestataire_logistique_id: string
          reference_interne: string
          statut?: Database["plateforme"]["Enums"]["tournee_statut"]
          tms_reference?: string | null
          type_vehicule?:
            | Database["plateforme"]["Enums"]["type_vehicule"]
            | null
          updated_at?: string
        }
        Update: {
          chauffeur_nom?: string | null
          chauffeur_telephone?: string | null
          created_at?: string
          creneau?: Database["plateforme"]["Enums"]["creneau"]
          date_tournee?: string
          external_ref_commande?: string | null
          heure_debut_prevue?: string | null
          heure_debut_reelle?: string | null
          heure_fin_prevue?: string | null
          heure_fin_reelle?: string | null
          id?: string
          notes_internes?: string | null
          plaque_immatriculation?: string | null
          plaque_saisie_at?: string | null
          prestataire_logistique_id?: string
          reference_interne?: string
          statut?: Database["plateforme"]["Enums"]["tournee_statut"]
          tms_reference?: string | null
          type_vehicule?:
            | Database["plateforme"]["Enums"]["type_vehicule"]
            | null
          updated_at?: string
        }
        Relationships: []
      }
      transporteurs: {
        Row: {
          actif: boolean
          adresse: string
          code_postal: string
          code_transporteur_mts1: string | null
          commentaires_internes: string | null
          contact_email: string
          contact_nom: string
          contact_telephone: string
          created_at: string
          derniere_verification: string | null
          id: string
          latitude: number | null
          longitude: number | null
          nom: string
          siren: string
          tarif_par_course: number | null
          type_tms: Database["plateforme"]["Enums"]["type_tms"]
          types_vehicules: string[]
          ville: string
        }
        Insert: {
          actif?: boolean
          adresse: string
          code_postal: string
          code_transporteur_mts1?: string | null
          commentaires_internes?: string | null
          contact_email: string
          contact_nom: string
          contact_telephone: string
          created_at?: string
          derniere_verification?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nom: string
          siren: string
          tarif_par_course?: number | null
          type_tms: Database["plateforme"]["Enums"]["type_tms"]
          types_vehicules: string[]
          ville: string
        }
        Update: {
          actif?: boolean
          adresse?: string
          code_postal?: string
          code_transporteur_mts1?: string | null
          commentaires_internes?: string | null
          contact_email?: string
          contact_nom?: string
          contact_telephone?: string
          created_at?: string
          derniere_verification?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          nom?: string
          siren?: string
          tarif_par_course?: number | null
          type_tms?: Database["plateforme"]["Enums"]["type_tms"]
          types_vehicules?: string[]
          ville?: string
        }
        Relationships: []
      }
      types_evenements: {
        Row: {
          actif: boolean
          code: string
          created_at: string
          id: string
          libelle: string
          ordre_affichage: number
          updated_at: string
        }
        Insert: {
          actif?: boolean
          code: string
          created_at?: string
          id?: string
          libelle: string
          ordre_affichage?: number
          updated_at?: string
        }
        Update: {
          actif?: boolean
          code?: string
          created_at?: string
          id?: string
          libelle?: string
          ordre_affichage?: number
          updated_at?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          actif: boolean
          created_at: string
          derniere_connexion: string | null
          email: string
          id: string
          nom: string
          organisation_id: string
          prenom: string
          role: Database["plateforme"]["Enums"]["user_role"]
        }
        Insert: {
          actif?: boolean
          created_at?: string
          derniere_connexion?: string | null
          email: string
          id: string
          nom: string
          organisation_id: string
          prenom: string
          role: Database["plateforme"]["Enums"]["user_role"]
        }
        Update: {
          actif?: boolean
          created_at?: string
          derniere_connexion?: string | null
          email?: string
          id?: string
          nom?: string
          organisation_id?: string
          prenom?: string
          role?: Database["plateforme"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mv_benchmark_kg_pax_zd_base: {
        Row: {
          bracket: string | null
          flux_code: string | null
          median_kg_pax: number | null
          nb_collectes: number | null
        }
        Relationships: []
      }
      v_collectes_gestionnaire_lieux: {
        Row: {
          aucun_repas_motif: string | null
          aucun_repas_photo_url: string | null
          co2_evite_kg: number | null
          co2_induit_kg: number | null
          co2_net_kg: number | null
          controle_acces_requis: boolean | null
          created_at: string | null
          date_collecte: string | null
          energie_primaire_evitee_kwh: number | null
          evenement_id: string | null
          heure_collecte: string | null
          heure_debut_reelle: string | null
          heure_fin_reelle: string | null
          id: string | null
          informations_supplementaires: string | null
          motif_incident: string | null
          prestataire_logistique_id: string | null
          realisee_at: string | null
          statut: Database["plateforme"]["Enums"]["collecte_statut"] | null
          statut_tms:
            | Database["plateforme"]["Enums"]["collecte_statut_tms"]
            | null
          statut_tms_at: string | null
          taux_recyclage: number | null
          type: Database["plateforme"]["Enums"]["collecte_type"] | null
          updated_at: string | null
          volume_estime_repas: number | null
        }
        Insert: {
          aucun_repas_motif?: string | null
          aucun_repas_photo_url?: string | null
          co2_evite_kg?: number | null
          co2_induit_kg?: number | null
          co2_net_kg?: number | null
          controle_acces_requis?: boolean | null
          created_at?: string | null
          date_collecte?: string | null
          energie_primaire_evitee_kwh?: number | null
          evenement_id?: string | null
          heure_collecte?: string | null
          heure_debut_reelle?: string | null
          heure_fin_reelle?: string | null
          id?: string | null
          informations_supplementaires?: string | null
          motif_incident?: string | null
          prestataire_logistique_id?: string | null
          realisee_at?: string | null
          statut?: Database["plateforme"]["Enums"]["collecte_statut"] | null
          statut_tms?:
            | Database["plateforme"]["Enums"]["collecte_statut_tms"]
            | null
          statut_tms_at?: string | null
          taux_recyclage?: number | null
          type?: Database["plateforme"]["Enums"]["collecte_type"] | null
          updated_at?: string | null
          volume_estime_repas?: number | null
        }
        Update: {
          aucun_repas_motif?: string | null
          aucun_repas_photo_url?: string | null
          co2_evite_kg?: number | null
          co2_induit_kg?: number | null
          co2_net_kg?: number | null
          controle_acces_requis?: boolean | null
          created_at?: string | null
          date_collecte?: string | null
          energie_primaire_evitee_kwh?: number | null
          evenement_id?: string | null
          heure_collecte?: string | null
          heure_debut_reelle?: string | null
          heure_fin_reelle?: string | null
          id?: string | null
          informations_supplementaires?: string | null
          motif_incident?: string | null
          prestataire_logistique_id?: string | null
          realisee_at?: string | null
          statut?: Database["plateforme"]["Enums"]["collecte_statut"] | null
          statut_tms?:
            | Database["plateforme"]["Enums"]["collecte_statut_tms"]
            | null
          statut_tms_at?: string | null
          taux_recyclage?: number | null
          type?: Database["plateforme"]["Enums"]["collecte_type"] | null
          updated_at?: string | null
          volume_estime_repas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collectes_evenement_id_fkey"
            columns: ["evenement_id"]
            isOneToOne: false
            referencedRelation: "evenements"
            referencedColumns: ["id"]
          },
        ]
      }
      v_factures_client: {
        Row: {
          created_at: string | null
          date_echeance: string | null
          date_emission: string | null
          date_paiement: string | null
          devise: string | null
          entite_facturation_id: string | null
          facture_origine_id: string | null
          id: string | null
          mode_facturation:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht: number | null
          montant_ttc: number | null
          montant_tva: number | null
          motif_avoir: string | null
          notes: string | null
          numero_facture: string | null
          organisation_id: string | null
          pack_antgaspi_id: string | null
          pdf_url_pennylane: string | null
          pdf_url_savr: string | null
          pennylane_id: string | null
          periode_debut: string | null
          periode_fin: string | null
          statut: Database["plateforme"]["Enums"]["facture_statut"] | null
          taux_tva: number | null
          type: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date_echeance?: string | null
          date_emission?: string | null
          date_paiement?: string | null
          devise?: string | null
          entite_facturation_id?: string | null
          facture_origine_id?: string | null
          id?: string | null
          mode_facturation?:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht?: number | null
          montant_ttc?: number | null
          montant_tva?: number | null
          motif_avoir?: string | null
          notes?: string | null
          numero_facture?: string | null
          organisation_id?: string | null
          pack_antgaspi_id?: string | null
          pdf_url_pennylane?: string | null
          pdf_url_savr?: string | null
          pennylane_id?: string | null
          periode_debut?: string | null
          periode_fin?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"] | null
          taux_tva?: number | null
          type?: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date_echeance?: string | null
          date_emission?: string | null
          date_paiement?: string | null
          devise?: string | null
          entite_facturation_id?: string | null
          facture_origine_id?: string | null
          id?: string | null
          mode_facturation?:
            | Database["plateforme"]["Enums"]["facture_mode"]
            | null
          montant_ht?: number | null
          montant_ttc?: number | null
          montant_tva?: number | null
          motif_avoir?: string | null
          notes?: string | null
          numero_facture?: string | null
          organisation_id?: string | null
          pack_antgaspi_id?: string | null
          pdf_url_pennylane?: string | null
          pdf_url_savr?: string | null
          pennylane_id?: string | null
          periode_debut?: string | null
          periode_fin?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"] | null
          taux_tva?: number | null
          type?: Database["plateforme"]["Enums"]["facture_type"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "factures_entite_facturation_id_fkey"
            columns: ["entite_facturation_id"]
            isOneToOne: false
            referencedRelation: "entites_facturation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "factures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "v_factures_client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_facture_origine_id_fkey"
            columns: ["facture_origine_id"]
            isOneToOne: false
            referencedRelation: "v_ops_factures_bloquees"
            referencedColumns: ["facture_id"]
          },
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_pack_antgaspi_id_fkey"
            columns: ["pack_antgaspi_id"]
            isOneToOne: false
            referencedRelation: "packs_antgaspi"
            referencedColumns: ["id"]
          },
        ]
      }
      v_kpi_admin: {
        Row: {
          mois: string | null
          montant_factures_ht: number | null
          nb_cloturees: number | null
          nb_collectes: number | null
          type_collecte: string | null
        }
        Relationships: []
      }
      v_kpi_client_organisateur: {
        Row: {
          co2_evite_kg: number | null
          co2_induit_kg: number | null
          co2_net_kg: number | null
          energie_primaire_evitee_kwh: number | null
          mois: string | null
          nb_collectes: number | null
          nb_evenements: number | null
          nb_repas_donnes: number | null
          organisation_id: string | null
          taux_recyclage_pondere: number | null
          tonnage_kg: number | null
          type_collecte: Database["plateforme"]["Enums"]["collecte_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "evenements_client_organisateur_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_client_organisateur_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      v_kpi_lieu: {
        Row: {
          co2_evite_kg: number | null
          co2_net_kg: number | null
          lieu_id: string | null
          mois: string | null
          nb_collectes: number | null
          nb_repas_donnes: number | null
          taux_recyclage_pondere: number | null
          tonnage_kg: number | null
          type_collecte: Database["plateforme"]["Enums"]["collecte_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "v_lieux_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      v_kpi_traiteur: {
        Row: {
          co2_evite_kg: number | null
          co2_induit_kg: number | null
          co2_net_kg: number | null
          energie_primaire_evitee_kwh: number | null
          marge_zd_ht: number | null
          mois: string | null
          nb_collectes: number | null
          nb_repas_donnes: number | null
          organisation_id: string | null
          pax_total: number | null
          taux_recyclage_pondere: number | null
          tonnage_kg: number | null
          type_collecte: Database["plateforme"]["Enums"]["collecte_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      v_lieux_clients: {
        Row: {
          acces_details: string | null
          acces_office:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif: boolean | null
          adresse_acces: string | null
          code_postal: string | null
          contraintes_horaires: string | null
          controle_acces_requis_default: boolean | null
          created_at: string | null
          flux_autorises: string[] | null
          id: string | null
          latitude: number | null
          longitude: number | null
          nom: string | null
          nom_alternatif: string | null
          photos_urls: string[] | null
          region: Database["plateforme"]["Enums"]["region"] | null
          stationnement:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant: string[] | null
          type_vehicule_max:
            | Database["plateforme"]["Enums"]["type_vehicule"]
            | null
          updated_at: string | null
          ville: string | null
          volume_max_bacs: number | null
        }
        Insert: {
          acces_details?: string | null
          acces_office?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif?: boolean | null
          adresse_acces?: string | null
          code_postal?: string | null
          contraintes_horaires?: string | null
          controle_acces_requis_default?: boolean | null
          created_at?: string | null
          flux_autorises?: string[] | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          nom?: string | null
          nom_alternatif?: string | null
          photos_urls?: string[] | null
          region?: Database["plateforme"]["Enums"]["region"] | null
          stationnement?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant?: string[] | null
          type_vehicule_max?:
            | Database["plateforme"]["Enums"]["type_vehicule"]
            | null
          updated_at?: string | null
          ville?: string | null
          volume_max_bacs?: number | null
        }
        Update: {
          acces_details?: string | null
          acces_office?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          actif?: boolean | null
          adresse_acces?: string | null
          code_postal?: string | null
          contraintes_horaires?: string | null
          controle_acces_requis_default?: boolean | null
          created_at?: string | null
          flux_autorises?: string[] | null
          id?: string | null
          latitude?: number | null
          longitude?: number | null
          nom?: string | null
          nom_alternatif?: string | null
          photos_urls?: string[] | null
          region?: Database["plateforme"]["Enums"]["region"] | null
          stationnement?:
            | Database["plateforme"]["Enums"]["acces_difficulte"]
            | null
          traiteurs_operant?: string[] | null
          type_vehicule_max?:
            | Database["plateforme"]["Enums"]["type_vehicule"]
            | null
          updated_at?: string | null
          ville?: string | null
          volume_max_bacs?: number | null
        }
        Relationships: []
      }
      v_ops_batchs: {
        Row: {
          dernier_run_at: string | null
          job_name: string | null
          nb_traite: number | null
          statut: string | null
        }
        Relationships: []
      }
      v_ops_factures_bloquees: {
        Row: {
          created_at: string | null
          facture_id: string | null
          heures_sans_retour: number | null
          numero_facture: string | null
          organisation_id: string | null
          statut: Database["plateforme"]["Enums"]["facture_statut"] | null
        }
        Insert: {
          created_at?: string | null
          facture_id?: string | null
          heures_sans_retour?: never
          numero_facture?: string | null
          organisation_id?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"] | null
        }
        Update: {
          created_at?: string | null
          facture_id?: string | null
          heures_sans_retour?: never
          numero_facture?: string | null
          organisation_id?: string | null
          statut?: Database["plateforme"]["Enums"]["facture_statut"] | null
        }
        Relationships: [
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "factures_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ops_integrations: {
        Row: {
          dernier_appel_at: string | null
          nb_echecs_24h: number | null
          service: string | null
        }
        Relationships: []
      }
      v_ops_jobs_pdf: {
        Row: {
          max_attempts: number | null
          nb_dead: number | null
          nb_failed: number | null
          nb_pending: number | null
          plus_ancien_at: string | null
        }
        Relationships: []
      }
      v_ops_outbox: {
        Row: {
          nb_dlq: number | null
          nb_pending: number | null
          nb_processing: number | null
          plus_ancien_at: string | null
        }
        Relationships: []
      }
      v_referentiel_traiteurs: {
        Row: {
          id: string | null
          nom: string | null
          raison_sociale: string | null
        }
        Insert: {
          id?: string | null
          nom?: string | null
          raison_sociale?: string | null
        }
        Update: {
          id?: string | null
          nom?: string | null
          raison_sociale?: string | null
        }
        Relationships: []
      }
      v_registre_dechets: {
        Row: {
          bordereau_date_emission: string | null
          bordereau_id: string | null
          bordereau_numero: string | null
          bordereau_pdf_fichier_id: string | null
          bordereau_statut:
            | Database["plateforme"]["Enums"]["bordereau_statut"]
            | null
          bordereau_version: number | null
          co2_evite_kg: number | null
          co2_induit_kg: number | null
          co2_net_kg: number | null
          collecte_id: string | null
          created_at: string | null
          date_collecte: string | null
          date_evenement: string | null
          evenement_id: string | null
          evenement_nom: string | null
          exutoire_nom: string | null
          flux_codes: string[] | null
          historique_partiel: boolean | null
          lieu_adresse: string | null
          lieu_id: string | null
          lieu_nom: string | null
          pax: number | null
          poids_total_kg: number | null
          prestataire_logistique_id: string | null
          programmateur_organisation_id: string | null
          realisee_at: string | null
          taille_bracket: string | null
          taux_recyclage: number | null
          traiteur_operationnel_organisation_id: string | null
          traiteur_raison_sociale: string | null
          transporteur_nom: string | null
          type_evenement_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collectes_evenement_id_fkey"
            columns: ["evenement_id"]
            isOneToOne: false
            referencedRelation: "evenements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "lieux"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_lieu_id_fkey"
            columns: ["lieu_id"]
            isOneToOne: false
            referencedRelation: "v_lieux_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["programmateur_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_organisation_id_fkey"
            columns: ["programmateur_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_traiteur_operationnel_organisation_id_fkey"
            columns: ["traiteur_operationnel_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_traiteur_operationnel_organisation_id_fkey"
            columns: ["traiteur_operationnel_organisation_id"]
            isOneToOne: false
            referencedRelation: "v_referentiel_traiteurs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evenements_type_evenement_id_fkey"
            columns: ["type_evenement_id"]
            isOneToOne: false
            referencedRelation: "types_evenements"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      f_app_role: { Args: never; Returns: string }
      f_attribuer_numero_facture: {
        Args: { p_annee: number; p_serie: string }
        Returns: string
      }
      f_benchmark_kg_pax_zd: {
        Args: { p_bracket: string; p_flux_code?: string }
        Returns: {
          bracket: string
          flux_code: string
          median_kg_pax: number
          nb_collectes: number
        }[]
      }
      f_benchmark_single_collecte: {
        Args: { p_collecte_id: string }
        Returns: {
          bracket: string
          flux_code: string
          median_kg_pax: number
          nb_collectes: number
          valeur_kg_pax: number
        }[]
      }
      f_collecte_editable: {
        Args: { p_evenement_id: string }
        Returns: boolean
      }
      f_collecte_visible: { Args: { p_collecte_id: string }; Returns: boolean }
      f_completer_siret_shadow: {
        Args: { p_org_id: string; p_siret: string }
        Returns: undefined
      }
      f_dechets_labo_estimes: {
        Args: { p_evenement_id: string }
        Returns: number
      }
      f_is_staff: { Args: never; Returns: boolean }
      f_log_audit: {
        Args: {
          p_action: string
          p_details: Json
          p_impersonator_id: string
          p_motif: string
          p_new_values: Json
          p_old_values: Json
          p_record_id: string
          p_role: string
          p_table_name: string
          p_user_id: string
        }
        Returns: undefined
      }
      f_next_numero_attestation: { Args: { p_annee?: number }; Returns: string }
      f_next_numero_bordereau: { Args: { p_annee?: number }; Returns: string }
      f_next_numero_facture: {
        Args: { p_annee: number; p_serie: string }
        Returns: number
      }
      f_traiteur_intervenu_lieux_gestionnaire: {
        Args: { p_traiteur_id: string }
        Returns: boolean
      }
      f_upsert_alerte_admin: {
        Args: {
          p_code: string
          p_entity_id: string
          p_entity_type: string
          p_message: string
          p_titre: string
        }
        Returns: undefined
      }
      f_volume_repas_realise: {
        Args: { p_collecte_id: string }
        Returns: number
      }
      fn_agreger_terminal_collecte: {
        Args: { p_collecte_id: string }
        Returns: string
      }
      fn_ajouter_collecte_evenement: {
        Args: {
          p_controle_acces?: boolean
          p_date_collecte: string
          p_evenement_id: string
          p_heure_collecte: string
          p_info_suppl?: string
          p_type: string
        }
        Returns: string
      }
      fn_audit_insert: {
        Args: {
          p_action: string
          p_details: Json
          p_motif: string
          p_new_values: Json
          p_old_values: Json
          p_record_id: string
          p_table_name: string
        }
        Returns: undefined
      }
      fn_calculer_algo_attribution_ag: {
        Args: { p_collecte_id: string }
        Returns: Json
      }
      fn_claim_outbox_batch: {
        Args: { p_lease_duration?: string; p_limit?: number }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          attempts: number
          consumer: string
          event_type: string
          id: string
          payload: Json
          requires_reconciliation: boolean
        }[]
      }
      fn_confirmer_programmation_brouillon: {
        Args: { p_evenement_id: string }
        Returns: undefined
      }
      fn_creer_collecte: {
        Args: {
          p_controle_acces?: boolean
          p_date_collecte: string
          p_evenement_id: string
          p_heure_collecte: string
          p_info_suppl?: string
          p_nb_camions?: number
          p_notes?: string
          p_type: string
        }
        Returns: string
      }
      fn_custom_access_token: { Args: { event: Json }; Returns: Json }
      fn_dispatcher_collecte: {
        Args: {
          p_id: string
          p_motif_override?: string
          p_prestataire_logistique_id?: string
        }
        Returns: string
      }
      fn_modifier_collecte: {
        Args: { p_champs_modifies: string[]; p_id: string; p_updates: Json }
        Returns: Json
      }
      fn_reap_outbox_claims: { Args: never; Returns: number }
      fn_result_outbox: {
        Args: {
          p_consumer?: string
          p_id: string
          p_last_error?: string
          p_next_retry_at?: string
          p_requires_reconciliation?: boolean
          p_statut: string
        }
        Returns: undefined
      }
      health_ping: { Args: never; Returns: number }
      refresh_mv_benchmark: { Args: never; Returns: undefined }
      rpc_annuler_credit_collecte: {
        Args: { p_collecte_id: string; p_motif: string }
        Returns: Json
      }
      rpc_valider_attribution_ag: {
        Args: {
          p_association_id: string
          p_branche_attribution: string
          p_collecte_id: string
          p_mode_validation: Database["plateforme"]["Enums"]["mode_validation"]
          p_motif_override?: string
          p_motif_override_libre?: string
          p_transporteur_id: string
          p_valide_par: string
        }
        Returns: Json
      }
      taille_evenement_bracket: { Args: { p_pax: number }; Returns: string }
    }
    Enums: {
      acces_difficulte: "facile" | "difficile" | "tres_difficile"
      activite_remise: "zd" | "ag"
      attestation_statut: "brouillon" | "emise" | "corrigee" | "annulee"
      bordereau_statut: "brouillon" | "emis" | "corrige" | "annule"
      code_filiere: "verre" | "carton" | "biodechet" | "emballage"
      code_flux:
        | "verre"
        | "carton"
        | "biodechet"
        | "emballage"
        | "dechet_residuel"
      code_materiau:
        | "carton_papier"
        | "pet"
        | "pehd"
        | "acier"
        | "alu"
        | "briques"
        | "autres"
      collecte_statut:
        | "brouillon"
        | "programmee"
        | "validee"
        | "en_cours"
        | "realisee"
        | "realisee_sans_collecte"
        | "cloturee"
        | "annulation_demandee"
        | "annulee"
        | "rejetee_par_prestataire"
      collecte_statut_tms:
        | "non_envoye"
        | "a_attribuer"
        | "attribuee_en_attente_acceptation"
        | "acceptee"
        | "en_attente_execution"
        | "rejetee_par_prestataire"
        | "annulee_par_traiteur"
        | "rejetee_par_tms"
      collecte_type: "zero_dechet" | "anti_gaspi"
      creneau: "matin" | "apres_midi" | "soir" | "nuit" | "journee_complete"
      document_general_statut: "en_attente" | "genere" | "erreur" | "expire"
      email_statut_enum: "queued" | "sent" | "delivered" | "bounced" | "failed"
      export_format: "csv" | "zip" | "pdf"
      facture_mode: "par_collecte" | "mensuelle" | "globale_pack"
      facture_statut:
        | "brouillon"
        | "en_attente_pennylane"
        | "emise"
        | "payee"
        | "annulee"
      facture_type:
        | "zero_dechet"
        | "achat_pack_antigaspi"
        | "collecte_antigaspi"
        | "avoir"
      filiere_valorisation:
        | "recyclage"
        | "compostage"
        | "methanisation"
        | "valorisation_energetique"
        | "enfouissement"
        | "don_alimentaire"
      genere_par: "automatique" | "manuel"
      incident_imputable:
        | "prestataire"
        | "client"
        | "association"
        | "savr"
        | "externe"
      mode_facturation_zd_enum: "par_collecte" | "mensuelle"
      mode_paiement: "virement" | "prelevement" | "cb" | "cheque"
      mode_validation: "manuel_top1" | "manuel_override" | "auto_accept"
      organisation_type:
        | "traiteur"
        | "agence"
        | "gestionnaire_lieux"
        | "client_organisateur"
      outbox_statut_enum: "pending" | "processing" | "done" | "failed" | "dead"
      pack_statut: "actif" | "epuise" | "annule"
      region: "idf" | "province"
      scope_remise: "organisation" | "gestionnaire"
      statut_mission_everest:
        | "created"
        | "assigned"
        | "in_progress"
        | "completed"
        | "completed_incomplete"
        | "creation_failed"
        | "failed"
        | "cancelled"
        | "cancelled_externally"
        | "created_manually"
      statut_verification_siret: "en_attente" | "verifie" | "echec"
      statut_verification_tva:
        | "en_attente"
        | "verifie"
        | "echec"
        | "non_applicable"
      tarif_source: "zd_grille" | "ag_unitaire" | "libre"
      tournee_statut: "planifiee" | "en_cours" | "terminee" | "annulee"
      type_export:
        | "registre_dechets"
        | "bordereaux_batch"
        | "attestations_batch"
      type_tms: "mts1" | "a_toutes" | "autre"
      type_vehicule:
        | "velo_cargo"
        | "camionnette"
        | "fourgon"
        | "vul"
        | "poids_lourd"
      unite_mesure: "kg" | "litre" | "bac"
      user_role:
        | "admin_savr"
        | "ops_savr"
        | "traiteur_manager"
        | "traiteur_commercial"
        | "agence"
        | "gestionnaire_lieux"
        | "client_organisateur"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _is_verbose: { Args: never; Returns: boolean }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _retval: { Args: { "": string }; Returns: string }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      format_type_string: { Args: { "": string }; Returns: string }
      has_unique: { Args: { "": string }; Returns: string }
      health_ping: { Args: never; Returns: number }
      in_todo: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      isnt_empty: { Args: { "": string }; Returns: string }
      lives_ok: { Args: { "": string }; Returns: string }
      no_plan: { Args: never; Returns: boolean[] }
      num_failed: { Args: never; Returns: number }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
    }
  }
  shared: {
    Tables: {
      fichiers: {
        Row: {
          bucket: string
          content_hash: string | null
          content_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          entity_type: string
          id: string
          key: string
          size_bytes: number
          storage_provider: Database["shared"]["Enums"]["storage_provider"]
        }
        Insert: {
          bucket: string
          content_hash?: string | null
          content_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          key: string
          size_bytes: number
          storage_provider: Database["shared"]["Enums"]["storage_provider"]
        }
        Update: {
          bucket?: string
          content_hash?: string | null
          content_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          key?: string
          size_bytes?: number
          storage_provider?: Database["shared"]["Enums"]["storage_provider"]
        }
        Relationships: []
      }
      prestataires: {
        Row: {
          adresse_siege: Json | null
          api_config: Json | null
          code: string
          commentaire_interne: string | null
          contact_facturation: Json | null
          contact_operationnel: Json | null
          coords_siege_lat: number | null
          coords_siege_lng: number | null
          created_at: string
          date_fin_contrat: string | null
          id: string
          last_everest_ping_at: string | null
          last_everest_ping_status: string | null
          mode_integration: string
          nb_collectes_6_mois_cache: number
          nom: string
          rayon_intervention_km: number | null
          siret: string | null
          statut: string
          tva_intracom: string | null
          type_prestation: string[]
          updated_at: string
        }
        Insert: {
          adresse_siege?: Json | null
          api_config?: Json | null
          code: string
          commentaire_interne?: string | null
          contact_facturation?: Json | null
          contact_operationnel?: Json | null
          coords_siege_lat?: number | null
          coords_siege_lng?: number | null
          created_at?: string
          date_fin_contrat?: string | null
          id?: string
          last_everest_ping_at?: string | null
          last_everest_ping_status?: string | null
          mode_integration?: string
          nb_collectes_6_mois_cache?: number
          nom: string
          rayon_intervention_km?: number | null
          siret?: string | null
          statut?: string
          tva_intracom?: string | null
          type_prestation?: string[]
          updated_at?: string
        }
        Update: {
          adresse_siege?: Json | null
          api_config?: Json | null
          code?: string
          commentaire_interne?: string | null
          contact_facturation?: Json | null
          contact_operationnel?: Json | null
          coords_siege_lat?: number | null
          coords_siege_lng?: number | null
          created_at?: string
          date_fin_contrat?: string | null
          id?: string
          last_everest_ping_at?: string | null
          last_everest_ping_status?: string | null
          mode_integration?: string
          nb_collectes_6_mois_cache?: number
          nom?: string
          rayon_intervention_km?: number | null
          siret?: string | null
          statut?: string
          tva_intracom?: string | null
          type_prestation?: string[]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      f_fichier_visible: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: boolean
      }
    }
    Enums: {
      storage_provider: "supabase" | "r2"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  plateforme: {
    Enums: {
      acces_difficulte: ["facile", "difficile", "tres_difficile"],
      activite_remise: ["zd", "ag"],
      attestation_statut: ["brouillon", "emise", "corrigee", "annulee"],
      bordereau_statut: ["brouillon", "emis", "corrige", "annule"],
      code_filiere: ["verre", "carton", "biodechet", "emballage"],
      code_flux: [
        "verre",
        "carton",
        "biodechet",
        "emballage",
        "dechet_residuel",
      ],
      code_materiau: [
        "carton_papier",
        "pet",
        "pehd",
        "acier",
        "alu",
        "briques",
        "autres",
      ],
      collecte_statut: [
        "brouillon",
        "programmee",
        "validee",
        "en_cours",
        "realisee",
        "realisee_sans_collecte",
        "cloturee",
        "annulation_demandee",
        "annulee",
        "rejetee_par_prestataire",
      ],
      collecte_statut_tms: [
        "non_envoye",
        "a_attribuer",
        "attribuee_en_attente_acceptation",
        "acceptee",
        "en_attente_execution",
        "rejetee_par_prestataire",
        "annulee_par_traiteur",
        "rejetee_par_tms",
      ],
      collecte_type: ["zero_dechet", "anti_gaspi"],
      creneau: ["matin", "apres_midi", "soir", "nuit", "journee_complete"],
      document_general_statut: ["en_attente", "genere", "erreur", "expire"],
      email_statut_enum: ["queued", "sent", "delivered", "bounced", "failed"],
      export_format: ["csv", "zip", "pdf"],
      facture_mode: ["par_collecte", "mensuelle", "globale_pack"],
      facture_statut: [
        "brouillon",
        "en_attente_pennylane",
        "emise",
        "payee",
        "annulee",
      ],
      facture_type: [
        "zero_dechet",
        "achat_pack_antigaspi",
        "collecte_antigaspi",
        "avoir",
      ],
      filiere_valorisation: [
        "recyclage",
        "compostage",
        "methanisation",
        "valorisation_energetique",
        "enfouissement",
        "don_alimentaire",
      ],
      genere_par: ["automatique", "manuel"],
      incident_imputable: [
        "prestataire",
        "client",
        "association",
        "savr",
        "externe",
      ],
      mode_facturation_zd_enum: ["par_collecte", "mensuelle"],
      mode_paiement: ["virement", "prelevement", "cb", "cheque"],
      mode_validation: ["manuel_top1", "manuel_override", "auto_accept"],
      organisation_type: [
        "traiteur",
        "agence",
        "gestionnaire_lieux",
        "client_organisateur",
      ],
      outbox_statut_enum: ["pending", "processing", "done", "failed", "dead"],
      pack_statut: ["actif", "epuise", "annule"],
      region: ["idf", "province"],
      scope_remise: ["organisation", "gestionnaire"],
      statut_mission_everest: [
        "created",
        "assigned",
        "in_progress",
        "completed",
        "completed_incomplete",
        "creation_failed",
        "failed",
        "cancelled",
        "cancelled_externally",
        "created_manually",
      ],
      statut_verification_siret: ["en_attente", "verifie", "echec"],
      statut_verification_tva: [
        "en_attente",
        "verifie",
        "echec",
        "non_applicable",
      ],
      tarif_source: ["zd_grille", "ag_unitaire", "libre"],
      tournee_statut: ["planifiee", "en_cours", "terminee", "annulee"],
      type_export: [
        "registre_dechets",
        "bordereaux_batch",
        "attestations_batch",
      ],
      type_tms: ["mts1", "a_toutes", "autre"],
      type_vehicule: [
        "velo_cargo",
        "camionnette",
        "fourgon",
        "vul",
        "poids_lourd",
      ],
      unite_mesure: ["kg", "litre", "bac"],
      user_role: [
        "admin_savr",
        "ops_savr",
        "traiteur_manager",
        "traiteur_commercial",
        "agence",
        "gestionnaire_lieux",
        "client_organisateur",
      ],
    },
  },
  public: {
    Enums: {},
  },
  shared: {
    Enums: {
      storage_provider: ["supabase", "r2"],
    },
  },
} as const

