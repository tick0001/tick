/**
 * Ce que l'on mesure, et pourquoi ces requetes-la.
 *
 * Un banc d'essai qui frappe la page d'accueil ne dit rien : il mesure nginx.
 * Les scenarios retenus sont ceux qu'un centre de services execute des
 * milliers de fois par jour, et ceux dont on soupconne qu'ils plieront.
 *
 * **Deux soupcons formes en lisant le schema, et tranches par la mesure :**
 *
 *   - La recherche par titre compile un `contains` en `ILIKE '%...%'` sans
 *     index GIN sur les tickets. Le balayage a bien lieu — mais il coute
 *     moins que prevu : a cinquante mille lignes, comparable au temoin
 *     indexe. **Soupcon infirme**, aucun index ajoute.
 *   - La liste compte suivis et taches par sous-requetes correlees, une paire
 *     par ligne. **Soupcon infirme** : 0,007 ms par ligne, elles sont
 *     correctement indexees.
 *
 * Ce que la mesure a trouve, elle, n'avait ete soupconne par personne : la
 * liste joignait `entities` pour en lire le nom, ce qui interdisait au
 * planificateur d'utiliser l'index de tri. Voir le README.
 *
 * Un scenario qui infirme un soupcon vaut autant qu'un qui le confirme : c'est
 * pour cela que la liste et le detail sont mesures aussi, comme temoins.
 */

export interface Scenario {
  /** Nom court, celui qui apparait dans le tableau. */
  readonly nom: string;
  /** Ce que ce scenario represente, pour que la mesure se lise. */
  readonly intention: string;
  readonly methode: 'GET' | 'POST';
  readonly chemin: string;
  readonly corps?: unknown;
  /**
   * Seuil de latence au 95e centile, en millisecondes.
   *
   * Ces valeurs ne sont pas des promesses de performance : ce sont des
   * garde-fous de non-regression. Chacune vaut environ **deux fois** le p95
   * mesure a cinquante connexions simultanees sur un i7-1260P.
   *
   * **Ils sont calibres sur le palier `collectivite`** — cinquante mille
   * tickets. Au palier `grand-compte`, dix fois plus gros, `recherche-titre`
   * les depasse : ce n'est pas un seuil trop serre, c'est le constat que la
   * recherche textuelle ne passe pas cette echelle. Voir le README.
   */
  readonly seuilP95: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    nom: 'liste',
    intention: 'La liste des tickets, premiere page — l ecran le plus ouvert de tous',
    methode: 'GET',
    chemin: '/api/tickets',
    seuilP95: 500,
  },
  {
    nom: 'liste-filtree',
    intention: 'La meme, restreinte aux tickets ouverts',
    methode: 'GET',
    chemin: '/api/tickets?status=new',
    seuilP95: 500,
  },
  {
    nom: 'detail',
    intention: 'Un ticket et sa chronologie',
    methode: 'GET',
    chemin: '/api/tickets/1/timeline',
    seuilP95: 450,
  },
  {
    nom: 'recherche-titre',
    intention: 'Recherche « contient » sur le titre — le balayage sequentiel soupconne',
    methode: 'POST',
    chemin: '/api/search/tickets',
    corps: {
      criteria: {
        kind: 'criterion',
        field: 'ticket.name',
        operator: 'contains',
        value: 'imprimante',
      },
    },
    seuilP95: 1600,
  },
  {
    nom: 'recherche-statut',
    intention: 'Recherche sur un champ indexe — le temoin de la precedente',
    methode: 'POST',
    chemin: '/api/search/tickets',
    corps: {
      criteria: { kind: 'criterion', field: 'ticket.status', operator: 'eq', value: 'new' },
    },
    seuilP95: 1200,
  },
  {
    nom: 'statistiques',
    intention: 'Les indicateurs de la periode — agregats sur tout le perimetre',
    methode: 'GET',
    chemin: '/api/stats',
    seuilP95: 2000,
  },
];

/**
 * Les paliers de simultaneite, et ce qu'un palier represente vraiment.
 *
 * **Une connexion n'est pas un utilisateur.** `autocannon` maintient N requetes
 * en vol en permanence : des qu'une reponse arrive, la suivante part. Aucun
 * temps de reflexion, aucune lecture d'ecran, aucune frappe au clavier. Un
 * agent reel, lui, ouvre une liste, la lit, clique, ecrit — une quinzaine de
 * requetes par minute quand il travaille sans lever les yeux.
 *
 * La conversion se fait par la loi de Little. A 250 requetes par seconde
 * soutenues, soit 15 000 par minute, cinquante connexions saturees
 * representent donc de l'ordre de **mille agents en pleine activite**.
 *
 * Ce rapport de mille a cinquante n'est pas une licence a mesurer petit : il
 * dit seulement qu'un palier eleve modelise une **rafale** — un incident
 * majeur ou tout le monde ouvre un ticket en meme temps, sans temps de
 * reflexion — plutot qu'un effectif.
 *
 * D'ou deux familles de paliers, aux roles distincts.
 */

/**
 * Les paliers de service : ceux ou l'application doit **tenir ses seuils**.
 *
 * Un depassement ici est une regression, et le banc echoue.
 */
export const SIMULTANEITE: readonly number[] = [1, 5, 20, 50];

/**
 * Les paliers de rupture : ceux ou l'on cherche **ou la courbe se casse**.
 *
 * Aucun seuil de latence ne s'y applique — a cinq cents connexions saturees,
 * une latence elevee est le comportement attendu d'un systeme sature, pas un
 * defaut. Ce qu'on lit ici est ailleurs :
 *
 *   - **Le debit s'effondre-t-il, ou plafonne-t-il ?** Un plateau est sain :
 *     le systeme fait file d'attente. Une chute est un ecroulement.
 *   - **Des requetes echouent-elles ?** Une grande organisation a le droit
 *     d'attendre ; elle n'a pas a recevoir des erreurs.
 *
 * Les echecs y sont signales sans faire echouer le banc : a ces niveaux, le
 * poste de mesure epuise ses propres ports avant l'application, et une panne
 * du mesureur n'est pas une panne du mesure.
 */
export const SIMULTANEITE_RUPTURE: readonly number[] = [100, 200, 500];
