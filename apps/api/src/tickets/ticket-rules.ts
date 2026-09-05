import type { ItilStatus, TicketActorInput, TicketType } from '@tick/contracts';

/**
 * Champs de ticket qu'une règle peut écrire, et leur nature.
 *
 * Le moteur ne manipule que du texte : c'est ici que la valeur redevient un
 * nombre, un statut ou un acteur. Faire cette conversion au plus près de la
 * colonne évite qu'une règle mal écrite pose la chaîne « 4 » dans une colonne
 * entière — et permet d'ignorer proprement une valeur inconvertible.
 */
const NOMBRES = new Set([
  'urgency',
  'impact',
  'priority',
  'categoryId',
  'requestSourceId',
  'locationId',
  'slaTtoId',
  'slaTtrId',
  'olaTtoId',
  'olaTtrId',
]);

const TEXTES = new Set(['name', 'content']);

const TYPES: readonly TicketType[] = ['incident', 'request'];
const STATUTS: readonly ItilStatus[] = [
  'new',
  'assigned',
  'planned',
  'waiting',
  'solved',
  'closed',
];

/**
 * Champs qui désignent un acteur, non une colonne.
 *
 * Ils vivent dans `itil_actors`, pas dans `tickets` : les écrire comme les
 * autres produirait une erreur SQL, et les taire priverait les règles de leur
 * usage le plus courant — router un ticket vers le bon groupe.
 */
const ACTEURS: Record<string, { role: TicketActorInput['role']; actorType: 'user' | 'group' }> = {
  assignedGroupId: { role: 'assigned', actorType: 'group' },
  assignedUserId: { role: 'assigned', actorType: 'user' },
  observerUserId: { role: 'observer', actorType: 'user' },
};

function entier(valeur: string | null): number | null {
  if (valeur === null || valeur.trim() === '') return null;

  const nombre = Number(valeur);

  return Number.isInteger(nombre) ? nombre : null;
}

/**
 * Reporte le résultat d'une collection de règles sur les champs d'un ticket.
 *
 * Les acteurs sont extraits plutôt qu'affectés : ils sont écrits séparément,
 * une fois le ticket connu.
 */
export function applyRuleOutput(
  champs: Record<string, unknown>,
  output: Record<string, string | null>,
): TicketActorInput[] {
  const acteurs: TicketActorInput[] = [];

  for (const [cle, valeur] of Object.entries(output)) {
    const acteur = ACTEURS[cle];

    if (acteur) {
      const id = entier(valeur);

      if (id !== null) acteurs.push({ ...acteur, actorId: id });
      continue;
    }

    if (NOMBRES.has(cle)) {
      champs[cle] = entier(valeur);
      continue;
    }

    if (TEXTES.has(cle)) {
      champs[cle] = valeur ?? '';
      continue;
    }

    // Un statut ou un type inconnu est ignoré : une règle ne doit pas pouvoir
    // écrire une valeur que l'énumération de la base refusera.
    if (cle === 'type' && valeur !== null && (TYPES as readonly string[]).includes(valeur)) {
      champs[cle] = valeur;
      continue;
    }

    if (cle === 'status' && valeur !== null && (STATUTS as readonly string[]).includes(valeur)) {
      champs[cle] = valeur;
    }
  }

  return acteurs;
}

/** Bornes de l'échelle d'urgence, d'impact et de priorité. */
export function borne(valeur: unknown, defaut: number): number {
  const nombre = Number(valeur);

  return Number.isInteger(nombre) ? Math.min(5, Math.max(1, nombre)) : defaut;
}

/**
 * Lectures typées du jeu de champs.
 *
 * Le jeu est un `Record<string, unknown>` parce que les règles y écrivent des
 * clés qu'elles seules connaissent. Le relire suppose donc de vérifier la
 * nature de chaque valeur, plutôt que de la convertir de force : une action mal
 * saisie ne doit jamais poser `[object Object]` dans un titre de ticket.
 */
export function texte(champs: Record<string, unknown>, cle: string, defaut: string): string {
  const valeur = champs[cle];

  return typeof valeur === 'string' ? valeur : defaut;
}

export function reference(champs: Record<string, unknown>, cle: string): number | null {
  const valeur = champs[cle];

  return typeof valeur === 'number' && Number.isInteger(valeur) ? valeur : null;
}

export function choix<T extends string>(
  champs: Record<string, unknown>,
  cle: string,
  autorises: readonly T[],
  defaut: T,
): T {
  const valeur = champs[cle];

  return typeof valeur === 'string' && (autorises as readonly string[]).includes(valeur)
    ? (valeur as T)
    : defaut;
}
