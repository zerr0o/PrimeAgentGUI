# Roadmap : implémentation Studio

Développé sur la branche `Roadmap`, depuis Studio 3.0.1 (`ca33160`), pour la version 3.1.0. Périmètre adapté et validé dans [REVIEW.md](REVIEW.md). Aucun fork de Prime Agent, aucun ordonnanceur supplémentaire.

## Livré

- Panneau Roadmap à droite sur PC et plein écran sur mobile : Projet, Session et Backlog. Accès depuis l’en-tête, le projet, le panneau Session et les raccourcis `/roadmap` / `/backlog`.
- Vision facultative, jalons repliables regroupant des plans, statuts, checklists à trois niveaux, notes, journal et liens vers les conversations. Backlog avec tâches, intentions, numéros stables et conversion entre les deux types.
- Progression uniforme fondée sur les feuilles. Cocher/décocher un groupe agit symétriquement sur ses descendants. Statuts indépendants des cases ; plans abandonnés exclus de la progression.
- Réorganisation par glisser-déposer souris ou tactile, avec menus accessibles pour déplacer et indenter.
- Action explicite « Travailler dessus » sur plan, tâche, jalon ou sélection de backlog. Même circuit de lancement et de file de messages que le Studio ; protection contre les doubles requêtes et conservation des liens après admission réelle.
- Six outils natifs pour les nouvelles exécutions du Studio et leurs sous-agents. Identités issues du contexte natif et vérifiées via les sessions et leur filiation ; activité déclarée temporaire, retirée à la fin du travail.
- Navigation vers les conversations et les historiques de sous-agents, sans les relancer. Protection contre une réponse retardée après changement de projet.
- Document canonique `.prime/studio/roadmap.json`, accès par projet exact, révisions obligatoires, verrou interprocessus et écritures atomiques. Lecture sans création ni réparation implicite. Export Markdown séparé.
- Conflits explicites, brouillons locaux avec leur révision d’origine, actualisation entre appareils, consultation distante sans mutation. Une erreur de liaison est visible et réparable sans renvoyer le travail.
- Documentation française et anglaise ; mêmes thèmes et composants que le Studio.

## Vérification

- `npm test` : 286 réussis, 4 ignorés, aucun échec (290 tests).
- `npm run check` : syntaxe, 1269 traductions, 14 paires documentaires et 210 liens locaux.
- `node scripts/test-roadmap-ui.mjs` : parcours HTTP/UI réels sur données de démonstration ; deux appareils, conflits, réouverture de brouillon, checkboxes, drag, envoi unique, historique enfant, raccourci et mobile 320/375/393.
- `node scripts/test-roadmap-native.mjs` : vrais processus Prime Agent 0.9.4 parent/enfant, fournisseur déterministe sur loopback, sans appel à un modèle externe.
- `node scripts/test-roadmap-native-packaged.mjs` : même preuve depuis une copie isolée des ressources, avec Node copié lancé hors du dépôt.
- Régressions des commandes et de la navigation par projets contrôlées dans Chrome.
- Revue indépendante et preuves locales : `.local/roadmap-review/R0/`. La preuve instrumentée relie les outils réellement exécutés, le service, le panneau, la conversation du sous-agent et la fin d’activité.
- Verdict indépendant R0 : **PASS, 8,5/10** (clarté 8,5 ; visuel 8,4 ; précision 8,7 ; architecture 8,6 ; robustesse 8,3). Aucun P0/P1. Finition facultative : raccourcir les titres initiaux des conversations créées depuis une sélection de travail.

Les tests n’ont pas redémarré le Studio installé ni utilisé les projets ou comptes du quotidien. Les vues mobiles ont été vérifiées dans Chrome avec émulation tactile ; une validation sur iPhone physique et dans l’installateur Tauri final reste distincte de ces preuves.

## Écarts intentionnels conservés

Pas d’import automatique des plans/todos du moteur, de cases cochées depuis un statut, de vision générée à l’ouverture, de contexte systématiquement injecté, de seconde mémoire ni de compatibilité de fichiers Mako. Le Markdown exporté n’est pas éditable en synchronisation directe. L’activité est une déclaration de travail, pas une preuve de réalisation. Les références persistées survivent à la fermeture ; les présences et demandes de réparation encore en attente appartiennent à l’instance de serveur.

Les validations de distribution et de signature sont réalisées séparément lors de la préparation de la release 3.1.0. Les preuves ci-dessus décrivent les contrôles de l’implémentation, sans revendiquer une installation sur les appareils de l’utilisateur.
