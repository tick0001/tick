/**
 * Ce que l'on mesure, et pourquoi ces requetes-la.
 *
 * Un banc d'essai qui frappe la page d'accueil ne dit rien : il mesure nginx.
 * Les scenarios retenus sont ceux qu'un centre de services execute des
 * milliers de fois par jour, et ceux dont on soupconne qu'ils plieront.
 *
 * Deux soupcons, formes en lisant le schema avant de mesurer :
 *
 *   - La recherche par titre compile un `contains` en `ILIKE '%…%'`. L'extension
 *     `pg_trgm` est activee depuis la premiere migration, mais **aucun index
 *     GIN n'existe sur les tickets** — le seul porte sur la base de
 *     connaissances. On attend donc un balayage sequentiel qui grandit avec le
 *     volume.
 *   - La liste compte suivis et taches par sous-requetes correlees, une paire
 *     par ligne. Indexees, donc pas catastrophiques, mais c'est le genre de
 *     cout qui se degrade non lineairement.
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
   * garde-fous de non-regression. Elles sont deliberement laches — le but est
   * qu'elles ne clignotent pas, et qu'un depassement signifie vraiment quelque
   * chose.
   */
  readonly seuilP95: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    nom: 'liste',
    intention: 'La liste des tickets, premiere page — l ecran le plus ouvert de tous',
    methode: 'GET',
    chemin: '/api/tickets',
    seuilP95: 800,
  },
  {
    nom: 'liste-filtree',
    intention: 'La meme, restreinte aux tickets ouverts',
    methode: 'GET',
    chemin: '/api/tickets?status=new',
    seuilP95: 800,
  },
  {
    nom: 'detail',
    intention: 'Un ticket et sa chronologie',
    methode: 'GET',
    chemin: '/api/tickets/1/timeline',
    seuilP95: 500,
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
    seuilP95: 1500,
  },
  {
    nom: 'recherche-statut',
    intention: 'Recherche sur un champ indexe — le temoin de la precedente',
    methode: 'POST',
    chemin: '/api/search/tickets',
    corps: {
      criteria: { kind: 'criterion', field: 'ticket.status', operator: 'eq', value: 'new' },
    },
    seuilP95: 800,
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
