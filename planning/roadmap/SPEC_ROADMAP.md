# Roadmap intégrée à un harness agentique — spécification de portage

Version du 9 septembre 2026. Destinataire : un agent d’implémentation qui ne connaît ni MakoHarness ni cette conversation. Ce document est autonome ; les chemins de sources en annexe sont des références facultatives pour approfondir.

## 1. Périmètre et valeur de référence

Construire un espace Roadmap partagé par l’utilisateur et les agents d’un même projet : vision du projet, jalons, plans de travail, checklists hiérarchiques, journal, backlog et indicateurs d’activité navigables vers les conversations responsables. L’utilisateur édite directement dans l’interface ; les agents utilisent des outils structurés. Les deux voies modifient les mêmes données.

La référence est le code local de MakoHarness relu pour cette spécification, sur `master`, avec HEAD `884dd60ba5e995bb5d68d7051e5e7a83dc834776` et des modifications locales, notamment sur la durée de vie de l’activité, la lecture des sessions froides et le bouton Roadmap. Cette référence n’est pas une affirmation de déploiement. L’examen porte sur les modèles, codec Markdown, service, outils, commande backlog, composants, styles, store, raccordements et scénarios de tests. Aucun nouveau parcours visuel complet ni nouvelle exécution des tests n’a été effectué pour produire ce document.

Les sections 2 à 12 définissent le produit à reproduire. Les particularités de comportement sont explicites. La section 13 définit les renforcements demandés pour le portage : ne pas présenter ces renforcements comme déjà garantis par le code source. La section 14 fournit les critères de réception.

Le framework, le transport RPC et le moteur d’agents restent ceux du harness cible. Cordis, Typert, React et les noms de packages Mako ne sont pas des dépendances obligatoires. Aucun besoin de recopier le moteur d’agents.

## 2. Architecture et séparation des responsabilités

Séparer cinq responsabilités, même si leur organisation en modules diffère :

1. Modèle métier et calculs purs : arbres, identifiants, références, progression, opérations structurelles.
2. Service de projet : lecture, mutations, stockage, validation, sérialisation concurrente et événements.
3. Intégration agent : outils, contexte, mode plan, todos et commandes utilisateur.
4. Activité temporaire : attribution de cibles à des conversations vivantes, indépendante du stockage documentaire.
5. Interface : panneau responsive, édition directe, navigation et projection des états serveur.

Le serveur calcule les progressions. L’interface n’invente pas une seconde formule. Les outils et l’interface passent par les mêmes opérations métier. Les événements documentaires et les événements d’activité restent distincts.

Une Roadmap appartient à un projet, pas à une conversation. Plusieurs conversations voient et éditent la même Roadmap si elles résolvent le même projet. Un plan peut être lié à plusieurs conversations ; cela ne duplique pas son contenu.

Dans Mako, l’identité du projet est le chemin absolu du répertoire de travail de la session, sans remontée au dépôt Git. Un sous-répertoire possède donc une Roadmap différente. Pour le portage, conserver cette règle par défaut ou annoncer explicitement une résolution différente fondée sur l’identité de projet native. Ne pas alterner implicitement entre cwd et racine Git. Les sessions sans projet et les conversations générales affichent un état « aucun projet ».

## 3. Modèle des données

Les timestamps publics sont des millisecondes Unix ; les fichiers utilisent des dates ISO 8601. Les identités de conversation et de projet doivent être opaques à leurs consommateurs.

| Entité | Champs |
| --- | --- |
| Project | `path`, `name`, `initialized`, `overview`, `plans[]`, `backlog` |
| Overview | `vision`, `milestones[]`, `progress`, `lastEdit` |
| Milestone | `slug`, `title`, `summary`, `status`, `items[]`, `plans[]` dérivés, `progress` |
| Plan | `id`, `slug`, `title`, `summary`, `status`, `milestone?`, `sessions[]`, `steps[]`, `journal[]`, `progress`, `createdAt`, `updatedAt`, `lastEdit` |
| Step | `id`, `text`, `note?`, `done`, `children[]` |
| JournalEntry | `at`, `text` |
| Backlog | `items[]`, `notes[]`, `lastEdit` ; compteur durable `nextNumber` |
| BacklogItem | `number`, `text`, `note?`, `done`, `addedAt`, `by`, `session?` |
| BacklogNote | Les mêmes champs qu’un item, sans `done` |
| Progress | `done`, `total`, `percent` |
| LastEdit | `by: user \| agent \| plan-mode \| file`, `at` |

### Statuts et identité

- Plan : `active`, `done`, `paused`, `abandoned`. Défaut `active`.
- Jalon : `planned`, `active`, `done`. Défaut `planned`.
- Un statut est une donnée éditable, distincte de l’activité réelle d’un agent. `active` ne suffit jamais à afficher « un agent travaille ».
- Plan : identifiant stable indépendant du titre, par exemple `plan-<uuid>`. Le slug détermine le nom du fichier ; éditer le titre ne change pas le slug.
- Slug : minuscules, lettres et chiffres Unicode, tirets, 64 caractères maximum ; aucun séparateur de chemin. Dérivation depuis le titre : NFKD, retrait des accents combinés, minuscules, groupes non alphanumériques remplacés par un tiret, retrait des tirets aux extrémités. Repli `untitled`.
- Une création avec slug implicite doit éviter une collision en ajoutant `-2`, `-3`, etc. Une création explicite en conflit échoue. Un outil d’upsert avec slug existant remplace selon les règles de son API. Préserver la longueur maximale lors du suffixage dans le portage.
- Identifiants d’étape dans le format Mako : quatre caractères hexadécimaux minuscules, persistés comme `<!-- #a1b2 -->`. Ils sont stables lors des déplacements et renommages. Un identifiant différent est créé en cas de collision. Pour un stockage indépendant, un identifiant plus long est acceptable ; la compatibilité de fichiers Mako exige le format décrit ici.
- Une référence d’édition peut être l’identifiant ou un chemin ordinal commençant à 1, comme `2.1`. Préférer les identifiants ; les ordinaux changent avec les déplacements. Une cible d’activité utilise exclusivement un identifiant exact, pas un ordinal.
- Les numéros du backlog sont uniques entre items et notes et ne sont jamais réutilisés, même après suppression. `nextNumber` est la prochaine valeur à attribuer, au moins `max(numéros présents)+1`.

