# Accès depuis un téléphone

[← Retour au README](../README.md)

## Utiliser le studio depuis un téléphone

L’accès mobile est facultatif, protégé par un code à huit chiffres. Il donne accès aux commandes du studio sur le même réseau Wi-Fi : ouvrir un projet et ses sessions, envoyer des messages, créer ou reprendre une conversation, choisir un modèle, arrêter une exécution et organiser les projets et sessions. Les agents travaillent sur le PC et continuent si vous fermez le navigateur du téléphone.

```powershell
npm run lan:enable
npm run stop
npm run start:silent
```

La première commande affiche l’adresse locale et le code. Le code est demandé dans le navigateur du téléphone ; il est mémorisé par un cookie pendant huit heures. Relancer `lan:enable` renouvelle le code. La configuration est conservée dans `.local/lan-access.json` ; mettre `enabled` à `false`, puis redémarrer, désactive cet accès. Le PC doit rester allumé et connecté au même réseau. Si son adresse IP change, relancer `lan:enable` avant le redémarrage.

Le port mobile est `3089`, lié uniquement à l’adresse privée de la carte réseau. Le port `3088` reste réservé au PC. Aucun routeur ni tunnel Internet n’est configuré. La connexion utilise HTTP sur votre réseau local.

Dans le menu, choisissez un projet pour afficher ses sessions dans la page, puis touchez une session pour l’ouvrir. **Nouvelle session** prépare une conversation dans ce projet. Les sessions archivées restent accessibles avec le filtre **Archivées**.

La configuration `readOnly: false` active les commandes à distance. Pour limiter volontairement cet accès à la consultation, passez `readOnly` à `true`, puis redémarrez. Une ancienne configuration sans ce champ reste en lecture seule jusqu’à sa mise à jour explicite. Le changement de mode conserve le code existant ; un redémarrage demande de se reconnecter.

## Redémarrer au bon moment

La configuration réseau est chargée au démarrage. Attendez la fin des exécutions avant de redémarrer le Studio : `npm run stop` interrompt les sessions encore actives. Fermer un simple onglet, en revanche, laisse les agents travailler.
