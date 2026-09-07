import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestContainer } from '@nestjs/core/injector/container.js';
import { z, type ZodType } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

/**
 * Document OpenAPI, déduit de l'application elle-même.
 *
 * Rien n'est décrit à la main. Les routes viennent du conteneur NestJS, et les
 * schémas des `ZodValidationPipe` que les contrôleurs portent déjà — c'est-à-dire
 * de ce que le serveur **vérifie réellement**. Une description tenue en
 * parallèle aurait commencé à mentir au premier champ ajouté, et une
 * documentation fausse est pire que pas de documentation : elle est crue.
 *
 * Le droit exigé par chaque route y figure aussi. C'est l'information que
 * cherche en premier quiconque intègre cette API : savoir qu'un appel existe ne
 * sert à rien tant qu'on ignore quel profil peut le faire.
 *
 * Ce qui n'y est pas : les schémas de **réponse**. Ils ne sont validés nulle
 * part côté serveur — le contrat est appliqué par le client — et les déclarer
 * ici reviendrait à les recopier, donc à recréer exactement la duplication que
 * ce générateur évite. Les formes sont publiées dans `@tick/contracts`, qui est
 * leur source.
 */

/** Position d'un argument de route, telle que NestJS la code. */
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

const METHODES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

interface ArgumentRoute {
  index: number;
  data?: string;
  pipes?: unknown[];
}

export interface RouteDecouverte {
  methode: string;
  chemin: string;
  controleur: string;
  action: string;
  droit?: { object: string; action: string } | undefined;
  corps?: ZodType | undefined;
  requete?: ZodType | undefined;
  parametres: string[];
  /** Code de succès, quand la route en impose un autre que 200. */
  code: number;
}

/** Concatène préfixe et chemin de méthode en une route propre. */
function joindre(...morceaux: (string | undefined)[]): string {
  const chemin = morceaux
    .filter((morceau): morceau is string => Boolean(morceau) && morceau !== '/')
    .join('/')
    .replaceAll(/\/+/g, '/');

  return `/${chemin}`.replace(/\/$/, '') || '/';
}

/** `:id` en notation Express devient `{id}` en OpenAPI. */
function versOpenApi(chemin: string): string {
  return chemin.replaceAll(/:(\w+)/g, '{$1}');
}

function schemaDuPipe(pipes: unknown[] | undefined): ZodType | undefined {
  const pipe = pipes?.find((candidat) => candidat instanceof ZodValidationPipe);

  return pipe instanceof ZodValidationPipe ? (pipe.schema as ZodType) : undefined;
}

/**
 * Parcourt les contrôleurs montés et relève ce que chaque route déclare.
 *
 * On lit le conteneur plutôt que le routeur d'Express : le routeur ne garde que
 * des chemins et des fonctions anonymes, alors que le conteneur conserve le
 * lien vers la classe et ses métadonnées — donc vers les pipes et les droits.
 */
export function decouvrirRoutes(app: INestApplicationContext): RouteDecouverte[] {
  const conteneur = (app as unknown as { container: NestContainer }).container;
  const routes: RouteDecouverte[] = [];

  for (const module of conteneur.getModules().values()) {
    for (const enveloppe of module.controllers.values()) {
      const classe = enveloppe.metatype;

      if (typeof classe !== 'function') continue;

      const prefixe = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined;
      const prototype = classe.prototype as Record<string, unknown>;

      for (const nom of Object.getOwnPropertyNames(prototype)) {
        if (nom === 'constructor') continue;

        // `RequestMethod` est une enumeration : on la lit comme telle plutot
        // que comme un nombre, sinon toute comparaison avec l'un de ses
        // membres devient un rapprochement entre deux types etrangers.
        const methodeHttp = Reflect.getMetadata(METHOD_METADATA, prototype[nom] as object) as
          RequestMethod | undefined;

        if (methodeHttp === undefined || !(methodeHttp in METHODES)) continue;

        const cheminMethode = Reflect.getMetadata(PATH_METADATA, prototype[nom] as object) as
          string | undefined;

        const arguments_ =
          (Reflect.getMetadata(ROUTE_ARGS_METADATA, classe, nom) as
            Record<string, ArgumentRoute> | undefined) ?? {};

        let corps: ZodType | undefined;
        let requete: ZodType | undefined;
        const parametres: string[] = [];

        for (const [cle, argument] of Object.entries(arguments_)) {
          const type = Number(cle.split(':')[0]);

          if (type === BODY) corps = schemaDuPipe(argument.pipes);
          if (type === QUERY && argument.data === undefined) requete = schemaDuPipe(argument.pipes);
          if (type === PARAM && argument.data) parametres.push(argument.data);
        }

        routes.push({
          methode: METHODES[methodeHttp] as string,
          chemin: versOpenApi(joindre('api', prefixe, cheminMethode)),
          controleur: classe.name,
          action: nom,
          droit: Reflect.getMetadata('tick:right', prototype[nom] as object) as
            { object: string; action: string } | undefined,
          corps,
          requete,
          parametres,
          // Une suppression repond 204 sans corps : documenter 200 promettrait
          // une reponse que le client attendrait en vain.
          code:
            (Reflect.getMetadata(HTTP_CODE_METADATA, prototype[nom] as object) as
              number | undefined) ?? (methodeHttp === RequestMethod.POST ? 201 : 200),
        });
      }
    }
  }

  return routes.sort(
    (a, b) => a.chemin.localeCompare(b.chemin) || a.methode.localeCompare(b.methode),
  );
}

