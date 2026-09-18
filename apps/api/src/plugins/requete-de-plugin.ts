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
 *
 * **Un `$n` n'est un paramètre que s'il en est un.** Balayer le texte à la
 * simple expression régulière prenait `SELECT 'coûte $10'` pour une citation du
 * dixième paramètre : la requête partait amputée de son texte, ou échouait sur
 * un décompte d'arguments que rien n'expliquait. Les littéraux, les
 * identifiants entre guillemets, les blocs `$$…$$` et les commentaires sont
 * donc traversés sans y rien chercher.
 */
export function requeteDePlugin(texte: string, parametres: readonly unknown[]): SQL {
  const morceaux: SQL[] = [];
  let debut = 0;
  let i = 0;

  while (i < texte.length) {
    const saut = finDeZoneOpaque(texte, i);

    if (saut !== null) {
      i = saut;
      continue;
    }

    const parametre = /^\$(\d+)/.exec(texte.slice(i));

    if (!parametre) {
      i += 1;
      continue;
    }

    const rang = Number(parametre[1]);

    if (rang < 1 || rang > parametres.length) {
      throw new Error(
        `La requete cite $${String(rang)}, mais n'a recu que ${String(parametres.length)} parametre(s).`,
      );
    }

    morceaux.push(sql.raw(texte.slice(debut, i)));
    // `sql.param` et non une interpolation : dans un gabarit, Drizzle déplie
    // un tableau en liste de paramètres, là où un plugin attend un tableau
    // PostgreSQL — `= ANY($1)`.
    morceaux.push(sql`${sql.param(valeurAdmise(parametres[rang - 1], rang))}`);
    i += parametre[0].length;
    debut = i;
  }

  morceaux.push(sql.raw(texte.slice(debut)));

  return sql.join(morceaux);
}

/**
 * Fin de la zone où un `$n` ne veut rien dire, si `i` en ouvre une.
 *
 * Rend `null` quand le caractère courant est du code ordinaire. Une zone non
 * refermée court jusqu'au bout du texte : PostgreSQL rejettera la requête de
 * toute façon, et deviner mieux serait deviner.
 */
function finDeZoneOpaque(texte: string, i: number): number | null {
  if (texte.startsWith('--', i)) {
    const fin = texte.indexOf('\n', i);

    return fin === -1 ? texte.length : fin + 1;
  }

  if (texte.startsWith('/*', i)) {
    // Les commentaires de bloc s'imbriquent, en SQL.
    let profondeur = 1;
    let j = i + 2;

    while (j < texte.length && profondeur > 0) {
      if (texte.startsWith('/*', j)) {
        profondeur += 1;
        j += 2;
      } else if (texte.startsWith('*/', j)) {
        profondeur -= 1;
        j += 2;
      } else {
        j += 1;
      }
    }

    return j;
  }

  const guillemet = texte[i];

  if (guillemet === "'" || guillemet === '"') {
    let j = i + 1;

    while (j < texte.length) {
      if (texte[j] !== guillemet) {
        j += 1;
      } else if (texte[j + 1] === guillemet) {
        // Doublé, donc échappé : la chaîne continue.
        j += 2;
      } else {
        return j + 1;
      }
    }

    return texte.length;
  }

  // `$$…$$` ou `$etiquette$…$etiquette$`. Une étiquette ne commence jamais par
  // un chiffre, ce qui distingue `$1$` — paramètre suivi d'un dollar — d'une
  // ouverture de bloc.
  const ouverture = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(texte.slice(i));

  if (ouverture) {
    const marque = ouverture[0];
    const fin = texte.indexOf(marque, i + marque.length);

    return fin === -1 ? texte.length : fin + marque.length;
  }

  return null;
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