### Arbres et remplacements

Profondeur maximale : trois niveaux, racine comprise. Les titres et textes d’étapes/items sont non vides après trim et ne contiennent pas de saut de ligne réel. Ils peuvent occuper plusieurs lignes visuelles. Les résumés, la vision et les notes peuvent contenir des sauts de ligne.

Lors d’un remplacement complet de checklist, apparier d’abord les identifiants explicites, puis le texte identique. Conserver l’état coché et la note de l’étape appariée lorsqu’ils sont omis. Un `done` explicite remplace l’état précédent ; une note vide supprime la note. Ne pas réutiliser le même identifiant pour deux lignes. Les textes identiques sont ambigus : le modèle doit privilégier les identifiants retournés à la lecture.

Omettre `steps` ou `items` conserve la checklist. Fournir ces champs signifie envoyer la liste complète. L’outil `roadmap_plan` refuse `steps: []` si le plan contient déjà des étapes ; une modification de métadonnées ne doit pas vider un plan par accident. Les suppressions de lignes restent possibles par opérations granulaires.

## 4. Calcul exact des progressions

### Plan

Compter uniquement les feuilles de l’arbre. Un parent avec enfants ne compte pas en plus de ses enfants. `percent = round(100 × feuilles cochées / feuilles totales)`, ou 0 si le total est nul. Si le statut est `done`, retourner `done = total` et `percent = 100`, y compris pour un plan vide. Ce statut ne réécrit pas les checkboxes.

### Jalon

Chaque feuille manuelle vaut une unité. Chaque plan attaché vaut également une unité, quelle que soit sa taille, et contribue son pourcentage de plan divisé par 100.

```text
total = nombre de feuilles manuelles + nombre de plans attachés
completedUnits = feuilles manuelles cochées + somme(plan.percent / 100)
done affiché = arrondi de completedUnits à deux décimales
percent = round(100 × completedUnits / total), ou 0 si total = 0
status done => done = total et percent = 100
```

Les plans attachés sont dérivés depuis `plan.milestone`, jamais dupliqués dans le document global. Les plans `paused` et `abandoned` restent comptés par la référence, à leur progression courante.

### Projet

Additionner les feuilles manuelles de tous les jalons et les compteurs de tous les plans, attachés ou non, exactement une fois. Le backlog n’entre pas dans ce total. Calculer le pourcentage depuis ces compteurs, et non depuis la moyenne des pourcentages de jalons.

Particularité à conserver pour une fidélité exacte : un jalon passé manuellement à `done` affiche 100 %, mais ne force pas ses feuilles à être terminées dans la progression globale. Un plan `done`, lui, fournit déjà des compteurs forcés. Un plan vide `done` contribue une unité complète à son jalon mais aucune feuille au total du projet. Ces différences doivent être documentées, pas dissimulées par un recalcul frontend.

Exemple : un jalon a deux feuilles manuelles, une cochée, et un plan ayant 3 feuilles cochées sur 4. Le jalon affiche `1,75 / 3`, soit 58 %. Le projet, sans autre contenu, affiche `4 / 6`, soit 67 %. Le backlog reste hors calcul.

### Effet des checkboxes

Dans la référence, cocher un parent coche récursivement tout son sous-arbre. Décocher ce parent ne décoche que le parent, sans effacer l’avancement des enfants. Cocher les enfants ne recalcule pas automatiquement le booléen du parent. Ne pas supposer une cascade symétrique. Un état visuel indéterminé ou une autre règle serait une évolution produit distincte.

## 5. Stockage et édition externe

Organisation par défaut :

```text
<project>/.mako/roadmap/
  roadmap.md
  backlog.md
  plans/
    <slug>.md
```

Le nom du répertoire doit être configurable. Un harness cible peut adopter son propre préfixe, mais doit exposer les chemins réels aux fonctions d’ouverture/export. Conserver un stockage lisible et éditable en dehors de l’interface ; si une base de données est utilisée, définir sans ambiguïté si les fichiers sont l’autorité ou un export/import.

Le codec est une grammaire Markdown structurée, pas un éditeur Markdown libre complet. Il utilise un front matter plat, des titres, des listes de tâches, des commentaires HTML d’identification et des citations pour les notes. Les champs inconnus du front matter ne sont pas garantis conservés dans la référence. Les lignes libres du corps sont conservées comme extras puis réémises, avec normalisation possible de leur placement et des espaces. Ne pas promettre un round-trip octet pour octet de tout Markdown arbitraire.

Exemple de plan compatible :

```markdown
---
id: plan-12345678-1234-4234-8234-123456789abc
title: Fiabiliser les notifications
status: active
milestone: preparer-la-release
sessions: [session-demo]
lastEditBy: agent
lastEditAt: 2026-09-09T12:00:00.000Z
created: 2026-09-09T12:00:00.000Z
updated: 2026-09-09T12:00:00.000Z
---
# Fiabiliser les notifications

> Permettre de recevoir les alertes sur les appareils pris en charge.

## Steps
- [ ] Parcours d’activation <!-- #a1b2 -->
  > Tester les états autorisé et refusé.
  - [x] Expliquer la permission <!-- #c3d4 -->
  - [ ] Vérifier la réception <!-- #e5f6 -->

## Journal
- 2026-09-09T12:00:00.000Z — Permission affichée et testée.
```

Document global : front matter `lastEditBy`, `lastEditAt`, titre `# Roadmap — <projet>`, vision en `>`, puis jalons `## Préparer la release <!-- #preparer-la-release status:active -->`, résumé en citation, checklist manuelle. Aucun tableau de plans attachés n’est persisté.

Backlog : front matter `nextNumber`, `lastEditBy`, `lastEditAt`, titre `# Backlog`, sections `## Items` et `## Notes`. Un item s’écrit `- [ ] #7 Vérifier Safari <!-- added:2026-09-09T12:00:00.000Z by:user session:session-demo -->`. Une intention s’écrit `- #8 Garder le parcours simple <!-- added:2026-09-09T12:00:00.000Z by:user -->`. Une note descriptive suit avec une citation indentée.

Les lectures tolèrent des métadonnées manquantes. Un plan ou une étape manuscrite sans identifiant reçoit un identifiant persisté pour stabiliser les références suivantes. Cette réparation signifie qu’une lecture métier peut écrire le fichier, même si elle ne démarre jamais un agent. Un document mal formé ne doit pas provoquer sa réinitialisation silencieuse.

