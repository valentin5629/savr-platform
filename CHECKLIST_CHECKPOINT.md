# Checklist checkpoint humain — fin de chaque module

Tu ne lis pas le code. Tu vérifies des signaux durs :

- [ ] **Gates CI tous verts** sur la PR du module (capture GitHub, pas une affirmation de l'agent)
- [ ] **Le scénario démo tourne** réellement devant toi (tu cliques, ça marche)
- [ ] **Résumé du reviewer-principal lu** : "ce que change ce diff + conforme au brief ?" — compris
- [ ] **reviewer-rls-securite GO** si le module touche des données (cloisonnement OK)
- [ ] **Aucune question ouverte nouvelle** non tracée dans le suivi
- [ ] **Privilèges minimaux** : l'agent n'a pas pu merger seul sur main, pas d'accès prod

Si un seul item n'est pas coché → le module n'est pas validé, on ne passe pas au suivant.
