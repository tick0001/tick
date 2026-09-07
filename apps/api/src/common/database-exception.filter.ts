import { ArgumentsHost, Catch, ConflictException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/**
 * Traduit les violations de contrainte en réponses exploitables.
 *
 * Sans ce filtre, créer un compte dont l'identifiant existe déjà produit une
 * 500 : l'écran affiche « erreur serveur » là où l'utilisateur a simplement
 * ressaisi un identifiant pris. Le défaut est doublement gênant — il fait
 * passer une faute de saisie pour une panne, et il remplit les journaux
 * d'alertes qui n'en sont pas.
 *
 * Le filtre hérite de celui de Nest et lui repasse tout le reste. Un filtre
 * attrape-tout qui ne délègue pas remplacerait la gestion normale des
 * exceptions : les réponses 400 du pipe de validation y perdraient le détail
 * des champs fautifs, sans que rien ne le signale.
 */

/** Codes SQLSTATE que l'application traduit. */
const UNICITE = '23505';
const CLE_ETRANGERE = '23503';

interface ErreurPostgres {
  code?: string;
  constraint?: string;
  table?: string;
}

/**
 * Retrouve l'erreur PostgreSQL sous ses emballages.
 *
 * Drizzle enveloppe ce que remonte le pilote dans un `DrizzleQueryError` qui ne
 * porte ni `code` ni `constraint` : les lire sur l'exception reçue donnerait
 * toujours `undefined`, et le filtre laisserait passer chaque violation en 500
 * sans que rien ne le signale. On descend donc la chaîne des causes.
 */
function erreurPostgres(exception: unknown): ErreurPostgres | undefined {
  let courant: unknown = exception;

  for (
    let profondeur = 0;
    profondeur < 5 && courant !== null && courant !== undefined;
    profondeur += 1
  ) {
    const candidat = courant as ErreurPostgres & { cause?: unknown };

    if (typeof candidat.code === 'string') return candidat;

    courant = candidat.cause;
  }

  return undefined;
}

/**
 * Messages par contrainte.
 *
 * Le nom de la contrainte est ce que PostgreSQL rapporte, et c'est la seule
 * information fiable pour désigner *quel* champ pose problème : le `detail`
 * contient la valeur saisie, qu'on ne renvoie pas.
 */
const MESSAGES: Record<string, string> = {
  users_username_key: 'Cet identifiant est deja utilise par un autre compte.',
  users_email_key: 'Cette adresse est deja utilisee par un autre compte.',
  entities_path_key: 'Une entite porte deja ce chemin.',
  plugins_pkey: 'Ce plugin est deja installe.',
};

function messagePour(erreur: ErreurPostgres): string {
  const connu = erreur.constraint === undefined ? undefined : MESSAGES[erreur.constraint];

  if (connu) return connu;

  if (erreur.code === CLE_ETRANGERE) {
    return "L'element vise n'existe pas, ou il est encore reference ailleurs.";
  }

  return 'Cette valeur est deja utilisee.';
}

@Catch()
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  private readonly journal = new Logger('BaseDeDonnees');

  override catch(exception: unknown, host: ArgumentsHost): void {
    const erreur = erreurPostgres(exception);

    if (!erreur || (erreur.code !== UNICITE && erreur.code !== CLE_ETRANGERE)) {
      super.catch(exception, host);
      return;
    }

    // Le detail de l'erreur porte la valeur rejetee : on la journalise sans la
    // renvoyer au client.
    this.journal.warn(`${erreur.code} sur ${erreur.constraint ?? erreur.table ?? '?'}`);

    super.catch(new ConflictException(messagePour(erreur)), host);
  }
}