Paramètres de référence :

| Paramètre | Défaut |
| --- | --- |
| directory | `.mako/roadmap` |
| watch | true |
| watchDebounceMs | 300 ms |
| autoSeedFromPlan | true |
| contextSection | true |
| maxFileBytes | 524288 octets par document, lecture et écriture |
| journalMaxEntries | 200, conserver les plus récents |

Les écritures utilisent un fichier temporaire dans le même répertoire puis un renommage atomique. Une file d’opérations par projet sérialise les lectures/mutations du service ; une opération en erreur ne bloque pas les suivantes. Un watcher ignore les fichiers temporaires et émet les modifications externes après debounce. Sans watcher récursif disponible, les modifications externes doivent au minimum apparaître à la prochaine lecture.

## 6. API métier et API de l’interface

Résoudre le projet et l’acteur côté serveur. L’interface ne choisit pas librement un chemin de projet ni un acteur `agent`. Les lectures `read` et `activity` doivent fonctionner depuis les métadonnées d’une conversation froide, sans la réhydrater en agent actif, sans prendre un verrou d’exécution et sans démarrer de tour LLM. Naviguer vers une conversation est également une lecture, pas une reprise de travail.

L’enveloppe de réponse est au choix du harness cible, avec une branche succès typée et une branche erreur contenant un code stable et un message lisible. Codes métier de référence : `roadmap-no-project`, `roadmap-not-found`, `roadmap-invalid`, `roadmap-io`, `roadmap-too-large`, `roadmap-duplicate-slug`. Conserver séparément les erreurs d’authentification, session inexistante et restrictions d’accès aux sous-agents.

Toutes les mutations suivantes doivent être disponibles à l’interface via des opérations granulaires :

| Groupe | Opérations et résultat |
| --- | --- |
| Projet | `read → Project`, `init → Project`, `activity → ActivitySnapshot` |
| Plan | create, replace, patch(title/summary/status/milestone), attachSession, delete ; résultat Plan, sauf delete |
| Étapes de plan | check(ref,done,note?,comment?), edit(ref,text?/note?), add(parent?,after?,text,note?), remove(ref), move(ref,direction) ; résultat Plan |
| Journal | addJournal(slug,text) → Plan |
| Vision | setVision(text) → Overview |
| Jalon | create, replace, patch(title/summary/status), move(up/down), delete → Overview |
| Étapes de jalon | check, edit, add, remove, move → Overview |
| Backlog | add(items?,notes?), set(numbers,done), edit(number,text?/note?), remove(numbers), move(number,up/down), convert(number,item/note) → Backlog |

`milestone: null` détache un plan ; une omission préserve son rattachement. Supprimer un jalon détache ses plans, sans les supprimer. Les plans sont présentés par mise à jour décroissante avant le regroupement par conversation. Ajouter une conversation à un plan ne doit pas créer de doublon dans `sessions`.

Déplacements d’étape : up/down échangent avec le frère adjacent ; indent place en dernier enfant du frère précédent ; outdent place juste après le parent. Déplacer hors limites ou dépasser la profondeur autorisée échoue explicitement. `after` doit appartenir à la fratrie déterminée par `parent`. Supprimer une étape supprime son sous-arbre.

Le commentaire d’un check de plan ajoute une ligne datée de journal avec l’identifiant et le résultat du check. Une note remplace le texte de note. Le jalon ne possède pas de journal dans ce périmètre. Convertir une note de backlog en item crée un item ouvert ; l’inverse retire le booléen `done`, en conservant numéro et attribution. Un déplacement backlog reste dans sa section.

Après une écriture réussie, émettre `roadmap/changed {projectPath, kind: plan|overview|backlog|project, slug?, actor}`. Le slug est obligatoire pour un changement de plan. Tous les clients du projet rechargent, y compris pour l’acteur `user` : ce peut être un autre onglet. Appliquer aussi immédiatement le document retourné par la mutation. Les exigences supplémentaires de révision et cohérence des agrégats sont en section 13.

## 7. Outils exposés aux agents

Six outils, tous exécutés dans l’identité de la conversation appelante, sous-agent compris. Les textes rédigés sont dans la langue de l’utilisateur, en phrases concrètes compréhensibles sans connaître le code. Chaque appel et son résultat doivent apparaître dans le journal de conversation selon le mécanisme normal du harness.

| Outil | Entrée | Sortie et sens |
| --- | --- | --- |
| roadmap_read | target obligatoire : overview, plan ou backlog ; slug requis pour plan | `{text}` avec documents, progression, références exactes ; la lecture d’un plan inclut les 10 dernières lignes de journal |
| roadmap_plan | title requis ; slug?, summary?, status?, milestone?, steps? | Créer ou remplacer ; retourne slug, done, total, percent et liste aplatie id/text/indent |
| roadmap_check | slug ; updates:[{ref,done,note?,comment?}] | Mettre à jour les étapes d’un plan ; retourne progression et étapes concernées |
| roadmap_backlog | add:[{text,note?}]?, notes:string[]?, done:number[]?, reopen:number[]? | Ajouter, terminer ou rouvrir ; retourne numéros ajoutés et nombre d’items ouverts |
| roadmap_milestone | slug?, title?, summary?, status?, items?, vision? | Créer/remplacer un jalon, ou enregistrer uniquement la vision ; retourne slug éventuel, percent, nombre de plans attachés |
| roadmap_work | targets:[WorkTarget] | Remplacer l’ensemble des cibles de travail de l’appelant ; retourne count accepté ; aucun changement documentaire |

`roadmap_milestone({vision: "…"})` doit fonctionner sans créer un faux jalon. Sans title, interdire les autres champs de jalon. Avec title et vision, valider l’ensemble avant toute écriture dans le portage. La liste `items` est complète, pas un patch. Le schéma actuel de `roadmap_plan.milestone` est une chaîne ; la voie UI supporte explicitement null pour détacher. Le portage peut exposer ce null au modèle également, mais doit le documenter.

Exemple de séquence agent :

```json
{"tool":"roadmap_read","args":{"target":"overview"}}
{"tool":"roadmap_milestone","args":{"vision":"Rendre le suivi de projet lisible et partagé entre les utilisateurs et leurs agents."}}
{"tool":"roadmap_plan","args":{"title":"Fiabiliser la synchronisation","steps":[{"text":"Tester la reconnexion"},{"text":"Protéger les éditions concurrentes"}]}}
```

