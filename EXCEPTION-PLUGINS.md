# Exception de liaison pour les plugins

Tick& est distribué sous **AGPL-3.0-or-later** ; le texte de la licence, dans [LICENSE](LICENSE),
n'est pas modifié. Ce fichier y ajoute une **permission additionnelle** au sens de l'article 7 de
la GNU General Public License version 3, que l'AGPL incorpore.

_Le texte français est la référence. An English translation follows, for convenience only._

## La permission

En complément des termes de l'AGPL, et à titre de permission additionnelle au sens de son
article 7, vous êtes autorisé à distribuer un **plugin de Tick&** sous les termes de votre choix,
y compris une licence privatrice et sans en publier le code source, et à le rendre accessible à
distance au sens de l'article 13 de l'AGPL, pourvu que les trois conditions suivantes soient
remplies.

1. **Le plugin n'utilise Tick& qu'au travers de son interface d'extension publiée** : le paquet
   `@tick/plugin-sdk`, le manifeste de plugin, et les points d'extension que décrit
   [le SDK](docs/15-sdk-plugins.md). Il ne modifie, ne remplace ni ne contourne aucune autre
   partie de Tick&.
2. **Le plugin n'incorpore aucune portion du code source de Tick&**, hormis `@tick/plugin-sdk`,
   qu'il peut inclure en tout ou partie, sous forme source ou compilée.
3. **Le plugin reste un ouvrage distinct** au sens de l'article 5 de la GPL. Le livrer dans la
   même archive ou la même image que Tick& ne le fait pas entrer dans le même programme.

## Ce que l'exception ne couvre pas

- **Tick& elle-même reste sous AGPL, sans exception.** Modifier le cœur, le SDK, l'interface web,
  le schéma de la base ou les migrations vous place sous les obligations ordinaires de la
  licence, clause réseau comprise.
- **Un plugin qui sort de l'interface publiée perd le bénéfice de l'exception.** Appeler un module
  interne de l'API, lire les tables d'un autre plugin ou celles du cœur autrement que par
  `context.db`, ou recopier du code du cœur : c'est retomber sous l'AGPL pleine.
- L'exception ne dit rien des **bibliothèques tierces** qu'un plugin embarque. Leurs licences
  s'appliquent comme d'ordinaire.
- Elle ne dit rien non plus de ce qu'un plugin **peut techniquement faire**. Installer un plugin,
  c'est lui accorder les droits du processus de l'API ; la licence encadre la distribution, pas
  l'exécution. Voir [la section « garde-fous »](docs/04-plugins.md).

## Ce que vous pouvez en faire

L'article 7 de la GPL vous autorise expressément à **retirer cette permission** de votre copie, ou
d'une copie que vous transmettez. Elle s'applique alors comme si elle n'avait jamais été accordée.

La permission est attachée aux versions de Tick& qui la publient. Elle ne peut pas leur être
retirée après coup : une version parue avec ce fichier reste utilisable à ces conditions, pour
toujours. Une version future pourrait ne plus l'accorder — elle ne rendrait pas illicite ce qui
aura été fait sous celles qui l'accordaient.

## Pourquoi

Un système d'extension ne vaut que par les gens qui écrivent des extensions. Exiger l'AGPL sur
chaque plugin revenait à garder la complexité du mécanisme — manifeste, SDK versionné, schéma
dédié, écran d'administration — en écartant l'intégrateur qui vend un connecteur et le support qui
va avec. Les deux décisions se tenaient séparément ; ensemble elles s'annulaient.

Le cœur, lui, ne bouge pas : c'est là que la clause réseau compte, et c'est elle qui garantit
qu'un hébergeur ne peut pas exploiter une version améliorée de Tick& sans en rendre les
améliorations.

## Identifiant SPDX

Les paquets continuent de déclarer `AGPL-3.0-or-later` : aucun identifiant d'exception enregistré
ne correspond à celle-ci, et en inventer un rendrait les métadonnées illisibles aux outils. La
permission se lit ici.

---

# Plugin linking exception

_Translation of the French text above, which prevails in case of divergence._

Tick& is distributed under **AGPL-3.0-or-later**; the licence text in [LICENSE](LICENSE) is
unmodified. This file adds an **additional permission** under section 7 of the GNU General Public
License version 3, as incorporated by the AGPL.

## The permission

In addition to the terms of the AGPL, and as an additional permission under its section 7, you are
permitted to distribute a **Tick& plugin** under terms of your choosing — including a proprietary
licence, without publishing its source — and to make it available remotely within the meaning of
AGPL section 13, provided all three of the following hold.

1. **The plugin uses Tick& only through its published extension interface**: the
   `@tick/plugin-sdk` package, the plugin manifest, and the extension points described in
   [the SDK documentation](docs/15-sdk-plugins.md). It does not modify, replace or circumvent any
   other part of Tick&.
2. **The plugin incorporates no portion of Tick&'s source**, other than `@tick/plugin-sdk`, which
   it may include in whole or in part, in source or compiled form.
3. **The plugin remains a separate work** within the meaning of GPL section 5. Shipping it in the
   same archive or image as Tick& does not make it part of the same program.

## What the exception does not cover

- **Tick& itself remains under the AGPL, with no exception.** Modifying the core, the SDK, the web
  interface, the database schema or the migrations puts you under the licence's ordinary
  obligations, network clause included.
- **A plugin that steps outside the published interface loses the exception**: calling an internal
  API module, reading another plugin's tables or the core's other than through `context.db`, or
  copying core code, falls back under the full AGPL.
- The exception says nothing about **third-party libraries** a plugin bundles; their licences
  apply as usual.
- Nor does it say anything about what a plugin **can technically do**. Installing a plugin grants
  it the rights of the API process; the licence governs distribution, not execution.

## What you may do with it

GPL section 7 expressly allows you to **remove this permission** from your copy, or from a copy you
convey. It then applies as if it had never been granted.

The permission attaches to the versions of Tick& that publish it, and cannot be withdrawn from them
afterwards: a release carrying this file stays usable on these terms, permanently. A future release
could stop granting it; that would not make unlawful anything done under the releases that did.
