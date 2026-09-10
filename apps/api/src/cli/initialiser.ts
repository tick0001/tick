import 'reflect-metadata';

/**
 * Ce script doit être exécuté compilé (`node dist/cli/initialiser.js`), jamais
 * par un lanceur fondé sur esbuild comme tsx : esbuild n'émet pas
 * `emitDecoratorMetadata`, et NestJS construirait alors les services avec des
 * dépendances manquantes.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { entities, profileRights, profiles, sql, users, type Transaction } from '@tick/db';
import { AppModule } from '../app.module.js';
import { droitsAdministrateur, lireOptions } from './initialisation.js';
import { PasswordService } from '../auth/password.service.js';
import { loadEnvFiles } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Rend une installation neuve utilisable.
 *
 * Sans cette commande, une base migrée est une base dans laquelle personne ne
 * peut entrer : il n'y a ni entité, ni profil, ni compte — et l'écran de
 * connexion refuse tout le monde sans dire pourquoi. `seed` ne répond pas au
 * besoin : il vide les tables avant d'écrire et installe un jeu de
 * démonstration, ce qu'on ne fait pas sur une base de production.
 *
 * Ce que la commande pose est le strict minimum : une entité racine, un profil
 * d'administration, un compte habilité dessus. Tout le reste — entités filles,
 * groupes, catégories, engagements — se configure ensuite depuis l'interface.
 *
 * Elle **refuse de s'exécuter** si un compte existe déjà. Une commande
 * d'initialisation qui accepterait de tourner deux fois finirait par être
 * lancée sur une base vivante, où elle ajouterait un administrateur dont
 * personne n'attend l'existence.
 */

async function creerRacine(tx: Transaction, nom: string): Promise<number> {
  const [ligne] = await tx
    .insert(entities)
    // `path` et `completeName` sont recalculés par le déclencheur à partir du
    // parent : la valeur posée ici n'est qu'un marqueur.
    .values({ name: nom, parentId: null, path: 'temporaire', completeName: nom })
    .returning({ id: entities.id });

  if (!ligne) throw new Error("Création de l'entité racine impossible.");

  return ligne.id;
}

async function main(): Promise<void> {
  loadEnvFiles();

  // Une commande ponctuelle ne consomme pas la file d'événements : elle en
  // volerait à l'API et les acquitterait sans les traiter.
  process.env['RUN_EVENT_WORKER'] = 'false';

  const options = lireOptions(process.argv.slice(2));
  const logger = new Logger('Initialisation');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const db = app.get(DatabaseService);
  const passwords = app.get(PasswordService);

  try {
    const empreinte = await passwords.hash(options.motDePasse);

    await db.asOwner(async (tx) => {
      const comptes = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM users`);

      if ((comptes.rows[0]?.n ?? 0) > 0) {
        throw new Error(
          'Cette base contient déjà des comptes : rien à initialiser.\n' +
            'Pour ajouter un administrateur, passez par l’écran des utilisateurs.',
        );
      }

      const existantes = await tx.execute<{ id: number }>(
        sql`SELECT id FROM entities WHERE parent_id IS NULL LIMIT 1`,
      );

      // Une racine peut préexister si l'on relance après un échec à mi-course :
      // la réutiliser évite un second arbre, que rien ne rattacherait au premier.
      const racine = existantes.rows[0]?.id ?? (await creerRacine(tx, options.entite));

      const [profil] = await tx
        .insert(profiles)
        .values({ name: 'Administrateur', interface: 'standard', isDefault: false })
        .returning({ id: profiles.id });

      if (!profil) throw new Error('Création du profil impossible.');

      await tx
        .insert(profileRights)
        .values(droitsAdministrateur().map((droit) => ({ profileId: profil.id, ...droit })));

      const [compte] = await tx
        .insert(users)
        .values({
          username: options.identifiant,
          email: options.courriel,
          passwordHash: empreinte,
          authSource: 'local',
          isActive: true,
        })
        .returning({ id: users.id });

      if (!compte) throw new Error('Création du compte impossible.');

      // L'habilitation est récursive : sans elle le compte existe mais ne voit
      // rien, et l'on croit à un mot de passe faux.
      await tx.execute(sql`
        INSERT INTO authorizations (user_id, entity_id, profile_id, is_recursive, is_dynamic)
        VALUES (${compte.id}, ${racine}, ${profil.id}, true, false)
      `);

      logger.log(
        `Entité « ${options.entite} », profil « Administrateur » ` +
          `(${String(droitsAdministrateur().length)} droits) et compte « ${options.identifiant} » créés.`,
      );
    });
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