Le résultat du troisième appel fournit le slug et les identifiants. Utiliser ces valeurs réellement retournées pour les appels suivants, jamais ceux d’un exemple codé en dur.

### Contexte et conduite de l’agent

Au début du travail substantiel, lire la Roadmap et aligner le plan sur l’objectif actuel. Aux étapes importantes et après des lots cohérents de travail long, mettre à jour les tâches découvertes, changements de périmètre, blocages, décisions et cases vérifiées. Avant le bilan final, réconcilier les documents avec les résultats réels. Ne pas faire de mises à jour vides ou annoncer une fin non vérifiée.

Un contexte synthétique décrit le nom du projet, la progression globale, jusqu’à six plans actifs de la conversation avec leurs slugs et compteurs, le nombre d’autres plans actifs et les nombres d’items/notes du backlog. La référence limite à 14 lignes ; ne pas confondre ce nombre de lignes avec un budget de tokens, car les consignes sont longues. Placer ce contenu volatil après les instructions stables et le rendre reconstructible depuis le transcript.

Si un document a été édité par l’utilisateur depuis la dernière lecture de l’agent, lui demander explicitement de le relire avant de modifier. La référence utilise `lastEdit.by` et un marqueur de lecture par agent ; le renforcement par révisions documentaires est défini en section 13.

Si la vision est vide, l’agent lit la documentation et le contexte du projet, rédige sa finalité et le résultat visé, relit l’overview et sauvegarde une vision uniquement si elle est toujours vide. Ne pas reprendre automatiquement le résumé du premier plan. Ouvrir ou initialiser le panneau ne déclenche pas de requête LLM : le remplissage se produit pendant le travail de l’agent. Si le harness cible propose un bouton « rédiger la vision », ce doit être une action explicite dont l’état de génération est visible.

`roadmap_work` décrit ce qui est en cours ; il ne remplace ni les mises à jour de checklist ni le journal. Chaque sous-agent déclare son propre travail. Le parent ne doit pas prétendre être le travailleur de toutes les tâches qu’il délègue.

### Mode plan et todos

Après approbation réussie d’un plan de la conversation racine, créer un plan Roadmap lié à celle-ci. Ne rien créer en cas de refus/erreur ; pas de création automatique depuis un sous-agent. Adaptateur de référence : titre `#`, sections `##` de travail transformées en étapes, leurs puces en sous-étapes ; objectif, hypothèses, tests, hors périmètre, risques, documentation, critères de succès et coordination alimentent le résumé. Ignorer le contenu des fences et les tableaux. La conversion actuelle borne les libellés à 200 caractères, les sous-étapes à 24 par section et le résumé à 600 caractères : ces bornes doivent être annoncées si reprises.

Une todo peut contenir `roadmap: "<slug>#<stepId>"`. Le statut `in_progress` contribue à l’overlay. Le statut `completed` coche l’étape liée pour les sessions racines dans la référence. L’autocheck est actuellement exclu pour les sous-agents ; le portage doit choisir explicitement cette politique, avec recommandation de réserver la validation finale au parent quand une review est requise. La Roadmap ne constitue pas elle-même un moteur de review ou de délégation.

### Commande /backlog

- `/backlog` : envoie tous les items ouverts dans leur ordre, avec les intentions en contexte.
- `/backlog 3,5` ou `/backlog 3 5` : envoie ces items ouverts ; déduplique les numéros ; refuse toute sélection contenant un numéro inconnu ou fermé, sans envoi partiel.
- `/backlog + texte` : ajoute une tâche attribuée à l’utilisateur, sans démarrer automatiquement son exécution.
- Backlog vide : message informatif, aucun travail inventé.

L’envoi passe par le mécanisme normal de message/follow-up et ses règles de session occupée. Il est journalisé. Demander à l’agent de déclarer chaque cible en cours, traiter les éléments et ne marquer terminés que les numéros effectivement livrés. Attention : le texte source interpole actuellement toute la sélection dans l’exemple `done:[…]` tout en parlant d’un seul item terminé ; ne pas reprendre cette formulation ambiguë.

## 8. Activité temporaire et absence d’état périmé

Une déclaration est un remplacement complet du travail courant de cette conversation. Formes autorisées :

```json
{"targets":[
  {"kind":"plan","slug":"fiabiliser-la-synchronisation","ref":"a1b2"},
  {"kind":"milestone","slug":"preparer-la-release"},
  {"kind":"backlog","number":7}
]}
```

Sans `ref`, la cible plan/jalon désigne la carte entière. Une cible backlog prend uniquement un numéro. Valider toutes les références avant de publier. Une cible inconnue échoue ; aucune déduction par ressemblance du texte, nom de fichier ou statut du plan. `targets: []` efface l’activité de l’appelant, y compris ses cibles de todos dans la référence.

L’identité vient du contexte d’exécution, jamais d’un `sessionId` arbitraire fourni par le modèle. Le snapshot comporte :

```json
{"projectPath":"/workspace/projet","activities":[
  {"sessionId":"agent-worker","parentSessionId":"agent-parent","targets":[{"kind":"plan","slug":"livraison","ref":"a1b2"}]}
]}
```

`parentSessionId` est absent pour une conversation racine et désigne le parent direct pour un sous-agent. L’endpoint `activity` et l’événement `roadmap/activity` transportent des snapshots de remplacement, pas des ajouts cumulés. L’activité est en mémoire de processus ; un redémarrage la vide. Ne jamais la sérialiser dans les textes, notes, statuts, journaux, progressions ou `lastEdit`.

### Durée de vie

| Événement | Effet |
| --- | --- |
| Nouvelle déclaration valide | Remplace les cibles manuelles de cet agent |
| Changement de todos | Remplace ses cibles issues des todos en cours |
| Fin de tour normale sans goal actif armé | Efface |
| Fin de tour normale avec le même goal actif armé | Conserve pendant sa continuation |
| Goal modifié, pausé, terminé, effacé ou remplacé | Efface |
| Reprise ultérieure d’un goal pausé | Ne restaure pas les anciennes cibles ; une nouvelle déclaration est nécessaire |
| Nouveau message humain | Efface |
| Annulation, erreur de tour, destruction de session/agent/service | Efface |
| Déconnexion du navigateur | Le client retire immédiatement l’overlay ; cela ne termine pas le travail serveur |
| Reconnexion ou réouverture du panneau | Recharge un baseline serveur |

