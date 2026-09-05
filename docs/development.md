# Développement et fonctionnement

[← Retour au README](../README.md)

## Installation et développement

Prérequis : **Node.js 22.8 ou ultérieur**, Prime Agent installé et un fournisseur déjà configuré dans Prime Agent. La version locale utilisée lors du développement est **0.9.1**. Le GUI réutilise les comptes existants et ne demande pas de copier une clé API dans le navigateur.

```powershell
npm ci
npm run setup:runtime
npm start
```

Il n’y a pas d’étape de compilation. Les bibliothèques Markdown sont servies localement depuis `node_modules`, sans CDN. `npm start` garde le serveur dans votre terminal ; utilisez le lanceur VBS pour un démarrage entièrement silencieux.

Sous Windows, le moteur Python est provisionné dans `.local/kernel-venv` pour contourner un problème de chemin `bin/python` du CLI 0.9.1. La commande `npm run setup:runtime` prépare ce moteur ; sinon, la préparation se fait au premier message et nécessite Internet. Le GUI transmet ensuite son chemin à Prime Agent sans modifier l’installation globale. Un `PRIME_AGENT_KERNEL_PYTHON` explicitement configuré reste prioritaire.

## Processus Windows silencieux

Le serveur appelle directement le fichier JavaScript du CLI avec Node, sans passer par un lanceur `.cmd` ni une console PowerShell.

Le Studio démarre son propre superviseur Prime Agent en arrière-plan, sur une adresse de communication privée. Il ne réutilise pas le superviseur d’un terminal externe. Les demandes partagent ce moteur, mais chacune garde son client : **Arrêter** demande au client concerné de fermer proprement sa session et ses sous-agents. L’arrêt forcé de son processus reste un recours si le client ne répond plus.

Le correctif local `runtime/windows-hidden.cjs` applique `windowsHide` aux sous-processus Node du CLI. Le module `runtime/python/sitecustomize.py` applique `CREATE_NO_WINDOW` et `SW_HIDE` aux sous-processus du moteur Python, y compris leurs appels PowerShell. Ces réglages sont transmis uniquement à l’arbre de processus lancé par le GUI. L’installation globale de Prime Agent n’est pas modifiée.

Le correctif `runtime/windows-session-leases.cjs` permet à Prime Agent 0.9.1 de reconnaître une collision de dossiers sous Windows lors de la récupération d’un verrou de session. Prime Agent conserve ses vérifications du PID et de sa date de démarrage : le correctif ne supprime pas les verrous de sessions encore actives.

Le chargeur local `runtime/headless-loader.mjs` active l’attente native de fin des sous-agents avant que le client JSON ferme sa session. La réponse du parent ne coupe donc pas les tâches qu’il vient de déléguer. Le changement s’applique en mémoire, uniquement au mode d’exécution utilisé par le Studio ; les fichiers installés de Prime Agent restent intacts. Si une mise à jour du CLI change ce point d’intégration, le Studio affiche une erreur explicite plutôt que d’appliquer une transformation incertaine.

La fermeture d’un onglet ne tue pas l’agent. Le bouton **Arrêter**, lui, ferme l’exécution et ses descendants. Une fermeture ou un redémarrage du serveur interrompt les exécutions en cours ; les messages déjà enregistrés restent consultables et la conversation peut être reprise.

## Vérifications

```powershell
npm run check
npm test
npm run test:ui
npm run test:mobile
npm run test:layout
npm run test:attachments
npm run test:pwa
```

Les tests automatiques utilisent des données temporaires et un faux moteur, sans consommation de modèle. Les tests Windows vérifient également les paramètres natifs de création des processus, le lancement VBS, la réutilisation du serveur et l’arrêt des descendants. Les tests de navigateur utilisent Microsoft Edge installé localement et produisent des captures dans `test-results/`.

Test réel facultatif avec le compte Luna déjà configuré (**consomme des appels au modèle**) :

```powershell
node scripts/smoke-luna.mjs
```

Il utilise `openai-codex/gpt-5.6-luna` et des sessions isolées dans `.local/smoke-sessions`. Il vérifie un appel de l’outil Python vers PowerShell avec le correctif silencieux chargé.

Le scénario réel de délégation, reprise avec outil et interruption se lance explicitement avec `node scripts/smoke-worker-recovery.mjs --run-luna`. Il utilise uniquement Luna et conserve ses sessions et rapports dans `.local/recovery-smoke-workspace/`.

## Messages pendant une exécution

Pendant une exécution, le champ permet **Réorienter** (après les outils de l’étape courante) ou **À la suite** (après la réponse courante). Les messages en attente peuvent être modifiés, réordonnés, retirés ou déplacés entre ces deux modes. Le carré d’arrêt reste une commande distincte. Une confirmation d’envoi signifie que le moteur a accepté le message ; sa transmission apparaît ensuite dans la conversation.

`lib/live-session-client.mjs` utilise les commandes du daemon existant, sans créer ni relancer de session. Les routes `/api/live/sessions/:id` restent protégées par l’authentification et les permissions de l’accès mobile habituel.

