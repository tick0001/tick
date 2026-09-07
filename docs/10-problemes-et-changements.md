# Problèmes et changements

Le ticket n'était que le premier des trois objets ITIL. Les deux autres complètent le socle : le
**problème** cherche la cause, le **changement** planifie l'évolution. Ce document dit ce qu'ils
partagent avec le ticket, ce qui les en distingue, et pourquoi la promotion ne déplace rien.

## 1. Trois tables, pas une

`tickets`, `problems` et `changes` sont trois tables distinctes, aux colonnes largement identiques.
Une table unique discriminée par un type aurait évité cette répétition — et l'aurait payée cher :

- **Les index diffèrent.** Un ticket se cherche par échéance et par priorité, un changement par date
  de déploiement. Sur une table commune, chaque index traînerait un filtre de type.
- **Les droits diffèrent.** Un technicien lit les problèmes sans les écrire. Exprimer cela sur une
  table commune demanderait une politique conditionnelle au type, illisible et fragile.
- **Les colonnes propres diffèrent.** Un problème porte symptômes, causes et impacts ; un changement
  porte trois plans et une liste de contrôle. Sur une table unique, chaque ligne traînerait les
  colonnes de l'autre, nulles pour toujours.

La répétition est donc assumée, et elle est bornée : elle porte sur des colonnes, pas sur du code.

## 2. Ce qui est réellement partagé

Les **satellites** sont polymorphes sur `itil_type` depuis le premier jour : `itil_actors`,
`itil_followups`, `itil_tasks`, `itil_solutions`, `itil_validations`, `itil_costs`, `itil_links`,
`logs` et `documents`. C'est là que la mutualisation paie, parce que le comportement y est
réellement identique : un suivi sur un problème est un suivi.

Côté code, un seul descripteur porte la différence :

```ts
export const ITIL_KINDS: Record<ItilType, ItilDescriptor> = {
  ticket: { kind: 'ticket', table: 'tickets', right: 'ticket', extra: [] },
  problem: {
    kind: 'problem',
    table: 'problems',
    right: 'problem',
    extra: ['symptoms', 'causes', 'impacts'],
  },
  change: {
    kind: 'change',
    table: 'changes',
    right: 'change',
    extra: ['deploymentPlan', 'rollbackPlan', 'validationPlan', 'checklist'],
  },
};
```

`TimelineService` et `TicketScopeService` ne connaissent que ce descripteur. Ils prennent un
argument `porteur` **en dernier, avec `'ticket'` par défaut** : les appelants qui ne connaissent que
le ticket n'ont rien eu à changer, et l'ajout d'un quatrième objet ne demanderait qu'une entrée dans
la table ci-dessus.

Le nom de table est interpolé en SQL brut. C'est une constante du code, choisie par une clé du type
`ItilType` que Zod a déjà validée — jamais une saisie.

### Ce qui n'est pas partagé, et pourquoi

Le ticket garde son propre service. Il porte des gabarits, des engagements de service, trois
collections de règles et une pagination par curseur, dont ni le problème ni le changement n'ont
l'usage. Les fondre aurait donné un service dont les deux tiers ne servent qu'à un seul type.

## 3. Périmètre et droits

Rien de nouveau : les deux objets suivent exactement le modèle des tickets.

- **Row-Level Security** descendant sur `entity_path`, via `tick_in_scope`.
- **Portée du droit** (`own`, `group`, `entity`, `recursive`, `all`) traduite en condition SQL, qui
  s'ajoute au RLS sans jamais l'élargir.
- Les satellites passent par `tick_itil_visible(itil_type, itil_id)`, étendue en J7 aux deux
  nouvelles tables :

```sql
CREATE OR REPLACE FUNCTION tick_itil_visible(objet itil_type, identifiant bigint)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE objet
    WHEN 'ticket'  THEN EXISTS (SELECT 1 FROM public.tickets  t WHERE t.id = identifiant AND tick_in_scope(t.entity_path))
    WHEN 'problem' THEN EXISTS (SELECT 1 FROM public.problems p WHERE p.id = identifiant AND tick_in_scope(p.entity_path))
    WHEN 'change'  THEN EXISTS (SELECT 1 FROM public.changes  c WHERE c.id = identifiant AND tick_in_scope(c.entity_path))
  END
$fn$;
```

