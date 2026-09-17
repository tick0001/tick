import { request as requeteHttp, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as requeteHttps } from 'node:https';
import type { LookupFunction } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import type { PluginHttpRequest, PluginHttpResponse } from '@tick/plugin-sdk';
import { resoudreSortant } from '../common/reseau.js';

/** Sans precision du plugin. Un webhook qui ne repond pas en dix secondes ne repondra pas. */
const DELAI_DEFAUT_MS = 10_000;
/** Au-dela, le plugin retient un travail de la file trop longtemps. */
const DELAI_MAXIMAL_MS = 30_000;
/** Un plugin qui lit une reponse plus grosse n'est pas en train d'appeler un webhook. */
const TAILLE_MAXIMALE = 1024 * 1024;

/**
 * Requete sortante pour le compte d'un plugin.
 *
 * Trois choses la distinguent d'un `fetch` :
 *
 *  - **les adresses sont verifiees puis epinglees.** `resoudreSortant` resout
 *    le nom, refuse une adresse interne quand l'instance l'exige, et la
 *    connexion ne part que vers ces adresses-la. Le certificat, lui, reste verifie
 *    pour le nom demande ;
 *  - **les redirections ne sont pas suivies.** Une redirection pourrait mener la
 *    ou la verification a dit non ; le plugin recoit le code 3xx et decide ;
 *  - **tout est borne** : schema, delai, taille de la reponse.
 *
 * `node:http` plutot que `fetch` pour une raison precise : c'est la seule voie,
 * sans dependance, qui laisse fournir sa propre resolution de nom.
 */
export async function requeteSortante(
  url: string,
  init: PluginHttpRequest = {},
): Promise<PluginHttpResponse> {
  let cible: URL;

  try {
    cible = new URL(url);
  } catch {
    // L'adresse n'est pas repetee : celle d'un webhook porte son jeton, et ce
    // message finit dans les journaux.
    throw new BadRequestException('Adresse invalide.');
  }

  if (cible.protocol !== 'http:' && cible.protocol !== 'https:') {
    throw new BadRequestException(
      `Schema refuse : ${cible.protocol} — seuls http: et https: sont permis.`,
    );
  }

  if (cible.username || cible.password) {
    // Des identifiants dans l'adresse finissent dans les journaux de quiconque
    // la relaie. Un plugin les passe en en-tete.
    throw new BadRequestException("Identifiants refuses dans l'adresse : passez-les en en-tete.");
  }

  const epinglees = await resoudreSortant(cible.hostname);
  const [premiere] = epinglees;
  const delai = Math.min(Math.max(init.timeoutMs ?? DELAI_DEFAUT_MS, 1), DELAI_MAXIMAL_MS);

  // La resolution est deja faite : on rend les adresses verifiees, quel que
  // soit le nom qu'on nous redemande. `resoudreSortant` en garantit au moins une.
  const resolution: LookupFunction = (_nom, options, rappel) => {
    if (options.all) {
      rappel(null, epinglees);
    } else if (premiere) {
      rappel(null, premiere.address, premiere.family);
    }
  };

  const options: RequestOptions = {
    method: init.method ?? 'GET',
    headers: {
      'user-agent': 'Tick&',
      ...init.headers,
      ...(init.body === undefined ? {} : { 'content-length': Buffer.byteLength(init.body) }),
    },
    lookup: resolution,
    timeout: delai,
  };

  const envoyer = cible.protocol === 'https:' ? requeteHttps : requeteHttp;

  return new Promise<PluginHttpResponse>((resoudre, rejeter) => {
    const requete = envoyer(cible, options, (reponse: IncomingMessage) => {
      const morceaux: Buffer[] = [];
      let lus = 0;

      reponse.on('data', (morceau: Buffer) => {
        lus += morceau.length;

        if (lus > TAILLE_MAXIMALE) {
          const reste = TAILLE_MAXIMALE - (lus - morceau.length);

          if (reste > 0) morceaux.push(morceau.subarray(0, reste));
          reponse.destroy();

          return;
        }

        morceaux.push(morceau);
      });

      const conclure = (): void => {
        const entetes: Record<string, string> = {};

        for (const [nom, valeur] of Object.entries(reponse.headers)) {
          if (valeur === undefined) continue;

          entetes[nom] = Array.isArray(valeur) ? valeur.join(', ') : valeur;
        }

        resoudre({
          status: reponse.statusCode ?? 0,
          headers: entetes,
          body: Buffer.concat(morceaux).toString('utf8'),
        });
      };

      reponse.on('end', conclure);
      // Detruite volontairement au-dela de la taille permise : ce qui a ete lu
      // est rendu, tronque, comme le contrat l'annonce.
      reponse.on('close', conclure);
      reponse.on('error', rejeter);
    });

    requete.on('timeout', () => {
      requete.destroy(new Error(`Pas de reponse de ${cible.host} en ${String(delai)} ms.`));
    });
    requete.on('error', rejeter);

    if (init.body !== undefined) requete.write(init.body);
    requete.end();
  });
}
