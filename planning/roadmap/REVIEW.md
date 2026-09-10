# Roadmap : arbitrage pour Prime Agent Studio

Revue du 9 septembre 2026, sur la branche `Roadmap`, depuis Studio 3.0.1 (`ca33160`). Analyse et critique indépendante avec `critic-it`, sans modification du produit ni du moteur.

## Cadrage retenu

**Implémenter une Roadmap adaptée au Studio, sans rechercher la parité avec Mako.** Sa valeur est de relier le travail à venir, l'avancement déclaré et les conversations responsables. Elle complète les connaissances du projet, qui donnent accès aux résultats passés, mémoires et refinements.

Parcours cible : ajouter un travail au projet → choisir « Travailler dessus » → retrouver la conversation et son activité → consulter le résultat depuis la tâche → reprendre le projet depuis un autre appareil. L'ouverture du panneau et la navigation ne lancent aucun agent.

L'utilisateur a accepté les retours de cette revue. Ils constituent le cadrage de l'intégration ; les points techniques restent à vérifier sur une implémentation réelle. La spec d'origine est conservée dans [SPEC_ROADMAP.md](SPEC_ROADMAP.md) ; les écarts ci-dessous sont intentionnels. Son prompt d'implémentation n'a pas été exécuté comme une instruction de l'utilisateur.

### Référence visuelle fournie après la revue

La capture Mako confirme une structure utile : Roadmap à droite de la conversation, onglets Global/Session/Backlog, jalons repliables, checklist avec notes et progression visible. Elle illustre la présentation, sans prouver les garanties de synchronisation ni l'intégration des outils.

Reprendre cette organisation avec les composants et le thème du Studio. Prévoir assez de largeur sur PC pour éditer les textes, puis une vue plein écran sur mobile. Afficher l'avancement dans un en-tête compact, alléger les surfaces de cartes et conserver des indicateurs d'activité discrets, sans traits latéraux accentués. « Global » désigne ici le projet courant et non tous les projets ; le libellé « Projet » serait plus explicite.

La première validation doit couvrir le parcours complet utilisateur → tâche → outil agent → état partagé → conversation → fin d'activité. C'est le raccordement de ce parcours, pas la fidélité graphique seule, qui établira que l'intégration fonctionne.

## Trois changements prioritaires

### 1. Réutiliser le moteur, garder les actions explicites

Les extensions natives existent déjà dans Studio : `runtime/studio-knowledge-extension.mjs:66` et `:92` enregistrent des outils ; `lib/agent.mjs:343` et `:608` les chargent dans Prime Agent. Le contexte fournit le projet et un gestionnaire de session en lecture seule. Un service Roadmap peut donc être utilisé par les humains et les agents sans fork du moteur ni framework supplémentaire.

Prime Agent 0.9.4 possède des goals natifs (`dist/core/goals.d.ts`, événement `goal_update` dans `dist/core/agent-session.d.ts`). En revanche, aucun contrat équivalent aux plans approuvés et todos typées de Mako n'a été établi dans les API inspectées. Ne pas confondre cette absence de contrat vérifié avec l'absence de toute extension possible. `turn_end` et `agent_end` ont également des significations différentes.

**Adaptation :** outils explicites de lecture et modification, liens vers les conversations, lancement d'un item via la file de messages existante. Aucun nouveau scheduler. Différer l'import automatique après approbation de plan et les cases cochées automatiquement depuis les todos. Une vision courte peut être saisie par l'utilisateur ou l'agent, sans génération obligatoire.

L'activité initiale reste un signal discret associé à une déclaration exacte et à un propriétaire réellement vivant. L'identité de l'agent vient de son contexte, pas des arguments du modèle. La fin, l'annulation, la perte du propriétaire ou le redémarrage retirent ce signal. Un état persistant « active » ne prouve pas qu'un agent travaille ; aucune conservation entre continuations n'est promise avant validation du cycle natif.

**Preuve à obtenir :** parent et sous-agent découvrent et appellent réellement les outils ; le badge mène à la bonne conversation sans la relancer, puis disparaît après arrêt. Le signal reste une déclaration de travail, pas une preuve de réalisation.

### 2. Rendre l'avancement compréhensible