Les objets de droit sont `problem` et `change`. Dans le jeu de démonstration, le technicien les lit
sans les écrire : il consulte le problème auquel son incident est rattaché, il ne décide pas de son
analyse.

## 4. Liens

`itil_links` relie deux objets quelconques parmi les trois. `linked` est symétrique ; `duplicate` et
`child` ne le sont pas — la source d'un `child` est l'enfant.

La **lecture est toujours symétrique** : depuis l'un ou l'autre bout, le lien apparaît, et l'API
retourne le sens pour présenter systématiquement « l'autre objet ». Ne l'afficher que d'un côté
ferait croire à deux relations là où il n'y en a qu'une.

Chaque bout est relu à travers sa propre portée. Un lien vers un ticket hors périmètre existe en
base, mais ne se lit pas : il disparaît de la liste plutôt que d'exposer un titre.

Créer un lien demande le droit d'**écriture sur la source** et seulement la **lecture sur la cible**
— lier un ticket à un problème ne modifie pas le ticket, seulement la relation.

## 5. Promotion

Promouvoir un ticket vers un problème, ou un problème vers un changement, crée un **nouvel objet** et
laisse l'original ouvert, rattaché par un lien `linked`.

Déplacer aurait été plus simple à écrire et faux à l'usage : celui qui a signalé l'incident attend
toujours une réponse sur son incident, indépendamment de l'analyse de fond qui commence. Un incident
qui disparaît de la liste du demandeur parce qu'un technicien y a vu un problème est un incident
perdu.

Ce que l'objet promu reprend :

| Reporté                           | Non reporté                                      |
| --------------------------------- | ------------------------------------------------ |
| Titre (modifiable à la promotion) | Statut — le nouvel objet démarre à `new`         |
| Description                       | Suivis, tâches, solutions de l'original          |
| Urgence, impact, catégorie        | Priorité — recalculée par la matrice de l'entité |
| Demandeurs et observateurs        | **Affectés** — voir ci-dessous                   |
| Entité de l'objet d'origine       |                                                  |

Les **affectés ne suivent pas** : qui traitera le problème est une décision de l'encadrement, pas
une conséquence mécanique du fait qu'on a traité l'incident.

L'objet promu naît dans l'**entité de sa cause**, pas dans l'entité active du moment. Promouvoir
depuis la racine un incident d'une filiale ne doit pas remonter l'analyse d'un cran. Le Row-Level
Security refuse l'écriture si cette entité est hors du périmètre, ce qui est le garde-fou correct.

Enfin, l'auteur de la promotion ne devient pas demandeur du nouvel objet. Il l'ouvre ; ce n'est pas
la même chose. Il ne le devient que si la source n'avait aucun demandeur transférable — un objet
sans demandeur n'a personne à qui rendre compte.

## 6. Événements

Le SDK passe en `0.6` : `problem.created` / `updated` / `deleted`, les mêmes pour `change`, plus
`itil.linked`, `itil.unlinked` et `itil.promoted`.

Ces événements sont **volontairement absents du catalogue des notifications**. Les modèles résolvent
leurs destinataires dans `tickets` ; publier `followup.added` pour un suivi de problème y désignerait
le ticket portant le même numéro, et la notification partirait aux mauvaises personnes. Pour la même
raison, la chronologie ne publie ses événements que lorsque le porteur est un ticket.

Les plugins, eux, savent de quel objet on leur parle : la charge utile porte le type.

## 7. Interface

Une seule page de liste et une seule page de fiche servent les deux objets, paramétrées par le type.
La chronologie, les pièces jointes et le panneau de liens sont **les composants du ticket**, réutilisés
tels quels — leur donner ici une autre apparence ferait croire à un autre mécanisme.

Le panneau de liens porte aussi les boutons de promotion, et il figure sur les trois objets : un lien
n'appartient à aucun de ses deux bouts.
