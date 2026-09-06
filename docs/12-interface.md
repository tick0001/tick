# Interface

Ce document décrit les décisions d'apparence : les jetons de couleur, la coquille
de navigation et les briques communes. Il existe parce que ces choix se prennent
une fois et se subissent longtemps — et parce que la version précédente les avait
pris quinze fois, une par écran.

## 1. Le problème que la refonte corrige

Avant : chaque page écrivait ses couleurs à la main, en doublon clair et sombre.

```
className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm
           dark:border-neutral-700 dark:bg-neutral-950"
```

Cette chaîne apparaissait une centaine de fois. Trois conséquences, toutes
vérifiées dans le code :

- **La variante sombre s'oubliait.** Plusieurs éléments n'en avaient pas, et
  devenaient illisibles dès la bascule — dont le badge du plugin de référence.
- **Les écrans divergeaient.** Un même bouton avait `px-2 py-1` sur une page et
  `px-2.5 py-1` sur une autre, parce que la constante était locale.
- **Rien n'était modifiable.** Changer le gris des bordures demandait une
  recherche-remplacement sur cent occurrences, en espérant n'en manquer aucune.

## 2. Jetons sémantiques

Les couleurs sont des propriétés personnalisées, exposées à Tailwind par
`@theme inline`. L'utilitaire pointe alors **directement** sur la propriété :
`.bg-surface` devient `background-color: var(--tick-surface)`. Le thème sombre
n'a plus qu'à redéfinir ces propriétés.

Aucune page n'écrit plus `dark:`. C'est la propriété la plus importante du
dispositif : une couleur ne peut plus diverger entre deux écrans parce qu'on a
oublié sa variante — la variante n'existe plus.

Les noms disent le **rôle**, pas la teinte :

| Famille | Jetons                                          | Usage                                    |
| ------- | ----------------------------------------------- | ---------------------------------------- |
| Fonds   | `canvas`, `surface`, `sunken`, `raised`         | du plus reculé au plus avancé            |
| Traits  | `line`, `line-strong`                           | bordure ordinaire, bordure appuyée       |
| Textes  | `ink`, `muted`, `faint`                         | du plus lisible au plus discret          |
| Marque  | `brand`, `brand-hover`, `brand-soft`, `brand-ink`, `on-brand` | actions et éléments actifs |
| Sens    | `positive`, `caution`, `critical`, `info` (+ `-soft`, `-ink`) | états et alertes           |

`surface` reste `surface` le jour où le fond passe du blanc au gris ; `bg-white`
aurait menti dès la première retouche.

### Palettes

Les neutres sont **froids** plutôt que gris purs : associés à l'indigo de la
marque, un gris neutre donne un rendu délavé dès qu'une couleur saturée apparaît
à côté.

Le fond sombre n'est pas noir. Un noir pur fait vibrer le texte clair et fatigue
plus vite que l'ardoise très foncée retenue. Les teintes de sens y sont remontées
en luminosité, sans quoi elles disparaîtraient.

### Trois états de thème, pas deux

`clair`, `sombre`, `système`. Le troisième **retire** l'attribut `data-theme` au
lieu d'en poser un autre : la feuille de style bascule alors sur
`prefers-color-scheme`, et l'interface suit le réglage du poste sans qu'on ait à
l'observer nous-mêmes.

Le choix est mémorisé sur le poste, pas sur le compte : c'est une préférence liée
à l'écran devant lequel on se trouve, et la même personne peut vouloir le sombre
sur son portable et le clair sur le poste de l'atelier.

## 3. Navigation groupée

Quatorze liens en une barre horizontale donnaient le même poids visuel à
« Tickets » et à « Courriel entrant ». L'œil devait relire toute la liste à
chaque fois.

La barre latérale les range en trois groupes, par intention :

- **Travail** — ce qu'on ouvre chaque matin : tickets, problèmes, changements,
  planning.
- **Services** — ce qu'on consulte : catalogue, base de connaissances.
- **Analyse** — recherche, statistiques.

Huit entrées : la barre tient dans la hauteur de l'écran, ce qui était le point.

### La configuration a sa propre zone

Une première version gardait deux groupes de plus — Configuration et
Administration — soit dix-huit entrées et un défilement permanent. Deux
conséquences : on ne voyait jamais la barre entière, et « Courriel entrant »
occupait la même place que « Tickets » alors qu'on l'ouvre une fois par
trimestre.

