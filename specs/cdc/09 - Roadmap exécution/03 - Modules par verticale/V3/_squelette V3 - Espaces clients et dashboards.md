# Squelette V3 — Espaces clients & dashboards par rôle

> Briefs détaillés générés juste-à-temps avant exécution V3. **Arbitrage Val 2026-06-08 : les 6 rôles sont livrés AVANT go-live** — V3 entière est sur le chemin critique, pas de décalage post-go-live.

**Dépend de** : Niveau 0, V1, V2 (données ZD + AG à afficher).

| Module | Périmètre | Sources `_DEV-FACING/` | Tests | Budget (≈) |
|---|---|---|---|---|
| M3.1 — Espace traiteur | Dashboards manager + commercial, accès PDF + régénération manuelle (picto ⟳, régén = Edge Function SERVICE_ROLE F3), badges pack/facturation | §06/04, §11 | `tests/06.04-...` | L ~800k |
| M3.2 — Espace gestionnaire de lieux | Multi-lieux, filtres, drill-down, tarifs préférentiels (saisie + application auto), users org-wide (F5) | §06/05, §11 | `tests/06.05-...` | M ~600k |
| M3.3 — Espace agence | Dashboard agence, users self only (Top 5 + bloc Utilisateurs retirés V1, F1), référentiel via vue `v_referentiel_traiteurs` | §06/11, §11 | `tests/06.11-...` | M ~500k |
| M3.4 — Espace client organisateur | RSE, impact, accès rapports | §06 (organisateur), §11 | `tests/11-12-...` | M ~450k |
| M3.5 — Dashboards par rôle (couche commune) | §11 fait foi ; vues `v_ops_*` = couche ops (07-Observabilité/04) | §11 | `tests/11-12-...` | M ~500k |

**RLS critique** : chaque rôle ne voit que son périmètre (cloisonnement org/lieux). Les pgTAP du Niveau 0 (0.6) couvrent déjà le transverse §09 ; V3 ajoute les tests par espace.
**Ordre** : M3.5 (couche commune) → M3.1 → M3.2 → M3.3 → M3.4.
**Budget V3 ≈ 3,3M** (somme modules ~2,85M + intégration/E2E).
