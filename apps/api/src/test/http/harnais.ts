import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDatabase, sql } from '@tick/db';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../app.module.js';
import { DatabaseExceptionFilter } from '../../common/database-exception.filter.js';

/**
 * Harnais HTTP : l'application réelle, montée comme en production.
 *
 * Les tests d'intégration existants appellent les services directement, ce qui
 * laisse les contrôleurs, les gardes, le pipe de validation et le middleware de
 * session entièrement hors couverture — c'est-à-dire précisément la couche qui
 * décide *qui a le droit de faire quoi*. Un service correct derrière une garde
 * absente est une faille, et aucun test de service ne la verrait.
 *
 * On monte donc `AppModule` avec le même câblage que `main.ts`. La base et
 * Redis sont réels : ce sont les mêmes que pour les autres tests d'intégration.
 */
export interface Harnais {
  app: INestApplication;
  /** Requête authentifiée en tant qu'`admin` (tous les droits). */
  admin: () => request.Agent;
  /** Requête sans session : ce que voit un visiteur. */
  anonyme: () => request.Agent;
  /** Ouvre une session pour un autre compte du jeu de démonstration. */
  connecte: (username: string, password?: string) => Promise<request.Agent>;
  /**
   * Préfixe unique à cette exécution.
   *
   * Les objets créés par un test le portent dans leur nom, et le ménage final
   * s'y accroche. Sans lui, une deuxième exécution buterait sur ses propres
   * doublons — et le jeu de démonstration se remplirait de restes, ce qui s'est
   * déjà vu sur l'écran d'administration.
   */
  prefixe: string;
  close: () => Promise<void>;
}

/**
 * Efface les objets créés sous un préfixe.
 *
 * Le rôle propriétaire est employé volontairement : il n'est pas soumis aux
 * politiques de sécurité, et le ménage doit atteindre ce qu'un test a pu créer
 * hors du périmètre de sa session.
 */
async function nettoyer(prefixe: string): Promise<void> {
  const url = process.env['DATABASE_URL'];

  if (!url) return;

  const proprietaire = createDatabase({ connectionString: url, max: 1 });
  const marque = prefixe + '%';

  try {
    await proprietaire.db.execute(
      sql`DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE name LIKE ${marque})`,
    );
    await proprietaire.db.execute(sql`DELETE FROM groups WHERE name LIKE ${marque}`);
    await proprietaire.db.execute(
      sql`DELETE FROM authorizations WHERE user_id IN (
            SELECT id FROM users WHERE username::text LIKE ${marque})`,
    );
    await proprietaire.db.execute(
      sql`DELETE FROM group_members WHERE user_id IN (
            SELECT id FROM users WHERE username::text LIKE ${marque})`,
    );
    await proprietaire.db.execute(sql`DELETE FROM users WHERE username::text LIKE ${marque}`);
    await proprietaire.db.execute(
      sql`DELETE FROM profile_rights WHERE profile_id IN (
            SELECT id FROM profiles WHERE name LIKE ${marque})`,
    );
    await proprietaire.db.execute(sql`DELETE FROM profiles WHERE name LIKE ${marque}`);
    // Les categories partent d'un seul coup : les contraintes de cle
    // etrangere se verifient en fin d'instruction, si bien qu'une mere et
    // sa fille peuvent disparaitre ensemble sans ordre a respecter.
    await proprietaire.db.execute(sql`DELETE FROM itil_categories WHERE name LIKE ${marque}`);
    await proprietaire.db.execute(sql`DELETE FROM ldap_directories WHERE name LIKE ${marque}`);
    await proprietaire.db.execute(sql`DELETE FROM entities WHERE name LIKE ${marque}`);
  } finally {
    await proprietaire.close();
  }
}

export async function creerHarnais(nom = 'http'): Promise<Harnais> {
  const prefixe = nom + '-' + Date.now().toString(36) + '-';
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();

  // Le meme cablage que `main.ts` : un prefixe ou un analyseur de cookies
  // oublie ici ferait passer des tests sur une application qui n'existe pas.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new DatabaseExceptionFilter(app.getHttpAdapter()));
  app.enableShutdownHooks();

  await app.init();

  const serveur = app.getHttpServer() as App;

  const connecte = async (username: string, password = 'tick'): Promise<request.Agent> => {
    const agent = request.agent(serveur);
    const reponse = await agent.post('/api/auth/login').send({ username, password });

    if (reponse.status !== 200) {
      throw new Error(
        `Connexion de ${username} refusee (${reponse.status}). ` +
          'Le jeu de demonstration est-il charge ? `pnpm db:seed`.',
      );
    }

    return agent;
  };

  const session = await connecte('admin');

  return {
    app,
    admin: () => session,
    anonyme: () => request.agent(serveur),
    connecte,
    prefixe,
    close: async () => {
      await app.close();
      await nettoyer(prefixe);
    },
  };
}
