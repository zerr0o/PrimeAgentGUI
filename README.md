<p align="center">
  <img src="assets/prime-agent.svg" width="80" alt="Logo Prime Agent Studio">
</p>

<h1 align="center">Prime Agent Studio</h1>

<p align="center">
  <strong>Vos projets. Vos agents. Un seul espace de travail.</strong><br>
  Une interface locale en français pour Prime Agent, pensée pour Windows.
</p>

<p align="center">
  <a href="#démarrage-rapide">Démarrage rapide</a> ·
  <a href="#pendant-que-lagent-travaille">Messages en cours</a> ·
  <a href="#vos-modèles-à-portée-de-main">Modèles</a> ·
  <a href="docs/lan.md">Accès mobile</a> ·
  <a href="docs/development.md">Développement</a>
</p>

![Prime Agent Studio sur PC : projets, conversation, activité de l’agent et panneau de contexte.](docs/screenshots/desktop-conversation.png)

<p align="center"><em>L’interface réelle, avec des données de démonstration. Les captures de ce dépôt ne contiennent aucune conversation personnelle.</em></p>

Prime Agent Studio réunit les sessions de votre **Prime Agent local** dans une application accessible depuis le navigateur. Suivez les réponses en direct, retrouvez vos projets et continuez une conversation sans ouvrir de terminal. Sous Windows, les agents et leurs outils démarrent en arrière-plan, sans fenêtres PowerShell intempestives.

## Ce que vous pouvez faire

| Fonction                           | Dans le Studio                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Organiser vos projets**          | Rechercher, renommer, épingler, archiver et reprendre vos sessions.                              |
| **Suivre le travail**              | Lire les réponses en streaming et déplier une activité regroupant les outils et le raisonnement. |
| **Intervenir en direct**           | Réorienter l’agent ou préparer un message à la suite, sans arrêter son travail.                  |
| **Retrouver vos modèles**          | Rechercher par nom ou fournisseur, gérer vos favoris et choisir le niveau de réflexion.          |
| **Travailler en parallèle**        | Lancer des exécutions dans plusieurs sessions et passer de l’une à l’autre.                      |
| **Retrouver le Studio sur mobile** | Piloter le PC depuis un téléphone sur le réseau local, avec un code d’accès.                     |

Les exécutions continuent lorsque vous changez de session, rechargez la page ou fermez l’onglet. Le serveur doit rester en marche.

## Démarrage rapide

**Prérequis :** Windows, **Node.js 22.8 ou ultérieur**, Prime Agent installé et un fournisseur déjà configuré dans le CLI. L’intégration a été vérifiée avec **Prime Agent 0.9.1** ; les adaptations Windows ciblent cette version.

Dans le dossier du projet :

```powershell
npm ci
npm run setup:runtime
npm run start:silent
```

