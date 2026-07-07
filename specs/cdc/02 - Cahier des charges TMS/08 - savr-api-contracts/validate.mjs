// Contract tests — compile tous les schémas + valide des payloads exemples (valides + invalides).
// Usage : npm install && npm test
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = dirname(fileURLToPath(import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

// Charge tous les schémas (common + entrants + sortants) par $id.
const dirs = ["schemas", "schemas/entrants", "schemas/sortants"];
const byTitle = {};
for (const d of dirs) {
  for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(join(root, d, f), "utf8"));
    ajv.addSchema(s);
    if (s.title) byTitle[f.split(".")[0]] = s.$id;
  }
}
const V = (key, payload) => ajv.getSchema(byTitle[key])(payload);

const env = (over) => ({
  event_id: "11111111-1111-4111-8111-111111111111",
  occurred_at: "2026-05-10T18:30:00.000Z",
  emis_le: "2026-05-10T18:30:01.123Z",
  ...over,
});
const U = "22222222-2222-4222-8222-222222222222";

const cases = [];
const ok = (n, k, p) => cases.push([n, k, p, true]);
const ko = (n, k, p) => cases.push([n, k, p, false]);

// ---- E1 valide ----
ok("E1 valide", "E1", env({ source: "plateforme", type: "collecte.creee", data: {
  collecte_id: U, evenement_id: U, traiteur_id: U,
  traiteur_operationnel: { organisation_id: U, nom: "Traiteur X", raison_sociale: "X SAS", siret: null, est_shadow: false },
  programmateur: { organisation_id: U, nom: "Agence Y", type: "agence" },
  lieu: { lieu_id: U, nom: "Salle A", adresse: "1 rue", code_postal: "75001", ville: "Paris",
          coordonnees_gps: { lat: 48.85, lng: 2.35 }, stationnement: "difficile", acces_office: "facile",
          type_vehicule_max: "camionnette", volume_max_bacs: 4 },
  contacts: { principal: { nom: "Jean", telephone: "0600000000" } },
  heure_collecte: { date: "2026-05-10", heure: "18:30", fuseau: "Europe/Paris" },
  type_collecte: "zd", nb_pax: 250, controle_acces_requis: false }}));
// ---- E1 invalides ----
ko("E1 enum type_vehicule_max périmé (camion_16m3)", "E1", env({ source: "plateforme", type: "collecte.creee", data: {
  collecte_id: U, evenement_id: U, traiteur_id: U,
  traiteur_operationnel: { organisation_id: U, nom: "X", raison_sociale: "X", siret: null, est_shadow: false },
  programmateur: { organisation_id: U, nom: "X", type: "traiteur" },
  lieu: { lieu_id: U, nom: "A", adresse: "1", code_postal: "75001", ville: "Paris", type_vehicule_max: "camion_16m3" },
  contacts: { principal: { nom: "J", telephone: "06" } },
  heure_collecte: { date: "2026-05-10", heure: "18:30", fuseau: "Europe/Paris" },
  type_collecte: "zd", nb_pax: 10, controle_acces_requis: false }}));
ko("E1 champ inconnu (strict)", "E1", env({ source: "plateforme", type: "collecte.creee", data: {
  collecte_id: U, evenement_id: U, traiteur_id: U,
  traiteur_operationnel: { organisation_id: U, nom: "X", raison_sociale: "X", siret: null, est_shadow: false },
  programmateur: { organisation_id: U, nom: "X", type: "traiteur" },
  lieu: { lieu_id: U, nom: "A", adresse: "1", code_postal: "75001", ville: "Paris" },
  contacts: { principal: { nom: "J", telephone: "06" } },
  heure_collecte: { date: "2026-05-10", heure: "18:30", fuseau: "Europe/Paris" },
  type_collecte: "zd", nb_pax: 10, controle_acces_requis: false, prestataire_id_pre_affecte: U }}));

// ---- E2 ----
ok("E2 valide diff date", "E2", env({ source: "plateforme", type: "collecte.modifiee", data: {
  collecte_id: U, modifie_par_user_id: U,
  diff: { date_collecte: { ancien: "2026-05-15", nouveau: "2026-05-16" }, heure_collecte: { ancien: "14:00", nouveau: "16:30" } } }}));
ko("E2 diff vide", "E2", env({ source: "plateforme", type: "collecte.modifiee", data: {
  collecte_id: U, modifie_par_user_id: U, diff: {} }}));

// ---- E3 / E5 ----
ok("E3 valide", "E3", env({ source: "plateforme", type: "collecte.annulee", data: {
  collecte_id: U, motif: "annulation client", annule_par_user_id: U, annule_le: "2026-05-09T10:00:00Z" }}));
ok("E5 valide", "E5", env({ source: "plateforme", type: "lieu.upsert", data: {
  lieu_id: U, champs_modifies: ["adresse"], nouvelle_valeur_snapshot: { nom: "A", adresse: "2 rue", code_postal: "75002", ville: "Paris", coordonnees_gps: { lat: 48.8, lng: 2.3 } }, modifie_le: "2026-05-09T10:00:00Z" }}));

// ---- S1 ----
ok("S1 valide Strike", "S1", env({ source: "tms", type: "collecte.acceptee", data: {
  collecte_id: U, prestataire_id: U, chauffeur: { chauffeur_id: U, nom: "Dupont", prenom: "Jean" },
  vehicule: { vehicule_id: U, type: "camion_16m3", plaque: "AA-123-BB" }, acceptee_le: "2026-05-09T10:00:00Z" }}));