Sans système de goals dans le harness cible, utiliser le cycle du tour ; ne pas inventer un goal permanent pour conserver les badges. Si le moteur possède des runs autonomes, relier l’activité à leur identité et leurs transitions effectives. La simple présence d’un statut `running` en base n’est pas une preuve suffisante après redémarrage.

Chaque validation asynchrone porte un epoch par session. Une nouvelle déclaration ou une invalidation l’incrémente. Après les lectures/awaits, publier uniquement si l’epoch et l’instance de service sont encore valides. Une validation commencée avant une pause, une fin ou un clear ne doit jamais ressusciter l’activité. L’agent propriétaire et le goal doivent encore être ceux attendus.

Côté client : numéro de génération pour les chargements ; révision locale d’activité pour arbitrer baseline et événements. Une réponse ancienne est ignorée si une lecture plus récente, un événement d’activité ou une déconnexion l’a dépassée. Une lecture de baseline en échec retire l’activité. Une réponse pour un autre projet est ignorée. Ces mécanismes sont indépendants des révisions documentaires recommandées en section 13.

### Propagation visuelle et navigation

Une étape ciblée colore son texte et affiche un badge sablier « En cours · <conversation> ». Ses ancêtres de checklist et la carte propriétaire sont signalés. Une activité sur un plan attaché signale aussi son jalon. Une carte repliée garde son indicateur et ses liens. Une cible carte entière n’allume pas artificiellement chacune des lignes.

Dédupliquer les travailleurs par identité de conversation, pas par cible. Si plusieurs agents travaillent sur le même élément, chacun possède son lien. Un identifiant d’étape supprimé ne doit pas continuer à illuminer sa carte ; vérifier la présence de la cible dans le document courant lors du matching.

Cliquer un badge ouvre exactement la conversation responsable, puis ferme le panneau pour la rendre visible. Pour un sous-agent, résoudre son parent direct, rafraîchir sa liste d’enfants et naviguer vers cet enfant sans le relancer. Si indisponible, afficher une erreur près du lien. Ne jamais router systématiquement vers la racine ou vers un autre agent portant le même titre.

Le badge et la coloration sont des éléments de rendu séparés. Entrer en édition ne doit pas copier « En cours », le nom d’agent ou le sablier dans le champ.

## 9. Interface desktop et mobile

### Ouverture et structure

Bouton à icône de carte dans les utilitaires de la conversation ; état pressé reflétant le panneau réellement monté. Fond plein élevé, comme le bouton Artefacts. Référence desktop : 32 × 32 px, rayon 8 px, icône 16 px. Mobile : 40 × 40 px, rayon 12 px, bordure fine, ombre `0 2px 8px rgba(0,0,0,.18)`, même remplissage et encombrement qu’Artefacts. La taille visuelle mobile de 40 px est distincte de la cible tactile recommandée de 44 px, extensible par un conteneur transparent.

Desktop : panneau de détails à côté de la conversation, dans le système de panneaux existant. Mobile : détail plein écran. Pas de nouvelle page isolée qui perd le contexte de la conversation.

Ordre vertical permanent :

```text
[icône] Roadmap                         [Fermer]
        Nom du projet
[Progression globale                 67 %]
[barre de progression                  4/6]
[ Global ] [ Session ] [ Backlog ]
───────────────────────────────────────────
Contenu défilant de l’onglet sélectionné
```

Titre, progression globale et onglets restent visibles pendant le scroll du contenu. Utiliser une colonne flex avec `min-height:0` et un seul contenu principal scrollable. Les erreurs de sauvegarde apparaissent sans remplacer le document chargé.

Fermer le panneau par son bouton, par le changement de détail ou par un démontage externe doit remettre l’état pressé du bouton à faux. Ouvrir le panneau relit le projet, tout en permettant de conserver le dernier snapshot pour limiter les flashs.

### Onglet Global

Vision en section repliable, initialement fermée ; son contenu doit réellement être masqué et non interactif quand fermé. Le repli n’écrit aucun fichier et ne déclenche pas l’agent.

Puis cartes de jalons numérotées `01`, `02`, etc. Chaque carte conserve visibles : numéro, titre éditable, statuts Planned/Active/Done localisés, menu `…`, activité éventuelle et progression. Les détails commencent fermés. Déplier révèle le résumé, les étapes manuelles et les plans attachés avec leur pourcentage. Un lien de plan ouvre l’onglet Session et déplie ce plan. Ajouter un jalon par une ligne de création à la fin. Menu : monter, descendre, supprimer avec confirmation en deux étapes.

### Onglet Session

Afficher d’abord les plans liés à la conversation courante, dépliés par défaut, puis les autres plans du projet, repliés par défaut. Respecter ensuite les choix explicites de repli de l’utilisateur. Une création ouvre son plan. Dans le portage, conserver le repli par slug pour plusieurs cartes ; la référence ne mémorise qu’un slug explicitement replié à la fois.

En-tête de plan : disclosure, titre éditable, statuts Active/Done/Paused/Abandoned, menu. La progression et l’activité restent hors de la zone repliable. Détails : résumé éditable, sélection de jalon avec option « Aucun », checklist, journal repliable avec dates et ajout de ligne. Menu : ouvrir le fichier Markdown réel, supprimer avec confirmation. La confirmation doit être visible même si la carte est repliée.

### Onglet Backlog

Items ouverts en premier, numéro stable visible, checkbox, texte et note éditables, bouton « Travailler dessus » et menu. Bouton « Tout traiter » si des items sont ouverts. Items terminés masqués par défaut derrière un bouton avec compteur ; ils peuvent être rouverts. Intentions dans leur propre section, sans checkbox et sans lancement individuel de travail. Toujours offrir un point d’ajout d’item et un point d’ajout d’intention.

Menus de ligne : convertir item/intention, monter, descendre, supprimer. La référence supprime ces lignes directement ; une confirmation ou un undo peut être ajouté selon la convention du harness cible, mais les suppressions de cartes restent confirmées. Les erreurs de commande apparaissent dans le backlog. Ne pas offrir une action utilisable « Travailler dessus » sur un item fermé sans d’abord proposer sa réouverture.

### États hors contenu