Les douze écrans de réglage vivent donc sous `/settings`, atteints par une
entrée unique posée **en pied de barre** — là où l'on met ce qu'on ouvre
rarement, et jamais par erreur.

**La configuration remplace la barre au lieu de s'y ajouter.** Une première
tentative lui donnait sa propre colonne, posée à côté de la barre principale :
deux barres latérales côte à côte, et huit entrées de travail quotidien
maintenues à l'écran alors qu'on n'en a que faire quand on configure.

C'est un changement de contexte, pas une descente dans l'arborescence. On y
entre, la barre devient celle des réglages — groupée à son tour en Assistance,
Communication, Organisation et Système — avec un retour explicite en tête, là où
l'identité du produit s'affiche le reste du temps. On en sort par ce retour, et
le travail quotidien revient. Une seule barre à tout moment, et le contenu
occupe toute la largeur restante.

La navigation des réglages est une liste et non des onglets : douze onglets ne
tiennent pas sur une ligne, et les replier dans un menu déroulant coûterait un
clic à chaque va-et-vient entre deux écrans de réglage — ce qu'on fait
précisément quand on configure.

Les anciennes adresses (`/rules`, `/admin/users`…) redirigent : un signet ne doit
pas tomber sur une page d'accueil sans explication.

L'interface simplifiée n'a qu'un groupe, avec trois entrées, et pas d'accès à la
configuration. Elle est portée par le **profil actif**, pas par l'utilisateur :
la même personne peut être technicienne sur une branche et simple demandeuse sur
une autre.

Sur petit écran, la barre devient un tiroir qui se referme à chaque navigation —
le laisser ouvert masquerait la page qu'on vient de demander.

Les plugins disposent d'un emplacement `app.sidebar` : une extension qui apporte
un écran a besoin d'y conduire, et l'en-tête n'a pas la place d'accueillir une
entrée de navigation de plus.

## 4. Briques communes

`components/ui/primitives.tsx` : `Button`, `Input`, `Select`, `Textarea`,
`Checkbox`, `Field`, `Card`, `PageHeader`, `Badge`, `Tabs`, `EmptyState`,
`Notice`, `TableWrap`.

Les classes sont **aussi** exportées comme chaînes (`CONTROLE`, `BOUTON`,
`BOUTON_PRIMAIRE`). Quelques formulaires composent leurs contrôles dans des
boucles denses ; leur imposer un composant aurait ajouté une enveloppe sans rien
gagner. Ils partagent au moins les mêmes classes.

### Ce que les composants décident

- **L'action principale d'un écran est pleine et colorée**, les autres sont en
  retrait. Sur un écran de configuration, « Nouvelle règle » est la seule action
  qu'on vient y chercher.
- **Le statut d'un ticket porte une pastille**, pas un aplat plein : sur une
  liste de quarante lignes, quarante aplats colorés se neutralisent.
- **Le type — incident ou demande — est un texte teinté**, pas une étiquette.
  La distinction est utile mais secondaire, et une seconde pastille entrerait en
  concurrence avec le statut, qui lui doit sauter aux yeux.
- **La priorité est une jauge segmentée.** Les segments éteints restent visibles :
  sans eux, on ne saurait pas sur quelle échelle se lit le remplissage.
- **La chronologie pend à un filet vertical.** L'ordre se lit alors sans compter
  les cartes.

### Anneau de focus

Déclaré une fois, sur le document, en `:focus-visible`. Le poser là plutôt que
sur chaque composant garantit qu'aucun contrôle n'échappe au clavier : un champ
ajouté demain le recevra sans que personne n'y pense.

## 5. Icônes

Écrites dans le dépôt plutôt qu'importées. Une bibliothèque d'icônes embarque
plusieurs milliers de tracés pour la vingtaine dont cette interface a besoin, et
impose son propre rythme de mise à jour.

Le style est uniforme — trait de 1,5, extrémités arrondies, grille de 24 — parce
que c'est ce qui fait qu'un jeu d'icônes tient ensemble, bien plus que le nombre
de tracés.

## 6. Ce que les plugins doivent savoir

Les jetons sont à leur disposition : un plugin qui écrit `bg-positive-soft`
suivra le thème, un plugin qui écrit `bg-emerald-100` deviendra illisible en
sombre. Le plugin de référence a été corrigé en ce sens, et sert d'exemple.

Le dossier `plugins/` est déclaré comme source Tailwind (`@source`) : sans cela,
les classes d'un plugin ne seraient jamais générées, et son badge sortirait sans
aucun style — une panne que son auteur mettrait longtemps à relier à sa cause.