Les vérifications ciblées sont `node scripts/test-live-messages-ui.mjs` et `node scripts/test-live-integration.mjs`. Le test `node scripts/smoke-live-messages.mjs --run-native` utilise le Prime Agent installé avec un véritable outil Python et un fournisseur simulé sur localhost, sans appel à un compte de modèle.

## Pièces jointes

`lib/images.mjs` valide les images PNG/JPEG/GIF/WebP. Au lancement, le Studio utilise les arguments natifs `@chemin` du CLI avec les images conservées dans `.studio-images/` ; les commandes RPC `steer` et `follow_up` reçoivent directement les blocs `ImageContent`. Les deux chemins enregistrent les pixels dans les messages natifs. Les éditions de file omettent volontairement le champ `images`, ce qui conserve les images attachées selon le contrat natif de Prime Agent 0.9.1.

`lib/files.mjs` conserve les autres fichiers sous des identifiants aléatoires dans `.local/attachments/`. Les noms d’origine sont des métadonnées ; leurs octets ne sont pas interprétés comme du texte. Le message contient un bloc `prime_studio_files` listant les chemins locaux accessibles aux outils. L’historique affiche des liens de téléchargement authentifiés via `GET /api/files/:id`. L’édition d’un message en attente conserve ses références de fichiers.

Le navigateur propose deux sélecteurs, le dépôt dans la conversation et le collage des objets `File` du presse-papiers. Un chemin copié sous forme de simple texte n’est pas importé automatiquement. Les brouillons de pièces jointes utilisent IndexedDB et sont retirés après acceptation seulement. Le serveur annonce cette capacité dans le bootstrap pour éviter un envoi silencieusement ignoré par un ancien serveur encore en cours d’exécution.

```powershell
npm run test:attachments
node scripts/smoke-live-messages.mjs --run-native --attachments
```

Le premier scénario vérifie les sélecteurs réels, le collage, le dépôt, les brouillons, les téléchargements, les deux modes d’envoi et la disposition mobile/PC via la passerelle authentifiée. Le second utilise le vrai moteur, un outil Python et un fournisseur simulé local : il vérifie les pixels reçus, la lecture des fichiers et leur conservation après édition de la file, sans consommer de compte modèle ni toucher aux sessions utilisateur.

## PWA et HTTPS privé

`public/manifest.webmanifest` décrit l’application autonome et ses icônes. `public/pwa.js` propose le dialogue natif d’installation ou une aide adaptée au navigateur, sur la page de connexion et dans le menu. Le service worker `/service-worker.js` conserve uniquement une liste fixe d’icônes, le manifeste, une feuille de style et l’écran de reconnexion. Les API, les flux SSE, les soumissions et les fichiers utilisateur sont exclus. Les pages authentifiées ne sont jamais enregistrées dans Cache Storage.

`lib/pwa.mjs` définit les seules ressources publiques nécessaires à l’installation et valide l’origine HTTPS Tailscale. `lib/lan.mjs` accepte cette origine uniquement sur la passerelle loopback dédiée, conserve les contrôles Host/Origin et émet un cookie Secure. Les en-têtes de proxy ne définissent pas l’origine de confiance. `scripts/enable-pwa.mjs` préserve la configuration existante et pointe Tailscale Serve vers cette passerelle, jamais directement vers l’API locale.

`npm run test:pwa` utilise un profil Edge temporaire pour vérifier les critères d’installation via CDP, le service worker, l’absence de données privées dans le cache, le retour hors ligne, la conservation des brouillons et les instructions iPhone. Le dialogue d’installation est simulé pour ne pas installer réellement une application sur le PC pendant les tests. Les tests HTTP dans `test/pwa.test.mjs` couvrent l’authentification HTTPS, les ressources publiques, les origines et les conflits de configuration Serve.

`public/viewport.js` ajuste la hauteur du chat au viewport visible, y compris lorsque le clavier réduit seulement celui-ci. Le zoom tactile reste libre. Les marges système sont réservées autour de l’interface ; le pied de page secondaire est masqué sur mobile. `npm run test:layout` vérifie une longue conversation en portrait, paysage et avec des géométries simulées de clavier et de barre système. Ces simulations ne remplacent pas un test sur un téléphone physique.

Le test PWA couvre aussi une arrivée depuis un autre site suivie d’un rechargement avec le service worker actif. Ce relais conserve le mode de navigation mais peut transmettre `Sec-Fetch-Dest: empty`. La passerelle accepte ce cas uniquement pour les ouvertures GET de `/` et `/index.html`, tout en conservant les vérifications Host/Origin, l’authentification et les protections des API.

## Projets, déconnexion et MCP

`npm run test:workspace` vérifie les menus de projet et de session sur écran tactile, leur stabilité lors du redimensionnement, le retrait confirmé avec conservation des fichiers, les formulaires MCP et la déconnexion d’un navigateur pendant une exécution simulée. Les captures PC/mobile sont conservées dans `test-results/`.