Prévoir chargement initial, erreur de lecture avec Réessayer, aucun projet, projet non initialisé avec action de création, erreur d’initialisation et document vide. Le bouton Fermer reste utilisable dans tous les cas. Désactiver l’action d’initialisation pendant son exécution et la réactiver après succès ou échec. Une erreur n’est jamais rendue comme une Roadmap vide valide.

## 10. Édition directe et clavier

Chaque texte existant se transforme au clic en textarea qui conserve largeur, typographie, line-height, padding et hauteur apparente. Tous les champs existants font du wrapping, même ceux dont la donnée interdit les sauts de ligne. Éviter le remplacement d’un paragraphe de plusieurs lignes par un input monoligne condensé.

Au clic/pointeur, calculer l’offset textuel à la position du clic et placer le curseur au même caractère. APIs possibles : `caretPositionFromPoint`, repli Safari `caretRangeFromPoint`, puis Range pour compter le préfixe. Au clavier, placer le curseur à la fin. Utiliser un focus sans scroll involontaire et une mesure de hauteur avant paint. Adapter la hauteur au contenu et aux changements de largeur, sans boucle ResizeObserver.

| Action | Résultat |
| --- | --- |
| Enter dans un champ ordinaire | Sauvegarder |
| Blur | Sauvegarder si modifié |
| Escape | Annuler le brouillon |
| Shift+Enter dans vision/résumé multiligne | Insérer un saut de ligne |
| Enter dans le texte d’une étape | Sauvegarder puis ouvrir l’ajout d’un frère après cette étape |
| Backspace dans une étape vide | Supprimer cette étape et ses enfants |
| Tab / Shift+Tab dans une étape | Indenter / désindenter |
| Alt+↑ / Alt+↓ dans une étape | Monter / descendre |

Pendant une composition IME, ne pas appliquer les raccourcis structurels. Préserver le brouillon pendant une opération de structure et traiter son éventuel échec. Dédupliquer Enter suivi de blur pour empêcher une double création ou un double journal. Attendre la sauvegarde avant une opération qui dépend de son succès.

Une valeur inchangée ne déclenche pas d’écriture. Pendant une sauvegarde, afficher un état pending et empêcher une double soumission. En cas de rejet, la référence revient à la valeur serveur avec une erreur locale ; pour le portage, conserver aussi le brouillon récupérable afin d’éviter une perte de saisie. Ne pas annoncer le succès avant la réponse serveur.

Les mêmes actions de structure doivent être accessibles par le menu tactile `…`, sans clavier physique. Les champs de création actuels sont des inputs simples ; leur remplacement par un textarea cohérent avec les champs existants est demandé pour le portage quand le texte wrappe.

## 11. Esthétique, accessibilité et adaptation

Reprendre les tokens de thème du harness cible : fond de panneau, surface de carte élevée, bordure discrète, texte principal/secondaire/atténué, couleur d’accent et erreur. Éviter les couleurs fixes qui ne fonctionnent que sur le thème sombre de référence.

Repères géométriques : panneau padding 12 px et gap 16 px ; cartes padding 14 px, rayon 16 px, espacement interne 12 px ; bloc global padding 16 px et rayon 12 px ; barre 6 px ; chiffre global 28 px à chiffres tabulaires ; titre panneau 18 px ; texte desktop 14 px / 22 px ; notes secondaires autour de 12 px. Ce sont des repères de fidélité, pas une raison de casser les composants natifs du harness cible.

Mobile sous 768 px : texte éditable au moins 16 px, line-height 24 px ; contrôles de fermeture, menu et disclosure 44 × 44 px ; onglets, chips, liens d’activité, sélecteurs et actions tactiles hauteur minimale 44 px. Réduire les indentations des arbres. Faire revenir les statuts à la ligne sans comprimer le titre. Aucun scroll horizontal, y compris avec un titre de 200 caractères sans espace.

Respecter les safe areas haute/basse/latérales. Si un bouton fixe de réouverture de sidebar recouvre le coin supérieur, réserver sa place dans l’en-tête ; la référence laisse 54 px en plus de l’inset gauche. Ne pas appliquer deux fois l’inset déjà fourni par le shell cible. Vérifier en PWA iPhone et avec clavier logiciel ouvert.

Onglets accessibles : rôles tablist/tab/tabpanel, aria-selected, liens aria-controls/aria-labelledby, un seul tabIndex 0, déplacement avec ←/→ et Home/End. Disclosure avec aria-expanded. Barres avec role progressbar et valeurs min/max/now. Boutons icône avec nom accessible. Menus fermables par Escape et clic extérieur, focus rendu au déclencheur. Alertes de sauvegarde avec role alert. Les contrôles masqués ne doivent pas rester tabulables.

Activité : bordure d’accent et trait intérieur gauche 3 px sur la carte, texte d’étape coloré, badge indépendant. Le sablier de 14 px peut pivoter doucement sur 2,4 s. Les transitions de hover, chevron et progression suivent les tokens de durée du produit. Respecter `prefers-reduced-motion` : aucune animation indispensable à la compréhension, aucun clignotement. Le texte du badge complète la couleur.

## 12. Synchronisation de l’interface

Conserver par conversation : dernier Project reçu, activités, état idle/loading/ready/error, erreur, état aucun projet, onglet, état de repli et ouverture. Ne pas stocker cette présentation dans les documents Roadmap. Libérer le store quand la conversation quitte le cycle de vie client.

Un changement du projet recharge tous ses stores ouverts. Ne pas ignorer `actor:user`. Appliquer les retours de mutations à leur document respectif. Un changement de plan influence aussi le jalon et le global ; le portage doit garantir leur actualisation cohérente et ne pas dépendre d’un événement perdu.

La navigation, les replis et les lectures ne créent aucun message utilisateur ni appel LLM. Les actions « travailler » en créent explicitement un. L’ouverture d’une conversation de travail ne doit pas reprendre automatiquement son goal ni ses sous-agents.

## 13. Renforcements exigés pour le portage

Ces points proviennent de la lecture du code et de ses limites ; ils ne sont pas des garanties déjà démontrées dans Mako.