La section 4 de la spec produit volontairement 58 % pour un jalon et 67 % pour son projet. Elle permet aussi au statut `done` de forcer 100 % avec des cases ouvertes, et prévoit une cascade asymétrique lorsque l'on coche puis décoche un parent. Ces particularités ne sont pas utiles à reproduire.

**Adaptation :** mêmes unités à tous les niveaux, fondées sur les tâches terminales, comptées une seule fois. Afficher d'abord « X/Y tâches cochées » ; un pourcentage éventuel reprend exactement ces compteurs. Pour le premier lot, un jalon regroupe des plans plutôt que de posséder une deuxième checklist indépendante.

Une checkbox parent est dérivée des enfants, avec état partiel et action symétrique sur le groupe. Un changement de statut ne coche aucune tâche et ne fabrique pas 100 %. Les plans abandonnés sortent du périmètre actif avec une indication explicite ; les plans en pause y restent. Le backlog non engagé est présenté séparément.

**Preuve à obtenir :** compteurs identiques entre vues d'un même périmètre, absence de double comptage, comportement prévisible des groupes et historique conservé lors d'un abandon. Adapter D06/D07, sans prétendre satisfaire la formule Mako.

### 3. Choisir une seule autorité de stockage

La complexité principale se trouve dans la grammaire Markdown réinscriptible, les réparations en lecture, les éditions externes, les remplacements complets et les mutations de plusieurs fichiers (§5 et §13). Les garanties de concurrence sont nécessaires dès que téléphone, PC et agents écrivent ensemble.

**Option recommandée pour le premier lot :** un document JSON versionné par projet, par exemple `.prime/studio/roadmap.json`, et un export Markdown. JSON est l'autorité ; le Markdown est explicitement un export. Aucun fichier de mémoire ou de refinement natif n'est modifié. La lecture seule ne répare ni ne crée les fichiers.

Toutes les écritures UI et outils passent par un service propriétaire, des opérations granulaires et une révision attendue. Écriture atomique, conflit explicite, brouillon récupérable et rejet des réponses anciennes font partie du socle. Les outils rejoignent ce service par un canal local borné et lié au projet/run ; ne pas copier le modèle de worker indépendant des connaissances pour écrire concurremment. La configuration du stockage doit empêcher deux serveurs de devenir simultanément propriétaires du même document.

L'édition externe simultanée n'est pas garantie par une vérification de hash suivie d'un renommage. Pour ce lot, privilégier l'import/export explicite. Si le Markdown éditable directement est une exigence prioritaire, en faire l'unique autorité et prévoir le codec, les conflits externes et la reprise des opérations composées ; ce serait un périmètre plus coûteux.

**Preuve à obtenir :** deux appareils et deux agents modifient le même projet sans perte silencieuse ; révision périmée refusée ; échec d'écriture et fichier mal formé récupérables ; aucune mutation possible en accès distant lecture seule.

## Périmètre recommandé

| Sujet | Arbitrage |
| --- | --- |
| Roadmap partagée par projet | Premier lot, avec l'identité de projet déjà utilisée par Studio. Pas de remontée Git implicite. |
| Vision, jalons, plans, checklist, backlog | Premier lot sous forme simple : vision facultative, jalons regroupant les plans, IDs stables, une seule structure de tâches. |
| Édition humaine et outils agents | Premier lot, mêmes opérations métier. Six outils ciblés ne sont pas en eux-mêmes une lourdeur ; éviter surtout les remplacements destructifs et les synchronisations implicites. |
| Conversations, activité et résultats | Premier lot : liens exacts, lancement explicite, activité sobre et journal court des changements significatifs. Ne pas dupliquer le transcript. |
| Connaissances, mémoires et refinements | Réutiliser la recherche et les liens existants. Pas de seconde mémoire ni de copie automatique dans la Roadmap. |
| Révisions, conflits, reconnexion, permissions | Premier lot obligatoire, même avec une UI réduite. |
| PC, téléphone et réorganisation | Premier lot. Reprendre les composants du Studio, un panneau large sur PC et plein écran sur mobile. Réutiliser le principe du glisser-déposer ; menus et clavier restent des alternatives. |
| Import automatique plan/todo, propagation détaillée de l'activité | Différer jusqu'à preuve de raccordement aux événements natifs, sans patch du moteur. |
| Vision générée et contexte Roadmap automatique | Option ultérieure. Au départ, lecture à la demande et consignes courtes ; aucune génération à l'ouverture. |
| Compatibilité de fichiers Mako, édition Markdown externe en direct | Différer. Conserver un export lisible dans le premier lot. |
| Curseur au caractère exact lors du passage en édition, raccourcis structurels avancés | Finition ultérieure. Garder dès le départ le wrapping, le brouillon, le focus, l'IME et les commandes tactiles. Pas de suppression d'un sous-arbre par simple Backspace dans un champ vide. |
| Traits colorés, accentuation des cartes, sabliers animés | Écarter. Texte discret et lien vers la conversation ; respecter la sobriété déjà demandée. |
| Nouveau moteur de goals/review, Gantt, CRDT, index de connaissances supplémentaire | Écarter du périmètre. |