Le navigateur s’ouvre sur **[127.0.0.1:3088](http://127.0.0.1:3088)**. Ensuite, un double-clic sur **`Lancer Prime Agent.vbs`** suffit : le lanceur réutilise le serveur s’il est déjà ouvert.

1. Ajoutez le dossier d’un projet avec **+** dans l’espace de travail.
2. Ouvrez une session existante ou choisissez **Nouvelle session**.
3. Sélectionnez votre modèle, puis écrivez votre demande.

Le Studio réutilise la configuration de Prime Agent : aucune clé API à coller dans le navigateur. La préparation initiale du moteur Python peut nécessiter une connexion Internet.

| Commande               | Utilité                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run start:silent` | Démarrer en arrière-plan et ouvrir le navigateur.                   |
| `npm run shortcut`     | Créer un raccourci sur le Bureau.                                   |
| `npm start`            | Démarrer avec les journaux dans le terminal, pour le développement. |
| `npm run stop`         | Fermer le serveur et ses exécutions actives.                        |

**Fermer l’onglet laisse les agents travailler.** Le bouton **Arrêter** termine l’exécution sélectionnée ; `Arreter Prime Agent.vbs` ou `npm run stop` ferme tout le Studio.

## Pendant que l’agent travaille

Le champ de saisie reste disponible pendant une exécution. Choisissez le moment où votre message doit être pris en compte :

| Mode           | Quand le message est transmis                                           |
| -------------- | ----------------------------------------------------------------------- |
| **Réorienter** | Après les outils de l’étape courante, pour ajuster la demande en cours. |
| **À la suite** | Après la réponse courante, pour enchaîner avec une nouvelle demande.    |

Vous pouvez modifier les messages en attente, les réordonner, les retirer ou les déplacer d’un mode à l’autre. L’acceptation par le moteur est distincte de la transmission effective, qui apparaît ensuite dans la conversation.

![Messages pendant une exécution sur PC : file d’attente, réorientation, message à la suite et commande d’arrêt séparée.](docs/screenshots/desktop-live-messages.png)

## Vos modèles à portée de main

Recherchez un modèle par son **nom, son fournisseur ou son identifiant**. Les favoris restent en tête du sélecteur et sont enregistrés dans votre navigateur. Le catalogue dépend des modèles disponibles dans votre installation Prime Agent.

<p align="center">
  <img src="docs/screenshots/desktop-models.png" width="560" alt="Sélecteur de modèles sur PC avec recherche, deux favoris et choix automatique de Prime Agent.">
</p>

Sur le PC, **Préférences → Modèles et valeurs par défaut → Configurer** permet de choisir le modèle principal par défaut et de gérer les définitions de modèles personnalisés.

Avec Prime Agent 0.9.1, les sous-agents héritent du modèle parent ; il n’existe pas de réglage global distinct pour eux. Une délégation peut demander un autre modèle via les capacités natives de Prime Agent.

[Consulter le guide des modèles et de la configuration →](docs/configuration.md)

## Un espace pour chaque projet

Retrouvez les conversations d’un projet, filtrez les sessions archivées et gardez les échanges importants épinglés. Le Studio propose les thèmes **sombre, clair et système**, des brouillons locaux, un export Markdown et des raccourcis clavier.

![Vue des sessions d’un projet sur PC, en thème clair, avec recherche et session épinglée.](docs/screenshots/desktop-projects.png)

Les titres, épingles et archives du Studio sont conservés séparément des conversations natives de Prime Agent.

## Aussi depuis votre téléphone

Activez l’accès au réseau local :

```powershell
npm run lan:enable
```

La commande affiche l’adresse à ouvrir et un code à huit chiffres. **Attendez la fin des exécutions, puis redémarrez le Studio** pour appliquer la configuration. Connectez le téléphone au même réseau que le PC.

Vous pouvez créer ou reprendre une session, envoyer des messages et suivre le travail en direct. Le PC exécute les agents et doit rester allumé. Le configurateur de modèles reste réservé au PC.

L’accès utilise HTTP sur le réseau local, avec authentification par code. Le Studio est une application personnelle locale : il n’est pas destiné à être exposé sur Internet.

[Configurer l’accès mobile, le code et le mode lecture seule →](docs/lan.md)

## Documentation

| Guide                                             | Contenu                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Configuration et données](docs/configuration.md) | Modèles, valeurs par défaut, stockage et variables d’environnement.           |
| [Accès mobile](docs/lan.md)                       | Activation, adresse réseau, authentification et permissions.                  |
| [Développement](docs/development.md)              | Architecture, processus Windows silencieux, tests et captures reproductibles. |

Pour vérifier le projet :

```powershell
npm run check
npm test
npm run test:ui
npm run test:mobile
```

Les tests automatiques utilisent des données temporaires et un moteur simulé. Les tests de navigateur nécessitent Microsoft Edge ; les tests réels facultatifs avec Luna sont documentés séparément.

---

<p align="center">
  <strong>Prime Agent Studio</strong><br>
  Une interface locale autour de Prime Agent, avec vos sessions et votre configuration existantes.
</p>