| Risque de la référence | Exigence pour le harness cible |
| --- | --- |
| File de mutations en mémoire d’un seul processus | Si plusieurs processus écrivent le même projet, un seul propriétaire d’écriture ou un verrou/transaction interprocessus ; un simple Promise-chain ne suffit pas |
| Écriture atomique par fichier, opérations multi-fichiers séquentielles | Suppression de jalon + détachement, et mutations composées : transaction ou protocole de reprise documenté ; tester un échec intermédiaire |
| Lecture/réponse de mutation sans révision serveur | Révision monotone par projet/document ou ETag ; ignorer toute réponse antérieure à l’état déjà appliqué |
| Remplacement complet fondé sur un ancien snapshot | `expectedRevision` pour les remplacements et les champs modifiés concurremment ; conflit explicite, relecture et résolution, sans écrasement silencieux |
| Retour de mutation Plan sans Overview recalculé | Réponse cohérente avec agrégats affectés, ou invalidation/relecture versionnée garantie |
| `lastEdit` ne conserve que le dernier auteur et `markRead` est global à l’agent | Suivre les révisions lues par document ; une lecture backlog ne doit pas acquitter les éditions d’un plan non lu |
| Vision protégée par une consigne de relecture seulement | Écriture conditionnelle si toujours vide/à la même révision ; préserver la vision saisie entre la lecture et le résultat du modèle |
| Watcher externe sans transaction avec l’éditeur de fichiers | Vérifier révision/hash avant réécriture ; ne pas promettre de fusion caractère par caractère |
| Confirm de suppression d’un plan rendu dans le corps déplié | Afficher la confirmation indépendamment du repli |
| État local avec un seul plan explicitement replié | Conserver une préférence par carte pour éviter qu’une autre action ne la rouvre |
| Texte de commande backlog ambigu sur les numéros à terminer | Générer une consigne qui ne coche que l’item effectivement terminé |
| Bouton de travail présent aussi sur les items fermés | Masquer/désactiver ou proposer explicitement de rouvrir |
| Collision de titre de jalon : suffixage dans l’outil mais refus dans la création UI/service | Uniformiser la création implicite entre les deux voies ; une création explicite en conflit reste une erreur |
| Chemin d’ouverture `.mako/roadmap` codé dans le client | Retourner le chemin serveur résolu, compatible avec directory configurable |
| Profondeur bornée mais petit espace d’IDs et imports partiellement permissifs | Valider unicité, format, bornes et capacité d’allocation ; échouer proprement au lieu de boucler ou changer les références à chaque lecture |
| Édition Enter/blur et opérations structurelles asynchrones | Une soumission unique, brouillon récupérable, séquencement des actions dépendantes et erreurs visibles |
| Consignes agent de maintenance sans enforcement | Tester les outils et l’intégration ; ne pas promettre que chaque modèle appellera toujours roadmap_work sans instrumentation |
| Hooks plan/todo déclenchés depuis les événements de session | Rendre l’effet idempotent si le moteur cible rejoue un événement ; ne pas créer deux plans ou réécrire les checks au replay |

Les erreurs d’accès aux fichiers doivent distinguer absence et permission/I/O. Un fichier illisible ne doit jamais être traité comme absent puis écrasé. Les identifiants et slugs non valides doivent être rejetés à la frontière JSON/fichier. Les contenus de Roadmap sont des données utilisateur : ne pas exécuter du HTML ou interpréter leurs paragraphes comme des instructions système privilégiées.

L’activité ne nécessite pas de CRDT ni de sauvegarde durable. Dans un déploiement distribué, la rattacher à un propriétaire/run vivant avec expiration ou heartbeat si les événements de terminaison peuvent manquer. Cette expiration est une extension d’architecture, pas un comportement présent dans la version locale. Les cibles actives ne doivent jamais survivre indéfiniment à la perte de leur propriétaire.

## 14. Critères d’acceptation

Chaque critère doit être testé via la voie réelle concernée ; des mocks de composants seuls ne prouvent pas le raccordement entre outils, serveur et navigateur. Les tests automatisés peuvent utiliser un modèle simulé déterministe ; aucun modèle payant n’est nécessaire pour les règles métier.

| ID | Scénario et résultat attendu |
| --- | --- |
| D01 | Projet vide : lecture sans démarrage d’agent, création idempotente, données existantes préservées |
| D02 | Deux conversations d’un même projet partagent la même Roadmap ; deux projets sont isolés |
| D03 | Round-trip des trois documents : IDs, notes multilignes, journal, attribution et compteur conservés |
| D04 | Ajouter une étape externe sans ID : ID stabilisé par réparation, stable à la lecture suivante |
| D05 | Renommer/déplacer/remplacer en conservant les IDs : checks et notes préservés ; quatrième niveau refusé |
| D06 | Cocher parent, décocher parent et enfants : comportement exact de la section 4 |
| D07 | Exemple 58 % jalon / 67 % global ; plans non attachés, vides/done, paused/abandoned et backlog exclus/inclus selon la formule |
| D08 | Suppression/conversion backlog : aucun numéro réutilisé ; conversion note vers item ouvert |
| D09 | Slug malveillant, texte vide, document trop grand, permissions refusées : erreur stable, aucune perte de fichier |
| D10 | Plusieurs mutations granulaires concurrentes : aucun champ sans rapport perdu ; queue utilisable après un échec |
| D11 | Remplacement à révision périmée et panne multi-fichiers : conflit ou reprise déterministe, pas de demi-succès présenté comme complet |
| A01 | Les six outils sont réellement découverts par l’agent et les résultats de création fournissent des références réutilisables |
| A02 | Appel vision seul : aucune création de jalon ; une vision concurrente existante est préservée |
| A03 | Plan approuvé : un plan créé ; plan refusé/erreur/sous-agent : pas d’auto-création |
| A04 | Todo liée : activité in_progress et check completed selon la politique racine/sous-agent explicite |
| A05 | Backlog sélection invalide : aucun envoi partiel ; sélection valide : message journalisé ; un seul item fini ne ferme pas les autres |
| A06 | Édition utilisateur entre deux tours : le contexte demande de relire le document réellement modifié |
| W01 | roadmap_work valide : badge immédiat sur ligne, parents et carte repliée ; aucun octet ni lastEdit documentaire modifié |
| W02 | Deux workers sur une cible : deux liens exacts ; plusieurs cibles du même worker : pas de doublon de lien sur la carte |
| W03 | Plan attaché actif : jalon signalé ; étape supprimée : plus de faux signal sur ses ancêtres |
| W04 | Fin de tour sans goal : clear ; continuation du même goal armé : conservation ; pause/édition/fin/nouveau message/annulation : clear |
| W05 | Pause ou clear pendant validation asynchrone : la réponse tardive ne restaure rien ; une déclaration récente gagne sur une ancienne |
| W06 | Déconnexion : overlay vidé ; ancien baseline tardif ignoré ; reconnexion : baseline courant ; restart : pas de résurrection |
| W07 | Lien sous-agent profond : conversation exacte via son parent direct, aucun tour lancé ; indisponibilité signalée |
| U01 | Desktop 1440×1000 et panneau étroit : titre, global et onglets visibles au scroll ; plans/jalons repliés gardent progression et activité |
| U02 | Mobile 320, 375 et 393 px : aucun débordement, safe areas, contrôle Fermer permanent, bouton Roadmap plein de 40×40 comme Artefacts |
| U03 | Clic au milieu d’une ligne visuelle : curseur au bon caractère, largeur/hauteur stables à la tolérance typographique près ; ajout de texte agrandit l’éditeur |
| U04 | Enter/blur : une seule sauvegarde/création ; Escape annule ; IME ne déclenche pas de déplacement ou suppression |
| U05 | Tous les raccourcis d’étapes et leurs équivalents menus fonctionnent ; erreur de déplacement affichée |
| U06 | Vision fermée : texte et champs non visibles/non tabulables ; clic de repli ne produit aucune écriture ni requête LLM |
| U07 | Toutes les erreurs initiales et de sauvegarde ont une issue utilisable ; aucune erreur présentée comme un document vide |
| U08 | Deux onglets : édition user visible dans l’autre ; réponses réseau inversées ne font pas revenir un ancien état ou pourcentage |
| U09 | Clavier seul, focus menus, labels ARIA, reduced motion et Safari/PWA avec clavier logiciel validés |
| U10 | Suppression d’une carte repliée : confirmation visible ; ouverture du Markdown fonctionne avec un directory non standard |

