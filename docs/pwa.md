# Installer Prime Agent Studio

[English](en/pwa.md) · **Français** · [← Retour au README](../README.fr.md)

La PWA ouvre le Studio avec une icône et une fenêtre dédiée. Elle utilise le même moteur sur le PC, les mêmes sessions et le même code d’accès que le site distant.

## Préparer l’adresse HTTPS

Connectez le PC et le téléphone au même réseau Tailscale. Sur le PC, ouvrez **Préférences → Accès distant** et activez **Tailscale HTTPS**.

Le panneau configure **Tailscale Serve en mode privé**, conserve le code existant et affiche l’adresse HTTPS et son QR. Si aucun accès distant n’existe, il crée un code affiché une seule fois, sans activer le LAN ou l’accès HTTP Tailscale. L’activation s’applique immédiatement, sans redémarrage ni interruption des agents.

Si MagicDNS ou HTTPS doit être autorisé dans votre compte, utilisez **Ouvrir Tailscale**, suivez les instructions de Tailscale, puis revenez cliquer sur **Réessayer**. Un autre service sur le port HTTPS 443 ou une configuration Funnel publique est conservé ; le panneau signale le conflit.

Ouvrez l’adresse `https://nom-du-pc.nom-du-reseau.ts.net` affichée ou scannez son QR avec Tailscale connecté sur le téléphone. L’adresse HTTP sur une IP LAN ou Tailscale permet toujours d’utiliser le site, mais HTTPS est nécessaire pour l’installation complète sur le téléphone.

### Alternative en ligne de commande

Depuis le dossier du projet sur le PC :

```powershell
npm run pwa:enable
```

La commande conserve le code existant ou en crée un. Si Tailscale demande une autorisation du compte, suivez son lien, puis relancez la commande. Elle refuse aussi de remplacer un autre service.

Contrairement au panneau, cette commande nécessite un redémarrage. **Après la fin des exécutions**, appliquez la configuration :

```powershell
npm stop
npm run start:silent
```

## Installer sur chaque appareil

| Appareil      | Installation                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Android       | Ouvrez l’adresse HTTPS dans Chrome, puis **Installer le Studio**, sur la page d’accès ou dans le menu latéral. Le menu du navigateur propose aussi **Installer l’application** ou **Ajouter à l’écran d’accueil**. |
| iPhone / iPad | Ouvrez l’adresse dans Safari, utilisez **Partager → Sur l’écran d’accueil**, puis activez **Ouvrir comme app web** si proposé.                                                                                     |
| PC            | Ouvrez le Studio dans Chrome ou Edge, puis **Installer le Studio** ou la commande d’installation du navigateur. L’adresse locale `http://127.0.0.1:3088` fonctionne aussi sur le PC.                               |

Une fois installée, ouvrez l’icône Prime Agent. Le code peut être demandé à nouveau dans cette fenêtre. L’installation doit se faire depuis une fenêtre normale du navigateur ; le mode privé ne permet pas l’installation.

Le bouton **Installer le Studio** ouvre le dialogue natif lorsqu’il est disponible. Sinon, il affiche les instructions adaptées à l’appareil. Il disparaît quand le Studio est ouvert comme application autonome.

## Connexion, brouillons et mises à jour

Le PC doit rester allumé et le serveur actif pour envoyer des messages ou suivre les agents. À distance, Tailscale doit être connecté sur les deux appareils. Fermer la PWA laisse les exécutions travailler sur le PC.

L’écran de reconnexion est disponible après une première ouverture réussie. Si le réseau ou le PC devient inaccessible, il invite à vérifier la connexion puis à **Réessayer**. Les conversations, résultats d’outils et fichiers envoyés ne sont pas mis en cache par la PWA. Les brouillons déjà enregistrés restent dans le stockage de cet appareil, comme sur le site.

Les adresses HTTP, HTTPS et les différents navigateurs disposent de stockages séparés : les brouillons locaux ne sont pas transférés automatiquement entre eux. Les sessions enregistrées sur le PC restent communes.

L’interface est relue depuis le serveur à l’ouverture ; aucun rechargement automatique n’est imposé pendant une session. Après une mise à jour du code serveur, redémarrez à la fin des exécutions puis rechargez l’application.

