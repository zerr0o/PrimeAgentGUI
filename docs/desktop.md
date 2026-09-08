# Application Windows

[English](en/desktop.md) · **Français** · [← Retour au README](../README.fr.md)

L’application **Prime Agent Studio**, construite avec Tauri 2, ouvre le Studio dans une fenêtre Windows dédiée. Son raccourci lance le serveur discrètement ou réutilise celui déjà ouvert. Aucun lancement manuel du VBS n’est nécessaire.

## Installation et premier lancement

Exécutez l’installateur [Prime-Agent-Studio_2.8.1_x64-setup.exe](https://github.com/zerr0o/prime-agent-studio/releases/download/v2.8.1/Prime-Agent-Studio_2.8.1_x64-setup.exe). L’installation est limitée à votre utilisateur Windows et propose les raccourcis du menu Démarrer et du Bureau. Node.js est inclus. L’installateur installe WebView2 si nécessaire ; une connexion Internet peut être requise pour ce composant.

**Prime Agent et uv restent nécessaires sur le PC**, avec un fournisseur configuré. Le moteur Prime Agent, ses comptes et ses sessions ne sont pas réinstallés ni remplacés par cet installateur. Le Studio prépare le noyau Python au besoin lors des exécutions, comme la version navigateur.

Au premier lancement, choisissez **Ouvrir le Studio**. Si vous utilisiez le dépôt avec le lanceur VBS, choisissez d’abord **Reprendre une installation existante** et sélectionnez son dossier, celui qui contient `server.mjs` et `.local`.

La reprise copie les projets, les réglages des sous-agents, les pièces jointes et les accès distants, avec leur PIN. L’installation d’origine est conservée. Si son serveur fonctionne encore, l’application s’y connecte immédiatement et reporte la copie au premier lancement où il sera arrêté. Elle ne coupe aucune exécution. Les sessions Prime Agent restent dans leur emplacement habituel. Après cette reprise, utilisez l’application pour ouvrir le Studio ; l’ancien lanceur conserve sa propre copie des réglages.

Les préférences visuelles et brouillons du navigateur ne sont pas copiés : la fenêtre Tauri dispose de son propre stockage, partagé entre ses ouvertures.

## Fenêtre et arrière-plan

- **Fermer la fenêtre** la masque et conserve l’icône près de l’horloge. Les agents, le serveur et les accès mobiles continuent.
- Un clic sur cette icône ou un nouveau lancement du raccourci retrouve la même fenêtre.
- Le menu de l’icône propose **Ouvrir le Studio**, **Réglages de l’application** et **Quitter l’application**. Quitter ferme Tauri, mais laisse le serveur et les agents travailler.
- Dans **Réglages de l’application**, **Démarrer avec Windows** est désactivé par défaut. L’activer lance le Studio en arrière-plan à votre connexion, sans ouvrir sa fenêtre. Une erreur de démarrage affiche la fenêtre pour permettre une nouvelle tentative.
- Les liens externes s’ouvrent dans votre navigateur habituel. Le LAN, Tailscale, HTTPS et la PWA mobile utilisent toujours le même serveur.

Pour retrouver un serveur arrêté, ouvrez **Réglages de l’application → Ouvrir le Studio**. Ce bouton réutilise une instance existante et n’arrête pas les agents.

Un raccourci Windows peut utiliser l’argument `--settings` pour ouvrir directement les réglages de l’application, y compris lorsqu’elle fonctionne déjà en arrière-plan.

## Données et mises à jour

Les données se trouvent dans `%LOCALAPPDATA%\com.primeagent.studio` :

| Emplacement    | Contenu                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `data`         | Projets, pièces jointes, PIN haché, configuration réseau et journaux du serveur |
| `.local`       | Noyaux Python persistants                                                       |
| `versions`     | Copies immuables des fichiers du serveur et de Node.js                          |
| `webview`      | Préférences visuelles et stockage de la fenêtre                                 |
| `desktop.json` | Préférences du lanceur et installation à reprendre                              |

Une mise à jour installe la nouvelle application et prépare une nouvelle copie du serveur au prochain démarrage nécessaire. Un serveur déjà actif reste utilisé : la nouvelle version du serveur prendra effet après son arrêt volontaire, à la fin de vos exécutions. Les anciennes copies ne sont pas effacées automatiquement afin de préserver les processus encore actifs.

Le correctif **2.8.1** ajoute une réparation ponctuelle au lancement : les dix assistants absents de la release 2.8.0 sont ajoutés à son cache d’origine, même si son serveur fonctionne encore. Les fichiers existants sont conservés. Cette réparation rétablit notamment les messages, la découverte des skills et les fournisseurs sans arrêter les agents.

Dans le menu de l’icône près de l’horloge, ouvrez **Réglages de l’application → Mises à jour → Vérifier les mises à jour**. Si une version stable plus récente est publiée sur GitHub, ses nouveautés et le bouton **Installer et relancer** apparaissent. Le téléchargement affiche sa progression, puis Tauri vérifie la signature avant de lancer l’installation. Aucune installation ne démarre sans ce clic. Le serveur et les agents continuent pendant la relance de l’application.

Une erreur réseau, un catalogue absent ou une signature invalide ne sont jamais présentés comme « à jour ». Vous pouvez réessayer ; les détails techniques sont dans `desktop-update-error.log`, dans le dossier de données. Le catalogue devient disponible lors de la première release contenant `latest.json`. La vérification est manuelle, sans interrogation périodique en arrière-plan.

Les mises à jour portent une signature cryptographique Tauri. Les installateurs ne possèdent pas encore de signature Windows Authenticode : celle-ci demande un certificat Windows distinct.

## Construire et vérifier

Sur Windows, installez les outils Rust/MSVC et les prérequis de développement [Tauri 2](https://v2.tauri.app/start/prerequisites/), puis :

```powershell
npm ci
npm run desktop:build
```

L’installateur se trouve dans `src-tauri/target/release/bundle/nsis`. `npm run desktop:dev` prépare les ressources et lance la version de développement. `npm run desktop:icons` régénère les icônes depuis le SVG ; l’image 256 px doit rester en tête du fichier ICO utilisé par Tauri.

La construction vérifie les références des modules, workers et assistants natifs avant de créer l’installateur. `npm run test:desktop-runtime` teste les ressources préparées dans `.desktop-build` avec les vrais workers Prime Agent, un projet et des comptes isolés : skills Python, prompts et fournisseurs.

`npm run test:desktop` vérifie le binaire debug préalablement compilé : ressources extraites par l’exécutable, messages et noyau Python avec un modèle HTTP local simulé, API des fournisseurs et commandes, réutilisation d’un serveur avec un agent simulé actif, démarrage réel du serveur inclus, instance unique et survie du serveur à la fermeture du processus Tauri. Prime Agent et uv doivent être disponibles. Passez le chemin du binaire après `--` pour tester une autre compilation. `npm run test:desktop-ui` vérifie les adaptations de présentation dans Chrome/Edge. Les tests ne lancent aucun appel payant à un modèle.

Pour les tests isolés, `PRIME_STUDIO_DESKTOP_DATA_ROOT` et `PRIME_STUDIO_DESKTOP_PORT` changent respectivement le dossier de données et le port. Ne les définissez pas pour un usage normal. Le VBS reste disponible pour les installations depuis les sources.

`npm run test:desktop-updates` vérifie les états du panneau en français et anglais. `cargo test --manifest-path src-tauri/Cargo.toml --locked` teste le véritable client de mise à jour contre un serveur local : signature valide, fichier altéré, versions égales/antérieures et catalogue invalide. Les tests n’exécutent aucun installateur.

## Préparer une release avec mise à jour

La clé privée de signature reste hors du dépôt, dans `%USERPROFILE%\.tauri\prime-agent-studio.key` sur le poste de publication. Sauvegardez-la dans un emplacement sûr : les applications installées font confiance à sa clé publique intégrée et une nouvelle clé incompatible empêcherait leurs mises à jour. `desktop:build` utilise cette clé locale ou `TAURI_SIGNING_PRIVATE_KEY` (chemin ou contenu) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Sans clé, `npm run desktop:build -- --no-bundle` permet de compiler seulement l’exécutable.

Après la compilation signée, lancez `npm run desktop:manifest -- chemin/notes.md` (notes facultatives). `.local/desktop-release/v<version>` contient les trois fichiers à joindre ensemble à la release stable `v<version>` : l’installateur au nom sans espaces, sa signature `.sig` et `latest.json`. Ne renommez pas l’installateur après cette étape : le catalogue contient son URL exacte.

Le workflow GitHub **Windows desktop release** se lance manuellement avec un tag stable existant, correspondant à la version de `package.json`. Il teste, compile, signe et prépare une **release brouillon** avec ces trois fichiers. Configurez les secrets du dépôt `TAURI_SIGNING_PRIVATE_KEY` et, si la clé est chiffrée, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Il refuse de remplacer une release déjà publiée. Relisez le brouillon, puis publiez-le comme dernière release stable pour rendre la mise à jour disponible. Ne publiez pas ensuite une release stable sans son catalogue et son installateur.