Pour les tests visuels, utiliser des titres longs avec et sans espaces, trois niveaux de checklist, résumés multilignes, plusieurs agents, des chiffres de progression décimaux et un projet sans plan. Fournir des captures desktop et mobile et une courte démonstration du parcours outil → badge → conversation → clear. Une capture statique avec un badge injecté ne valide pas le cycle de vie réel.

## 15. Ordre d’implémentation et livraison

1. Identifier les points d’intégration du harness cible : projets, sessions froides, autorisations, outils, événements, objectifs/runs, todos, UI de détails et navigation sous-agent.
2. Implémenter modèle, codec ou persistance équivalente, opérations atomiques, calculs et tests métier.
3. Exposer le service à l’interface avec révisions, erreurs stables et événements de changement.
4. Enregistrer les six outils, commande backlog, contexte, génération de vision et adaptateurs plan/todo.
5. Livrer les trois onglets et l’édition directe desktop/mobile avec cas vides et erreurs.
6. Raccorder l’activité à des appels réels et aux transitions effectives des goals/runs ; valider les courses avant de polir les animations.
7. Vérifier le parcours assemblé, la concurrence multi-onglets, la navigation de sous-agents et la reconnexion.
8. Fournir code, tests, preuve visuelle, explication des écarts, configuration et instructions de lancement. Séparer « implémenté », « testé », « intégré », « déployé » et « observé ».

Hors périmètre obligatoire : drag-and-drop, Gantt, calendrier, estimation de durée, graphe de dépendances, éditeur Markdown brut dans le panneau, commentaires collaboratifs, CRDT, moteur de review autonome ou lancement automatique de sous-agents. Leur absence ne bloque pas la parité décrite ici.

## 16. Carte des sources de référence

Racine locale de référence : `/Users/jeremyzeler-maury/Local Documents/Repos/MakoHarness`. Les chemins ci-dessous sont relatifs à cette racine ; l’implémentation du nouveau harness ne doit pas en dépendre.

| Sujet | Sources |
| --- | --- |
| Données publiques | `packages/plan/roadmap/src/types.ts` |
| Arbres, références, calculs élémentaires, slugs | `packages/plan/roadmap/src/model.ts` |
| Grammaire Markdown | `packages/plan/roadmap/src/markdown.ts` |
| Service, progression composée, I/O, Remote, activité, goals, contexte, seed/todo | `packages/plan/roadmap/src/index.ts` |
| Codes d’erreur et invariants événementiels | `packages/plan/roadmap/src/runtime.ts`, `invariant.ts` |
| Outils et schémas modèle | `packages/plan/tool-roadmap/src/index.ts` |
| Commande utilisateur | `packages/plan/command-backlog/src/index.ts` |
| Store et réponses concurrentes | `packages/client/ui-roadmap/src/client/roadmap-store.ts` |
| Slots, événements, connexion et navigation | `packages/client/ui-roadmap/src/client/index.ts` |
| Structure du panneau | `packages/client/ui-roadmap/src/client/RoadmapPanel.tsx`, `RoadmapHeaderAction.tsx` |
| Trois onglets | `packages/client/ui-roadmap/src/client/GlobalTab.tsx`, `SessionTab.tsx`, `BacklogTab.tsx` |
| Édition et arbre interactif | `packages/client/ui-roadmap/src/client/InlineText.tsx`, `Checklist.tsx` |
| Matching et badges | `packages/client/ui-roadmap/src/client/Activity.tsx` |
| Primitives, accessibilité, labels et style | `packages/client/ui-roadmap/src/client/bits.tsx`, `AccessibleTabs.tsx`, `locales.ts`, `copy.ts`, `roadmap.module.css` |
| Lecture des sessions froides | `packages/host/apiproxy/src/api-proxy.ts` et tests `api-proxy-cold.spec.ts`, `api-proxy-roadmap-remote.spec.ts` |
| Tests domaine/outils/UI | Répertoires `tests/` de roadmap, tool-roadmap et ui-roadmap |
| Parcours navigateur assemblé | `apps/web/tests/roadmap-layout.e2e.ts` |
| Transcript agent assemblé | `examples/headless-agent/tests/roadmap.snapshot.ts`, fixture `fixtures/plan/roadmap/cordis.yml` et `fixtures/headless-driver.ts` |

La présence d’un test dans cette carte n’atteste pas qu’il passe sur le harness cible. Les critères de la section 14 sont la réception attendue, indépendamment de l’organisation de ses tests.