## Passerelle et configuration

Tailscale Serve termine HTTPS et transmet au port **3090 sur `127.0.0.1`**. Cette passerelle conserve le contrôle du code d’accès et des permissions. Elle n’expose pas les routes de configuration réservées au PC. Le moteur reste sur `127.0.0.1:3088`. Aucune ouverture publique par Funnel n’est configurée.

La configuration se trouve dans `.local/lan-access.json`, sous `tailscale.https` : `enabled`, `origin` et `port`. Les accès HTTP LAN et Tailscale existants restent indépendants. **Options de connexion** permet de changer le port local de la passerelle, par défaut 3090, sans changer l’adresse HTTPS publique dans votre réseau Tailscale.

L’interrupteur **Tailscale HTTPS** ferme immédiatement la passerelle locale lorsqu’il est désactivé, sans interrompre les agents. La redirection privée Serve reste configurée pour la réactivation ; elle ne donne plus accès au Studio tant que la passerelle est fermée. Si Serve ne dessert que le Studio sur 443, `tailscale serve --https=443 off` supprime également cette écoute HTTPS.

En cas de problème, consultez `.local/logs/server.log` et `tailscale serve status`. La commande `pwa:enable` est réutilisable ; elle refuse de remplacer un autre service ou une configuration Funnel publique sur la même adresse.

## Notifications mobiles (PWA fermée)

**Préférences → Notifications → Notifications mobiles** permet d’activer les alertes **Questions** et **Fins de tour** sur cet appareil. L’inscription est par appareil et désactivée par défaut.

Fonctionnement : la PWA s’inscrit via Web Push VAPID, le serveur envoie une notification générique chiffrée (sans projet, sans prompt, sans contenu de question), le service worker l’affiche toujours et un clic rouvre la session concernée. Si la PWA est au premier plan, l’envoi est évité au mieux via un bail de présence court ; une notification déjà reçue reste affichée (contrainte navigateur `userVisibleOnly`).

Prérequis : PWA installée depuis l’adresse HTTPS Tailscale, notifications autorisées, PC allumé avec serveur actif, Tailscale connecté des deux côtés. Sur iPhone/iPad : iOS 16.4+, Safari, Partager → Sur l’écran d’accueil, puis ouvrir depuis l’icône et autoriser. Les appareils en lecture seule peuvent s’inscrire sans obtenir le droit de répondre.

Vie privée et sécurité : texte générique uniquement, relais du fournisseur du navigateur (Google/Apple/Mozilla) obligatoire, seuls les hôtes push reconnus sont acceptés (pas de redirection ni d’hôte local/privé/personnalisé), nombre d’inscriptions borné, jeton de propriété par appareil, aucune énumération ni journal d’adresse/clé. L’inscription persiste après déconnexion jusqu’à désactivation explicite ; les inscriptions expirées (404/410) sont purgées.

Si l’appareil a perdu son jeton (stockage effacé) : le serveur refuse la réinscription sans preuve, sans jamais transférer l’ancienne inscription. Pour récupérer, désactivez puis réactivez les alertes : cela révoque l’enregistrement navigateur (l’ancien point de terminaison meurt avec lui) puis crée une inscription neuve. Ne contournez jamais cette preuve côté serveur.

[Prérequis d’installation PWA — MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) · [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)

## Connexion optionnelle avec une clé d’accès

Sur l’adresse HTTPS Tailscale du téléphone, connectez-vous avec votre code Studio, puis ouvrez **Préférences → Accès distant → Créer une clé d’accès**. Nommez la clé, confirmez le code actuel à huit chiffres et validez sur votre appareil. Selon le téléphone, la validation utilise Face ID, une empreinte ou son code de déverrouillage. Votre gestionnaire de mots de passe peut synchroniser la clé.

À la prochaine connexion, choisissez **Se connecter avec une clé d’accès**. Le code Studio reste disponible en secours. Depuis le PC, cette même section permet de révoquer les clés et de déconnecter leurs sessions. Changer le code Studio invalide les clés existantes : il faut les enregistrer à nouveau. Les clés sont liées à l’adresse HTTPS exacte et ne sont pas disponibles sur le réseau local en HTTP.