ok("S1 valide A Toutes! (nulls)", "S1", env({ source: "tms", type: "collecte.acceptee", data: {
  collecte_id: U, prestataire_id: U, chauffeur: { chauffeur_id: null, nom: "Coursier" },
  vehicule: { vehicule_id: null, type: "velo_cargo", plaque: null }, acceptee_le: "2026-05-09T10:00:00Z" }}));

// ---- S2 / S3 / S4 ----
ok("S2 valide", "S2", env({ source: "tms", type: "collecte.refusee", data: { collecte_id: U, prestataire_id: U, motif: "complet", refusee_le: "2026-05-09T10:00:00Z" }}));
ok("S3 valide", "S3", env({ source: "tms", type: "tournee.upsert", data: {
  tournee_id: U, prestataire_id: U, collecte_ids: [U], heure_debut_prevue: "2026-05-10T18:30:00Z", heure_fin_prevue: "2026-05-10T22:30:00Z",
  statut: "planifiee", chauffeur_id: U, vehicule_id: U, type_vehicule_categorie_plateforme: "camionnette" }}));
ok("S4 valide", "S4", env({ source: "tms", type: "collecte.en_cours", data: { collecte_id: U, tournee_id: U, demarree_le: "2026-05-10T18:32:00Z", chauffeur_id: U }}));

// ---- S5 ----
ok("S5 realisee + pesee", "S5", env({ source: "tms", type: "collecte.terminee", data: {
  collecte_id: U, tournee_id: U, terminee_le: "2026-05-10T19:45:00Z", type: "cloture", statut_final: "realisee",
  pesees: [{ pesee_id: U, idempotency_key: U, type_flux: "biodechet", poids_brut_kg: 45.20, tare_kg: 5.00, poids_net_kg: 40.20, source: "chauffeur" }],
  rolls: { pleins_recuperes: 4, vides_laisses: 2 } }}));
ko("S5 realisee SANS pesee", "S5", env({ source: "tms", type: "collecte.terminee", data: {
  collecte_id: U, tournee_id: U, terminee_le: "2026-05-10T19:45:00Z", type: "cloture", statut_final: "realisee", pesees: [] }}));
ok("S5 sans collecte (AG)", "S5", env({ source: "tms", type: "collecte.terminee", data: {
  collecte_id: U, tournee_id: U, terminee_le: "2026-05-10T19:45:00Z", type: "cloture", statut_final: "realisee_sans_collecte",
  pesees: [], aucun_repas: { motif_chauffeur: "rien", photo_lieu_url: "https://x/p.jpg" } }}));
ko("S5 sans collecte mais avec pesee", "S5", env({ source: "tms", type: "collecte.terminee", data: {
  collecte_id: U, tournee_id: U, terminee_le: "2026-05-10T19:45:00Z", type: "cloture", statut_final: "realisee_sans_collecte",
  pesees: [{ pesee_id: U, idempotency_key: U, type_flux: "don_alimentaire", poids_brut_kg: 1.00, tare_kg: 0, poids_net_kg: 1.00, source: "chauffeur" }],
  aucun_repas: { motif_chauffeur: "x", photo_lieu_url: "https://x/p.jpg" } }}));

// ---- S7 / S9 / S11 ----
ok("S7 valide", "S7", env({ source: "tms", type: "tournee.plaque_saisie", data: { tournee_id: U, plaque: "AA-123-BB", chauffeur_nom: "Jean Dupont", saisie_par_user_id: U, saisie_at: "2026-05-10T14:00:00Z" }}));
ok("S7 vélo cargo plaque null", "S7", env({ source: "tms", type: "tournee.plaque_saisie", data: { tournee_id: U, plaque: null, chauffeur_nom: "Coursier", saisie_par_user_id: U, saisie_at: "2026-05-10T14:00:00Z" }}));
ok("S9 valide", "S9", env({ source: "tms", type: "incident.declare", data: {
  incident_id: U, idempotency_key: U, collecte_id: U, tournee_id: U, type_incident: "acces_refuse", gravite: "critical",
  description: "portail fermé", declare_le: "2026-05-10T18:45:00Z", chauffeur_id: U, statut_collecte_apres: "echec_acces", geofence_status: "sur_place" }}));
ko("S9 gravite=info (retirée)", "S9", env({ source: "tms", type: "incident.declare", data: {
  incident_id: U, idempotency_key: U, tournee_id: U, type_incident: "autre", gravite: "info",
  declare_le: "2026-05-10T18:45:00Z", chauffeur_id: U, statut_collecte_apres: "inchange" }}));
ok("S11 valide", "S11", env({ source: "tms", type: "collecte.rejetee_par_tms", data: {
  event_id_tms_source: U, collecte_id: U, motif_dlq: "schema_invalide", commentaire_admin: "doublon confirmé manuellement", rejete_par_admin_id: U, rejete_at: "2026-05-09T10:00:00Z" }}));

// ---- run ----
let pass = 0, fail = 0;
for (const [name, key, payload, expected] of cases) {
  const valid = V(key, payload);
  const good = valid === expected;
  if (good) pass++; else { fail++; console.log(`FAIL ${name} — attendu ${expected}, obtenu ${valid}`); if (V.errors) console.log(JSON.stringify(ajv.getSchema(byTitle[key]).errors, null, 1)); }
}
console.log(`\n${pass}/${cases.length} cas OK${fail ? `, ${fail} ÉCHEC` : " — tous les schémas compilent et discriminent correctement"}`);
process.exit(fail ? 1 : 0);
