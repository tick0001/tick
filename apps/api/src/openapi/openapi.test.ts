import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { construireOpenApi, decouvrirRoutes, type RouteDecouverte } from './openapi.builder.js';

/**
 * La description de l'API, vérifiée contre l'API elle-même.
 *
 * Ce fichier existe pour une raison précise : une documentation d'interface
 * publique est crue. Si elle omet une route, personne ne l'utilise ; si elle en
 * décrit une qui n'existe plus, on perd une demi-journée à chercher pourquoi
 * l'appel échoue. Le générateur lit le conteneur NestJS pour qu'aucun des deux
 * ne puisse arriver — et ces tests vérifient qu'il le lit bien.
 *
 * Ils montent le vrai `AppModule`, sans serveur HTTP : les métadonnées de route
 * existent dès que les contrôleurs sont instanciés.
 */

describe('OpenAPI', () => {
  let routes: RouteDecouverte[];
  let document: Record<string, unknown>;

  beforeAll(async () => {
    process.env['RUN_EVENT_WORKER'] = 'false';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = await module.init();

    routes = decouvrirRoutes(app);
    document = construireOpenApi(routes, {
      titre: 'Tick&',
      version: '0.0.0',
      serveur: 'http://localhost:3000',
    });

    await app.close();
  }, 120_000);

  afterAll(() => {
    delete process.env['RUN_EVENT_WORKER'];
  });

  it('découvre toutes les routes montées', () => {
    // Garde-fou : si la lecture du conteneur cessait de fonctionner, le
    // document sortirait vide et tous les autres tests passeraient encore.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('préfixe chaque chemin par `/api`, comme le fait l’application', () => {
    // `setGlobalPrefix('api')` est posé dans `main.ts`, hors de portée du
    // conteneur : l'oublier ici produirait un document dont aucun chemin ne
    // répondrait.
    for (const route of routes) {
      expect(route.chemin.startsWith('/api/')).toBe(true);
    }
  });

  it('traduit les paramètres de chemin en notation OpenAPI', () => {
    for (const route of routes) {
      expect(route.chemin).not.toMatch(/:\w/);
    }

    const parId = routes.find((route) => route.chemin.includes('{id}'));

    expect(parId).toBeDefined();
    expect(parId?.parametres).toContain('id');
  });

  it('relève le droit exigé là où une garde le déclare', () => {
    const supprimer = routes.find(
      (route) =>
        route.chemin === '/api/referentials/itil-categories/{id}' && route.methode === 'delete',
    );

    // C'est l'information que cherche en premier qui intègre l'API : savoir
    // qu'un appel existe ne sert à rien tant qu'on ignore qui peut le faire.
    expect(supprimer?.droit).toEqual({ object: 'category', action: 'delete' });
  });

  it('relève le schéma de corps depuis le pipe de validation', () => {
    const creer = routes.find(
      (route) => route.chemin === '/api/referentials/itil-categories' && route.methode === 'post',
    );

    expect(creer?.corps).toBeDefined();

    const corps = (
      document['paths'] as Record<string, Record<string, Record<string, unknown>>>
    )['/api/referentials/itil-categories']?.['post']?.['requestBody'] as Record<string, unknown>;

    const schema = (corps['content'] as Record<string, Record<string, Record<string, unknown>>>)[
      'application/json'
    ]?.['schema'] as Record<string, unknown>;

    // Le schéma vient de `upsertItilCategorySchema` : il porte donc ses champs
    // réels, et non une description approximative écrite à côté.
    expect(Object.keys(schema['properties'] as object)).toContain('isHelpdeskVisible');
    expect(schema['required']).toContain('name');
  });

  it('décompose la chaîne de requête en paramètres', () => {
    const liste = (document['paths'] as Record<string, Record<string, Record<string, unknown>>>)[
      '/api/referentials/itil-categories'
    ]?.['get'];

    const parametres = (liste?.['parameters'] ?? []) as { name: string; in: string }[];

    // Publier l'objet entier produirait un document qu'aucun outil ne sait
    // transformer en formulaire d'essai.
    expect(parametres.some((parametre) => parametre.in === 'query')).toBe(true);
  });

  it('annonce 204 là où la route ne renvoie pas de contenu', () => {
    const supprimer = (
      document['paths'] as Record<string, Record<string, Record<string, unknown>>>
    )['/api/referentials/itil-categories/{id}']?.['delete'];

    const reponses = supprimer?.['responses'] as Record<string, unknown>;

    // Promettre 200 ferait attendre au client un corps qui n'arrive jamais.
    expect(Object.keys(reponses)).toContain('204');
    expect(Object.keys(reponses)).not.toContain('200');
  });

  it('déclare 403 exactement là où un droit est exigé', () => {
    const chemins = document['paths'] as Record<string, Record<string, Record<string, unknown>>>;

    for (const operations of Object.values(chemins)) {
      for (const operation of Object.values(operations)) {
        const reponses = Object.keys(operation['responses'] as Record<string, unknown>);

        expect(reponses.includes('403')).toBe(Boolean(operation['x-tick-droit']));
      }
    }
  });

  it('produit un document sérialisable, sans référence circulaire', () => {
    // Les schémas Zod peuvent être récursifs — une catégorie a un parent qui a
    // des filles. Si la conversion laissait passer un cycle, le document
    // deviendrait impossible à servir, et l'échec surviendrait en production.
    expect(() => JSON.stringify(document)).not.toThrow();
  });

  it('déclare la session comme mécanisme de sécurité', () => {
    const composants = document['components'] as Record<string, Record<string, unknown>>;
    const session = composants['securitySchemes']?.['session'] as Record<string, unknown>;

    expect(session).toEqual({ type: 'apiKey', in: 'cookie', name: 'tick_session' });
  });
});