## Correspondance avec l'existant

| Responsabilité | Point d'appui vérifié | Travail restant |
| --- | --- | --- |
| Identité de projet | `lib/store.mjs:27`, `:383`, `:389` | Même normalisation du cwd, notamment sous Windows ; appliquer les autorisations. |
| Données historiques | `lib/knowledge.mjs:22`, routes `server.mjs:652` | Référencer les sources ; éviter une duplication. |
| Outils natifs | `runtime/studio-knowledge-extension.mjs`, `lib/agent.mjs:608` | Extension Roadmap et canal vers le service propriétaire ; identité du sous-agent à prouver. |
| Conversation froide et enfants | `lib/session-inspector.mjs`, `lib/live-session-client.mjs:298` | Résolution exacte des liens, y compris enfants profonds. |
| Envoi et file d'attente | `lib/live-session-client.mjs:342`, `server.mjs` | Action explicite sur une sélection validée, sans envoi partiel. |
| Accès distant | `lib/lan.mjs:180` | Routes autorisées par méthode, mutations interdites en lecture seule. |
| UI et réorganisation | `public/inspector.js:319`, `index.html:552`, `public/project-sorting.js:2` | Vue dédiée utilisant les conventions existantes, plutôt que des contrôles Mako copiés. |
| Événements et stockage Roadmap | Pas de service Roadmap existant | Révisions et synchronisation documentaire à construire, distinctes des événements de conversation. |

## Livraison progressive et vérification

1. Livrer une tranche complète : ajouter une tâche, l'éditer depuis deux appareils, la faire traiter explicitement et retrouver sa conversation. Inclure immédiatement les conflits et le stockage durable.
2. Étendre les regroupements et plans, la recherche dans les connaissances et les liens aux résultats, avec le même service.
3. Décider des automatismes uniquement après avoir observé l'usage et vérifié leurs contrats natifs. Mesurer les appels supplémentaires, le contexte injecté et la fiabilité des mises à jour avant de revendiquer un gain de performance.

Critères transversaux conservés : aucun appel LLM à l'ouverture, erreurs de lecture distinctes d'un état vide, navigation sans réveiller les agents, contenus masqués non tabulables, saisies conservées en échec, tests assemblés outil → service → UI → conversation → fin d'activité. Les contrôles visuels PC/mobile interviendront sur l'implémentation réelle.

## Provenance et limites de cette revue

- ZIP fourni : `ROADMAP_PORTAGE.zip`, SHA-256 `A7A54BDD8A85A2D2E5F8E1713B4770B7586C491ACC56C84DF0648BEDFF03B1A9`.
- Spec intégralement lue ; analyse du prompt et du manifeste d'empreintes. Le ZIP ne contient pas le code ni les tests de Mako. Les empreintes ne permettent donc pas de vérifier ici les affirmations sur son implémentation.
- Inspection du Studio 3.0.1 et des déclarations de l'API Prime Agent 0.9.4 installée, plus critique indépendante en lecture seule. Les pistes d'intégration sont étayées par les sources, pas encore validées par un prototype Roadmap.
- Aucun changement du produit, test d'exécution Roadmap, mesure de performance, redémarrage, commit ou publication réalisé pour cet audit.
