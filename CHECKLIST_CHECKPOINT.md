# Checklist checkpoint humain — fin de chaque module

Tu ne lis pas le code. Tu vérifies des signaux durs :

- [ ] **Gates CI tous verts** sur la PR du module (capture GitHub, pas une affirmation de l'agent)
- [ ] **Le scénario démo tourne** réellement devant toi (tu cliques, ça marche)
- [ ] **Résumé du reviewer-principal lu** : "ce que change ce diff + conforme au brief ?" — compris
- [ ] **reviewer-rls-securite GO** si le module touche des données (cloisonnement OK)
- [ ] **Aucune question ouverte nouvelle** non tracée dans le suivi
- [ ] **Privilèges agent conformes au régime en vigueur** (cf. `BRANCH_PROTECTION.md`) :
  - *Régime temporaire (aucun client réel en prod — en vigueur)* : chaque merge sur `main` est passé par une PR avec gate-pr (GO `reviewer-conformite-spec` + `reviewer-rls-securite`), sans `--admin` ni force push ; chaque déploiement / migration prod t'a été annoncé dans la réponse ; aucune migration n'a ouvert ou élargi un accès sans ton accord (R1, `CLAUDE.md` §12).
  - *Régime cible (dès le premier client réel)* : l'agent n'a pas pu merger seul sur `main`, pas d'accès prod.

Si un seul item n'est pas coché → le module n'est pas validé, on ne passe pas au suivant.
