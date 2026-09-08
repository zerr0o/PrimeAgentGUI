# Application Windows

[English](en/desktop.md) · **Français** · [← Retour au README](../README.fr.md)

L’application **Prime Agent Studio**, construite avec Tauri 2, ouvre le Studio dans une fenêtre Windows dédiée. Son raccourci lance le serveur discrètement ou réutilise celui déjà ouvert. Aucun lancement manuel du VBS n’est nécessaire.

## Installation et premier lancement

Exécutez l’installateur `Prime Agent Studio_2.8.0_x64-setup.exe`. L’installation est limitée à votre utilisateur Windows et propose les raccourcis du menu Démarrer et du Bureau. Node.js est inclus. L’installateur installe WebView2 si nécessaire ; une connexion Internet peut être requise pour ce composant.

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

Les installateurs produits localement ne sont pas signés numériquement. La publication d’un installateur signé demande un certificat de signature Windows ; les mises à jour automatiques ne sont pas configurées dans cette première version.

## Construire et vérifier

Sur Windows, installez les outils Rust/MSVC et les prérequis de développement [Tauri 2](https://v2.tauri.app/start/prerequisites/), puis :

```powershell
npm ci
npm run desktop:build
```

L’installateur se trouve dans `src-tauri/target/release/bundle/nsis`. `npm run desktop:dev` prépare les ressources et lance la version de développement. `npm run desktop:icons` régénère les icônes depuis le SVG ; l’image 256 px doit rester en tête du fichier ICO utilisé par Tauri.

`npm run test:desktop` vérifie le binaire debug préalablement compilé : réutilisation d’un serveur avec un agent simulé actif, démarrage réel du serveur inclus, instance unique et survie du serveur à la fermeture du processus Tauri. Passez le chemin du binaire après `--` pour tester une autre compilation. `npm run test:desktop-ui` vérifie les adaptations de présentation dans Chrome/Edge. Les tests ne lancent aucun appel payant à un modèle.

Pour les tests isolés, `PRIME_STUDIO_DESKTOP_DATA_ROOT` et `PRIME_STUDIO_DESKTOP_PORT` changent respectivement le dossier de données et le port. Ne les définissez pas pour un usage normal. Le VBS reste disponible pour les installations depuis les sources.
