# Langues et traductions

[English](en/translations.md) · **Français** · [← Retour au README](../README.fr.md)

Le Studio propose le français et l’anglais sur PC, mobile et dans la PWA. Le sélecteur **Préférences → Apparence → Langue** change l’interface immédiatement. Le choix est conservé par navigateur et par adresse d’accès ; les onglets de la même adresse se synchronisent. Les sessions et les saisies continuent sans rechargement.

## Une seule table

Toutes les langues sont côte à côte dans [`public/translations.js`](../public/translations.js), y compris les textes d’interface renvoyés par le serveur. Il n’y a pas de fichier indépendant à synchroniser pour chaque langue.

```js
export const fallbackLanguage = 'fr';
export const languages = [
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

export const messages = {
  'language.label': { fr: 'Langue', en: 'Language' },
  'common.editName': { fr: 'Modifier {value1}', en: 'Edit {value1}' },
  'count.tools': {
    fr: { one: '{count} appel d’outil', other: '{count} appels d’outil' },
    en: { one: '{count} tool call', other: '{count} tool calls' },
  },
};
```

Les identifiants sont stables : corriger une formulation ne demande pas de renommer sa clé. Les paramètres ont le même nom dans toutes les langues et peuvent être réordonnés. Pour les nouveaux textes, préférez des noms explicites comme `{name}` ou `{count}`. Une partie des messages migrés emploie `{value1}`, `{value2}`, etc.

Les pluriels suivent `Intl.PluralRules` de la langue affichée. Une entrée plurielle doit avoir une forme `other` ; les langues qui le nécessitent peuvent ajouter `zero`, `two`, `few` et `many`. Les dates et nombres utilisent également la langue choisie.

## Repli et vérification

Si une traduction est absente ou vide, le Studio utilise **le français de la même ligne**. Une langue non prise en charge revient également au français. Le repli fonctionne en ligne et hors connexion. Les clés inexistantes sont rendues comme identifiants pour être repérables pendant le développement, et sont refusées par les vérifications avant publication.

```powershell
npm run check:translations
node --test test/i18n.test.mjs
npm run test:i18n
```

La première commande, aussi exécutée par `npm run check`, contrôle les cellules manquantes, les paramètres, les formes plurielles et les références du code et du HTML. Le repli est une protection à l’exécution ; il ne dispense pas de compléter une langue avant publication.

## Ajouter une langue

1. Ajouter son code et son nom dans `languages`, dans ce même fichier.
2. Ajouter sa traduction dans chaque ligne de `messages`. Conserver tous les paramètres et la forme plurielle `other`.
3. Exécuter les vérifications, puis parcourir les écrans PC et mobile dans cette langue, notamment les boutons, formulaires et petits écrans.

Les sélecteurs se remplissent à partir de `languages` : aucun composant n’a besoin d’une nouvelle liste codée en dur. Le système actuel couvre les interfaces qui s’écrivent de gauche à droite ; une langue s’écrivant de droite à gauche demanderait aussi une adaptation de la mise en page.

## Utiliser une traduction

Pour du texte statique dans le HTML :

```html
<button data-i18n="ui.fermer">Fermer</button>
<input data-i18n-placeholder="ui.rechercher_une_session" placeholder="Rechercher une session" />
```

Les marqueurs existent aussi pour `title`, `aria-label`, `data-prompt` et `content`. Le texte français présent dans le HTML permet un affichage initial utilisable ; la table reste la référence.

Pour un texte dynamique :

```js
import { t, bindText, bindAttribute } from './i18n.js';

bindText(counter, () => t('count.tools', { count: tools.length }));
bindAttribute(button, 'aria-label', () => t('common.editName', { value1: project.name }));
```

Les fonctions de rendu évaluent leur texte à nouveau lors du changement de langue. `bindText` conserve le nœud de texte qu’il a créé : les champs ou icônes ajoutés ensuite au même élément ne sont pas supprimés. Les nœuds retirés du document sont référencés faiblement et les vues conservées en mémoire sont actualisées lors de leur réinsertion.

Utilisez une phrase complète avec paramètres, et non une concaténation de fragments grammaticaux. Les traductions sont insérées comme **texte**, jamais comme HTML exécutable. Le code observe uniquement les marqueurs explicites et les liaisons d’interface ; il ne parcourt pas les conversations à la recherche de mots à remplacer.

Le serveur utilise `formatMessage` avec le français de référence, afin de conserver le contrat des historiques et diagnostics. `translateKnown` est réservé aux messages d’interface du Studio reçus par API. N’appliquez pas cette fonction aux conversations, aux fichiers, aux noms de projets, ni aux instructions provenant de ressources externes.

Les commandes comme `/goal`, les identifiants des modèles, les chemins et les valeurs de protocole restent inchangés. La langue de l’interface ne modifie pas le prompt système ni la langue demandée à un agent. Les suggestions de départ proposées par l’accueil sont traduites avant leur insertion ; un brouillon déjà écrit conserve son texte.

## Maintenir la documentation bilingue

Le README anglais est dans `README.md`, sa version française dans `README.fr.md`. Les guides français conservent leurs adresses `docs/*.md` et les guides anglais sont dans `docs/en/*.md`. Chaque page contient un lien vers son équivalent. Les liens entre guides restent dans la langue choisie ; les commandes, noms de fichiers réels et références de code sont conservés.

[`docs/documentation.json`](documentation.json) est le registre unique des paires de pages et de leurs empreintes après relecture. `npm run check:docs`, également inclus dans `npm run check`, vérifie les pages manquantes ou non déclarées, la navigation entre langues, les liens locaux, les images, les ancres et la structure des titres. Si une page change depuis la dernière relecture des deux versions, la vérification signale la paire à revoir.

Après avoir modifié une page, mettez à jour ou relisez son équivalent, puis enregistrez explicitement les paires vérifiées par leur identifiant :

```powershell
npm run docs:sync -- readme configuration
npm run check:docs
```

Cette commande enregistre la relecture ; elle ne traduit aucun texte et ne peut pas certifier la qualité d’une traduction. Elle ne doit pas servir à ignorer une version devenue obsolète. Les empreintes détectent les modifications, y compris dans une seule langue, mais une relecture humaine reste nécessaire pour vérifier le sens.

Pour un nouveau guide, ajoutez les deux fichiers, leurs liens de langue et une entrée dans le registre, puis relisez les deux versions avant d’enregistrer la paire. Les changements de langue de l’application et ceux de la documentation sont indépendants : GitHub utilise les liens des pages, sans JavaScript ni traduction automatique.
