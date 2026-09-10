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
   * mesure a cinquante connexions simultanees sur un i7-1260P, a cinquante
   * mille tickets. Assez lache pour ne pas clignoter, assez serre pour qu'un
   * depassement signifie quelque chose — les seuils precedents, poses au juge
   * avant toute mesure, laissaient passer un facteur trois sans broncher.
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
 * Les paliers de simultaneite.
 *
 * Un centre de services n'a pas mille agents qui cliquent en meme temps : dix
 * connexions simultanees represente deja une equipe entiere en action. Monter
 * au-dela sert a voir ou la courbe se casse, pas a simuler un usage credible.
 */
export const SIMULTANEITE: readonly number[] = [1, 5, 20, 50];
