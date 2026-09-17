import type { NextFunction, Request, Response } from 'express';
import { loadEnv } from '../config/env.js';

const ECRITURES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuse une écriture venue d'un autre site.
 *
 * Le cookie de session est `SameSite=Lax` : un navigateur ne le joint pas à une
 * écriture lancée depuis un autre site. C'est la protection principale contre
 * la falsification de requête, et elle tient tant qu'aucune route ne modifie
 * rien en `GET`. Ce contrôle en est la seconde ligne, qui ne dépend ni des
 * réglages du navigateur ni de cette discipline.
 *
 * Un navigateur envoie `Origin` sur toute écriture venue d'ailleurs. L'origine
 * est admise si elle désigne l'hôte même de la requête — tel que le relais le
 * transmet —, ou l'adresse de l'interface ou de l'API déclarée dans la
 * configuration. Sans `Origin`, la requête ne vient pas d'un navigateur, et un
 * client en ligne de commande n'a pas de session à détourner : elle passe.
 *
 * L'hôte de la requête est admis en plus de `WEB_URL` : une installation dont
 * `WEB_URL` est mal renseignée envoie des liens faux dans ses courriels, ce qui
 * se corrige ; elle ne doit pas, en plus, refuser toute connexion.
 */
export function exigerMemeOrigine(requete: Request, reponse: Response, suite: NextFunction): void {
  if (!ECRITURES.has(requete.method)) {
    suite();

    return;
  }

  const origine = requete.get('origin');

  if (origine === undefined) {
    suite();

    return;
  }

  if (hotesAdmis(requete).has(hoteDe(origine) ?? '')) {
    suite();

    return;
  }

  reponse.status(403).json({
    statusCode: 403,
    error: 'Forbidden',
    message:
      "Requete refusee : elle vient d'un autre site que Tick&. " +
      'Si Tick& est servi sous une autre adresse, verifiez WEB_URL.',
  });
}

function hotesAdmis(requete: Request): Set<string> {
  const env = loadEnv();

  return new Set(
    [requete.get('host'), hoteDe(env.WEB_URL), hoteDe(env.API_URL)].filter((hote): hote is string =>
      Boolean(hote),
    ),
  );
}

/** L'hôte d'une origine, port compris ; `null` pour une origine opaque ou illisible. */
function hoteDe(origine: string): string | null {
  try {
    const url = new URL(origine);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : null;
  } catch {
    return null;
  }
}