/** Convertit un schéma Zod en JSON Schema, sans l'en-tête de dialecte. */
function enJsonSchema(schema: ZodType): Record<string, unknown> {
  const converti = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<
    string,
    unknown
  >;

  // `$schema` n'a pas sa place dans un sous-schéma OpenAPI : le document
  // déclare déjà son dialecte une fois, en tête.
  delete converti['$schema'];

  return converti;
}

/**
 * Paramètres de requête, décomposés depuis le schéma de la chaîne de requête.
 *
 * OpenAPI attend un paramètre par clé, là où Zod décrit l'objet entier :
 * publier l'objet tel quel produirait une documentation qu'aucun outil ne sait
 * transformer en formulaire d'essai.
 */
function parametresDeRequete(schema: ZodType): Record<string, unknown>[] {
  const converti = enJsonSchema(schema);
  const proprietes = (converti['properties'] ?? {}) as Record<string, unknown>;
  const requis = (converti['required'] ?? []) as string[];

  return Object.entries(proprietes).map(([nom, forme]) => ({
    name: nom,
    in: 'query',
    required: requis.includes(nom),
    schema: forme,
  }));
}

export interface InfosDocument {
  titre: string;
  version: string;
  serveur: string;
}

export function construireOpenApi(
  routes: readonly RouteDecouverte[],
  infos: InfosDocument,
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routes) {
    const operation: Record<string, unknown> = {
      operationId: `${route.controleur}.${route.action}`,
      tags: [route.controleur.replace(/Controller$/, '')],
      parameters: [
        ...route.parametres.map((nom) => ({
          name: nom,
          in: 'path',
          required: true,
          schema: { type: 'string' },
        })),
        ...(route.requete ? parametresDeRequete(route.requete) : []),
      ],
      responses: {
        [String(route.code)]:
          route.code === 204
            ? { description: 'Effectué, sans contenu.' }
            : { description: 'Succès.' },
        '401': { description: 'Aucune session.' },
      },
    };

    if (route.corps) {
      operation['requestBody'] = {
        required: true,
        content: { 'application/json': { schema: enJsonSchema(route.corps) } },
      };
    }

    if (route.droit) {
      // Le droit est exposé comme une extension : aucun champ standard
      // d'OpenAPI ne dit « cette route exige tel droit applicatif », et le
      // noyer dans la description le rendrait illisible à la machine.
      operation['x-tick-droit'] = route.droit;
      operation['description'] = `Exige le droit \`${route.droit.object}:${route.droit.action}\`.`;

      (operation['responses'] as Record<string, unknown>)['403'] = {
        description: 'Le profil actif ne détient pas ce droit.',
      };
    }

    paths[route.chemin] = { ...paths[route.chemin], [route.methode]: operation };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: infos.titre,
      version: infos.version,
      description:
        'API REST de Tick&. La session est un cookie `httpOnly` posé par ' +
        '`POST /api/auth/login` ; toutes les autres routes l’exigent.\n\n' +
        'Les formes de réponse sont publiées par le paquet `@tick/contracts`, ' +
        'qui en est la source — elles ne sont pas recopiées ici.',
      license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
    },
    servers: [{ url: infos.serveur }],
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'tick_session' },
      },
    },
    security: [{ session: [] }],
    paths,
  };
}
