import { sql, type SQL } from '@tick/db';

/**
 * Une requête de plugin, avec de **vrais paramètres liés**.
 *
 * Les valeurs remplaçaient autrefois `$1`, `$2`… dans le texte, échappées à la
 * main. C'était juste tant que `standard_conforming_strings` restait actif sur
 * le serveur — un réglage que Tick& ne maîtrise pas : désactivé, une barre
 * oblique inverse suivie d'une apostrophe fermait la chaîne, et une valeur
 * venue d'un ticket devenait du SQL. Les valeurs partent maintenant à part du
 * texte, et PostgreSQL ne les interprète jamais.
 *
 * Le texte, lui, reste du code du plugin : il est découpé à chaque `$n`, et
 * chaque morceau est repris tel quel. Un `$n` sans valeur correspondante lève
 * une erreur plutôt que de devenir `NULL` en silence.
 */
export function requeteDePlugin(texte: string, parametres: readonly unknown[]): SQL {
  const morceaux: SQL[] = [];
  let debut = 0;

  for (const correspondance of texte.matchAll(/\$(\d+)/g)) {
    const rang = Number(correspondance[1]);

    if (rang < 1 || rang > parametres.length) {
      throw new Error(
        `La requete cite $${String(rang)}, mais n'a recu que ${String(parametres.length)} parametre(s).`,
      );
    }

    morceaux.push(sql.raw(texte.slice(debut, correspondance.index)));
    // `sql.param` et non une interpolation : dans un gabarit, Drizzle déplie
    // un tableau en liste de paramètres, là où un plugin attend un tableau
    // PostgreSQL — `= ANY($1)`.
    morceaux.push(sql`${sql.param(valeurAdmise(parametres[rang - 1], rang))}`);
    debut = correspondance.index + correspondance[0].length;
  }

  morceaux.push(sql.raw(texte.slice(debut)));

  return sql.join(morceaux);
}

type Simple = string | number | boolean | bigint | Date | null;

/**
 * Types acceptés : ceux dont la conversion ne surprend personne.
 *
 * Un objet est refusé plutôt que converti : le pilote l'enverrait en JSON, ce
 * qui marche pour une colonne `jsonb` et échoue ailleurs sans dire pourquoi.
 * Le plugin le sérialise lui-même, et sait ce qu'il envoie.
 */
function valeurAdmise(valeur: unknown, rang: number): Simple | Simple[] {
  if (valeur === undefined) return null;
  if (estSimple(valeur)) return valeur;
  if (Array.isArray(valeur) && valeur.every(estSimple)) return valeur;

  throw new Error(
    `Parametre $${String(rang)} non pris en charge (${Array.isArray(valeur) ? 'tableau mixte' : typeof valeur}) : ` +
      'chaines, nombres, booleens, dates, null, ou tableaux de ces valeurs. ' +
      'Un objet se serialise avant envoi.',
  );
}

function estSimple(valeur: unknown): valeur is Simple {
  return (
    valeur === null ||
    valeur instanceof Date ||
    ['string', 'number', 'boolean', 'bigint'].includes(typeof valeur)
  );
}