Sous Windows, `lib/open-directory.mjs` utilise un assistant PowerShell masqué et une demande ShellExecute explicitement visible pour l’Explorateur. Une fenêtre existante du même dossier est réutilisée, y compris si un ancien lancement l’avait masquée. La notification de succès attend la confirmation d’une fenêtre visible et non minimisée ; les processus des agents conservent leur lancement silencieux. Le chemin est transmis comme donnée, sans construction de commande PowerShell.

`npm run test:explorer` est un test Windows facultatif qui ouvre réellement un dossier temporaire dans l’Explorateur depuis un processus masqué, vérifie sa visibilité, reproduit une fenêtre invisible et vérifie sa restauration sans doublon. Il ferme uniquement la fenêtre du dossier temporaire créé par le scénario. Ce test de bureau est séparé de `npm test`, qui ne doit pas ouvrir de dossiers pendant ses vérifications ordinaires.

`lib/mcp-config.mjs` valide le format natif, masque les secrets renvoyés au navigateur et écrit uniquement `mcpServers` avec `FileSettingsStorage.withLock`. Les valeurs par défaut des modèles utilisent le même verrou. Chaque modification MCP vérifie la révision de la configuration pour refuser un écrasement depuis un écran périmé. `lib/prime-native.mjs` charge les modules de l’installation Prime Agent résolue par le Studio ; une installation incompatible produit une erreur explicite.

`lib/mcp-service.mjs` possède uniquement ses processus de découverte et d’autorisation. `scripts/mcp-probe-worker.mjs` et `scripts/mcp-probe.py` utilisent le stockage OAuth et le client Python `rlm.mcp` natifs. `scripts/mcp-oauth-worker.mjs` utilise le fournisseur OAuth natif avec saisie de l’URL complète depuis un autre appareil. Les délais, annulations et arrêts sont limités aux processus du gestionnaire. Aucun arrêt de daemon ni rechargement d’une session utilisateur n’est déclenché.

`test/mcp.test.mjs` couvre les écritures concurrentes avec les réglages de modèles, les secrets, les conflits, les serveurs réservés, une connexion stdio et une connexion HTTP avec le véritable client Python, ainsi qu’un parcours OAuth HTTPS complet avec PKCE et retour mobile. Ces tests utilisent uniquement des serveurs, fichiers et certificats temporaires ; ils n’utilisent aucun compte de fournisseur. Ils nécessitent Prime Agent installé et, pour les connexions, `npm run setup:runtime`.

Les routes MCP sont `/api/mcp` (GET/POST/PATCH/DELETE), `/api/mcp/test`, `/api/mcp/login`, `/api/mcp/disconnect`, `/api/mcp/login/complete` (POST), et `/api/mcp/login/:id` (GET/DELETE). La passerelle les refuse en lecture seule. `POST /lan/logout` révoque le cookie courant et ses connexions de proxy, y compris SSE, sans arrêter les exécutions. `DELETE /api/projects` retire les métadonnées de projet ; un marqueur persistant empêche leur réimportation immédiate depuis les sessions natives.

## Organisation du code

`server.mjs` expose l’API locale et les flux SSE. `lib/store.mjs` lit les sessions natives et conserve les préférences. `lib/agent.mjs` gère le CLI, les modèles, les événements et l’arrêt. `public/` contient l’interface. `runtime/` isole les correctifs de sous-processus. `scripts/` contient les lanceurs et outils de vérification.

Les principales routes sont `GET /api/bootstrap`, `GET /api/overview`, `GET /api/history?id=…`, les routes locales `/api/model-config` et `/api/model-defaults`, `POST /api/projects`, `PATCH /api/projects`, `PATCH /api/sessions`, `POST /api/runs`, `GET /api/runs/:id/events` et `POST /api/runs/:id/stop`. Les flux SSE acceptent `Last-Event-ID` pour reprendre les événements après une déconnexion.

## Régénérer les captures du README

```powershell
node scripts/capture-readme.mjs
```

Le script ouvre la véritable interface dans Microsoft Edge sans fenêtre visible, sur un serveur temporaire distinct. Les projets, conversations, modèles et événements sont des données de démonstration. Aucun agent natif ni compte de fournisseur n’est utilisé, et aucune session du Studio en cours n’est modifiée.

`npm run test:workspace -- --capture-docs` régénère la capture du gestionnaire MCP avec une configuration de démonstration isolée. Les comptes utilisateur sont conservés.

Les captures sont enregistrées dans `docs/screenshots/`. Quatre vues du bureau sont capturées en 1600 × 1000, dont une conversation avec images, documents et aperçus de pièces jointes. Le sélecteur de modèles est cadré sur sa fenêtre pour rester lisible dans le README. Les fichiers de démonstration restent dans le dossier temporaire du scénario. Le rapport se trouve dans `test-results/readme-captures.json`. `PRIME_STUDIO_BROWSER` permet de choisir un autre canal Playwright installé, par exemple `chrome`.
