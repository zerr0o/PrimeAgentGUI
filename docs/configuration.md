# Configuration et données locales

[← Retour au README](../README.md)

## Configurer les modèles

Ouvrez **Préférences → Modèles et valeurs par défaut → Configurer** sur le PC. La première zone choisit le modèle par défaut de l’agent principal. Elle écrit uniquement les champs natifs `defaultProvider` et `defaultModel` dans `~/.prime/agent/settings.json`, comme Prime Agent 0.9.1. Le choix est appliqué au sélecteur du Studio et aux prochains lancements. **Choix automatique de Prime Agent** supprime ces deux champs.

Prime Agent 0.9.1 n’a pas de réglage persistant distinct pour le modèle des sous-agents. Un sous-agent RLM hérite du modèle de son parent. L’agent peut demander un autre modèle pour une délégation précise avec l’argument natif `model` de `rlm(…)`. Le Studio affiche donc l’héritage réel, sans créer un faux « modèle par défaut des sous-agents ».

Le même écran ajoute, modifie ou supprime aussi des définitions personnalisées dans `~/.prime/agent/models.json`, puis actualise le sélecteur. Les champs avancés déjà présents sont conservés. Pour un nouveau fournisseur, indiquez le **nom** d’une variable d’environnement, jamais sa valeur secrète. Le serveur n’accepte que les quatre protocoles documentés par Prime Agent et bloque les URL contenant des identifiants, paramètres ou fragments. HTTPS est obligatoire hors service loopback local. Une adresse associée à une identification existante ne peut pas être remplacée depuis le formulaire, afin d’éviter l’envoi accidentel d’une clé vers un autre serveur.

Avant une écriture, le Studio conserve une copie `models.json.prime-studio.bak` ou `settings.json.prime-studio.bak` dans le même dossier. Le configurateur et ses routes d’écriture sont réservés à `127.0.0.1`. Ils ne traversent pas la passerelle LAN. Les modèles déjà configurés restent disponibles dans le sélecteur du téléphone.

## Données et configuration

| Emplacement                                                | Contenu                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.prime/agent/sessions/`                                 | Conversations natives de Prime Agent                                                                                                                          |
| `~/.prime/agent/settings.json`, `models.json`, `auth.json` | Configuration du moteur ; le configurateur peut écrire `models.json` et les valeurs par défaut de `settings.json`, sans transmettre les secrets à l’interface |
| `.local/workspace.json`                                    | Projets, titres, épingles et archives du GUI                                                                                                                  |
| `.local/attachments/`                                      | Fichiers joints originaux et métadonnées de téléchargement ; à conserver pour pouvoir les relire depuis les sessions                                          |
| `~/.prime/agent/sessions/.studio-images/`                  | Images transmises au CLI, également enregistrées dans les messages natifs                                                                                     |
| IndexedDB du navigateur                                    | Pièces jointes des brouillons, séparées par session ou nouveau projet                                                                                         |
| Stockage local du navigateur                               | Brouillons, thème et préférences de saisie                                                                                                                    |
| `.local/logs/server.log`                                   | Journal du serveur lancé en arrière-plan                                                                                                                      |
| `.local/logs/launcher.log`                                 | Diagnostics du lanceur                                                                                                                                        |

| Variable d’environnement       | Rôle                                                |
| ------------------------------ | --------------------------------------------------- |
| `PORT`                         | Port HTTP, `3088` par défaut                        |
| `PRIME_AGENT_CLI`              | Chemin du `cli.js` ou du dossier npm de Prime Agent |
| `PRIME_AGENT_CODING_AGENT_DIR` | Dossier de configuration de Prime Agent             |
| `PRIME_AGENT_SESSION_DIR`      | Dossier des sessions à lire et à créer              |
| `PRIME_AGENT_GUI_DATA_DIR`     | Dossier des métadonnées GUI, `.local` par défaut    |
| `PRIME_AGENT_GUI_NODE`         | Exécutable Node utilisé par le lanceur VBS          |
| `PRIME_AGENT_KERNEL_PYTHON`    | Python contenant le moteur `prime-agent-runtime`    |

Le serveur de commande écoute uniquement sur `127.0.0.1`. L’accès mobile facultatif passe par une passerelle authentifiée qui autorise les commandes selon son mode. Les origines externes et les noms d’hôte inconnus sont refusés ; seuls les fichiers de l’interface et les routes autorisées sont servis. Ne l’exposez pas via un proxy public : c’est une application personnelle locale.
