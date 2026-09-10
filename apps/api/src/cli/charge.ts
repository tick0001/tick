import 'reflect-metadata';

/**
 * Fabrique un jeu de données à l'échelle, pour mesurer.
 *
 * Éprouver la tenue en charge sur les sept tickets du jeu de démonstration ne
 * dit rien : tout est en cache, tout tient dans une page, et le moindre
 * balayage séquentiel passe inaperçu. Il faut du volume, et il faut qu'il
 * ressemble à quelque chose — des tickets répartis sur un arbre d'entités, des
 * statuts distribués, des dates étalées, des suivis inégalement répartis.
 *
 * **Tout est généré en SQL**, jamais ligne à ligne depuis Node. Cinq cent mille
 * insertions aller-retour prendraient des heures ; `generate_series` les écrit
 * en une passe, du côté où vivent déjà les données.
 *
 * Cet outil sert au-delà du banc d'essai : voir l'interface avec cent mille
 * tickets révèle ce qu'aucun test ne dit — une pagination qui compte tout, un
 * filtre qui devient inutilisable, une page qui met huit secondes à s'ouvrir.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql, type Transaction } from '@tick/db';
import { AppModule } from '../app.module.js';
import { loadEnvFiles } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

interface Palier {
  readonly nom: string;
  readonly description: string;
  readonly entites: number;
  readonly comptes: number;
  readonly tickets: number;
}

/**
 * Ce qui distingue une ligne generee d'une ligne du jeu de demonstration.
 *
 * Il en faut un : sans marqueur, on ne peut ni effacer ce qu'on a fabrique, ni
 * le laisser cohabiter avec autre chose. Le contenu du ticket sert de marque
 * parce qu'aucune saisie humaine ne lui ressemble.
 */
const MARQUE = 'Signalement genere pour la mesure de charge.';
const MARQUE_SUIVI = 'Suivi genere pour la mesure de charge.';
const MARQUE_ENTITE = 'Entite de charge %';
const MARQUE_COMPTE = 'charge%';

/**
 * Efface le jeu de charge precedent, et lui seul.
 *
 * Sans cela la commande est additive : la relancer double le volume en
 * silence, et le palier annonce ne correspond plus a ce qui est mesure — ce
 * qui vide le banc d'essai de son sens. Constate en direct, deux passages
 * ayant produit dix mille tickets pour un palier qui en annonce cinq mille.
 *
 * Le jeu de demonstration, lui, n'est pas touche : il porte d'autres textes.
 */
async function nettoyer(tx: Transaction): Promise<void> {
  await tx.execute(sql`DELETE FROM itil_followups WHERE content = ${MARQUE_SUIVI}`);
  await tx.execute(sql`
    DELETE FROM itil_actors
     WHERE itil_type = 'ticket'
       AND itil_id IN (SELECT id FROM tickets WHERE content = ${MARQUE})
  `);
  await tx.execute(sql`DELETE FROM tickets WHERE content = ${MARQUE}`);
  await tx.execute(sql`DELETE FROM authorizations WHERE user_id IN (
    SELECT id FROM users WHERE username LIKE ${MARQUE_COMPTE}
  )`);
  await tx.execute(sql`DELETE FROM users WHERE username LIKE ${MARQUE_COMPTE}`);
  await tx.execute(sql`DELETE FROM entities WHERE name LIKE ${MARQUE_ENTITE}`);
}

/**
 * Trois tailles, choisies sur ce que le produit vise réellement.
 *
 * Pas des puissances de dix arbitraires : un service informatique de PME, une
 * collectivité de taille moyenne, et un grand compte mutualisé — c'est ce
 * dernier qui met l'arbre d'entités à l'épreuve, puisque le cloisonnement se
 * paie à chaque requête.
 */
const PALIERS: Record<string, Palier> = {
  pme: {
    nom: 'pme',
    description: 'Service informatique de PME',
    entites: 5,
    comptes: 50,
    tickets: 5_000,
  },
  collectivite: {
    nom: 'collectivite',
    description: 'Collectivité de taille moyenne',
    entites: 30,
    comptes: 200,
    tickets: 50_000,
  },
  'grand-compte': {
    nom: 'grand-compte',
    description: 'Grand compte mutualisé',
    entites: 200,
    comptes: 1_000,
    tickets: 500_000,
  },
};

/**
 * Les entités, en arbre et non en liste.
 *
 * Un arbre plat ne prouve rien : le cloisonnement repose sur des chemins
 * `ltree`, et c'est la profondeur qui coûte. On rattache donc chaque entité à
 * une précédente, ce qui produit un arbre irrégulier — plus proche d'une vraie
 * organisation qu'un peigne ou qu'une chaîne.
 */
async function creerEntites(tx: Transaction, combien: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO entities (name, parent_id, path, complete_name)
    SELECT
      'Entite de charge ' || n,
      (SELECT id FROM entities ORDER BY id LIMIT 1),
      'temporaire',
      'Entite de charge ' || n
    FROM generate_series(1, ${combien}) AS n
  `);

  // Les rattachements se font ensuite, entre entites creees : le declencheur
  // recalcule `path` et `complete_name` a chaque mise a jour du parent.
  await tx.execute(sql`
    UPDATE entities enfant
       SET parent_id = parent.id
      FROM entities parent
     WHERE enfant.name LIKE ${MARQUE_ENTITE}
       AND parent.name LIKE ${MARQUE_ENTITE}
       AND parent.id < enfant.id
       AND parent.id = (
             SELECT id FROM entities candidate
              WHERE candidate.name LIKE ${MARQUE_ENTITE}
                AND candidate.id < enfant.id
              ORDER BY candidate.id DESC
              OFFSET (enfant.id % 3)
              LIMIT 1
           )
  `);
}

async function creerComptes(tx: Transaction, combien: number, empreinte: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO users (username, first_name, last_name, email, password_hash, auth_source, is_active, locale)
    SELECT
      'charge' || n,
      'Prenom' || n,
      'Nom' || n,
      'charge' || n || '@exemple.invalid',
      ${empreinte},
      'local',
      true,
      'fr'
    FROM generate_series(1, ${combien}) AS n
    ON CONFLICT (username) DO NOTHING
  `);
}

/**
 * Les tickets, répartis comme ils le seraient vraiment.
 *
 * Trois choix comptent pour que la mesure ait un sens :
 *
 * - **Les dates s'étalent sur deux ans**, décroissantes. Une base où tout est
 *   ouvert le même jour rend l'index sur `date_opened` inutile, et flatte les
 *   requêtes triées par date — c'est-à-dire toutes celles de la liste.
 * - **Les statuts sont distribués**, avec une majorité de clos : c'est la forme
 *   d'un centre de services réel, et c'est ce qui rend le filtre « ouverts »
 *   sélectif. Tout laisser en `new` mesurerait un cas qui n'arrive jamais.
 * - **Les titres varient**, sinon la recherche textuelle trouve tout ou rien.
 */
async function creerTickets(tx: Transaction, combien: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO tickets (
      entity_id, entity_path, type, status, name, content,
      urgency, impact, priority, date_opened, date_solved, date_closed
    )
    SELECT
      e.id,
      e.path,
      (ARRAY['incident','request']::ticket_type[])[1 + (n % 2)],
      (ARRAY['new','assigned','planned','waiting','solved','closed','closed']::itil_status[])[1 + (n % 7)],
      (ARRAY[
        'Poste de travail lent',
        'Imprimante hors service',
        'Acces refuse au partage',
        'Messagerie inaccessible',
        'Demande de licence',
        'Renouvellement de certificat',
        'Sauvegarde interrompue',
        'Telephonie muette'
      ])[1 + (n % 8)] || ' #' || n,
      ${MARQUE},
      1 + (n % 5),
      1 + ((n * 3) % 5),
      1 + ((n * 7) % 5),
      now() - ((n % 730) || ' days')::interval,
      CASE WHEN (n % 7) >= 4 THEN now() - ((n % 730) || ' days')::interval + interval '4 hours' END,
      CASE WHEN (n % 7) >= 5 THEN now() - ((n % 730) || ' days')::interval + interval '2 days' END
    FROM generate_series(1, ${combien}) AS n
    JOIN LATERAL (
      SELECT id, path FROM entities
       WHERE name LIKE ${MARQUE_ENTITE}
       ORDER BY id
       OFFSET (n % GREATEST(1, (SELECT count(*) FROM entities WHERE name LIKE ${MARQUE_ENTITE})))
       LIMIT 1
    ) AS e ON true
  `);
}

/**
 * Acteurs et suivis, inégalement répartis.
 *
 * L'inégalité est le point : un ticket sur trois porte des suivis, et quelques
 * uns en portent beaucoup. Une distribution uniforme cacherait le coût des
 * sous-requêtes corrélées qui comptent les suivis de chaque ligne de la liste.
 */
async function creerActivite(tx: Transaction): Promise<void> {
  await tx.execute(sql`
    INSERT INTO itil_actors (itil_type, itil_id, role, actor_type, actor_id)
    SELECT 'ticket', t.id, 'requester', 'user', u.id
      FROM tickets t
      JOIN LATERAL (
        SELECT id FROM users WHERE username LIKE ${MARQUE_COMPTE}
         ORDER BY id
         OFFSET (t.id % GREATEST(1, (SELECT count(*) FROM users WHERE username LIKE ${MARQUE_COMPTE})))
         LIMIT 1
      ) AS u ON true
     WHERE t.content = ${MARQUE}
    ON CONFLICT DO NOTHING
  `);

  await tx.execute(sql`
    INSERT INTO itil_followups (itil_type, itil_id, entity_id, entity_path, content, is_private, author_id, created_at)
    SELECT 'ticket', t.id, t.entity_id, t.entity_path,
           ${MARQUE_SUIVI},
           (t.id % 5) = 0,
           NULL,
           t.date_opened + interval '1 hour'
      FROM tickets t
      CROSS JOIN generate_series(1, 3) AS s
     WHERE t.content = ${MARQUE}
       AND (t.id % 3) = 0
       AND s <= 1 + (t.id % 3)
  `);
}

async function main(): Promise<void> {
  loadEnvFiles();
  process.env['RUN_EVENT_WORKER'] = 'false';

  const demande = process.argv[2] ?? '';
  const palier = PALIERS[demande];

  if (!palier) {
    console.error(
      `Palier inconnu : « ${demande} ».\n` +
        `Attendu : ${Object.keys(PALIERS).join(', ')}.\n` +
        'Exemple : pnpm --filter @tick/api db:charge pme',
    );
    process.exitCode = 1;

    return;
  }

  const logger = new Logger('Charge');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  const db = app.get(DatabaseService);

  try {
    const debut = Date.now();

    // Une seule empreinte pour tous les comptes generes : hacher mille fois un
    // mot de passe avec argon2 couterait plus longtemps que tout le reste, et
    // ces comptes ne servent jamais a se connecter.
    const empreinte = await app
      .get<{ hash: (v: string) => Promise<string> }>(
        (await import('../auth/password.service.js')).PasswordService,
      )
      .hash('charge-sans-usage-reel');

    await db.asOwner(async (tx) => {
      logger.log(`Palier « ${palier.nom} » — ${palier.description}`);

      await nettoyer(tx);
      logger.log('Jeu de charge precedent efface.');

      await creerEntites(tx, palier.entites);
      logger.log(`${String(palier.entites)} entites.`);

      await creerComptes(tx, palier.comptes, empreinte);
      logger.log(`${String(palier.comptes)} comptes.`);

      await creerTickets(tx, palier.tickets);
      logger.log(`${String(palier.tickets)} tickets.`);

      await creerActivite(tx);
      logger.log('Acteurs et suivis.');
    });

    // Sans cela, le planificateur travaille sur des statistiques d'avant le
    // remplissage : il choisit des plans faits pour sept lignes, et la mesure
    // porte sur une situation qui n'existe pas.
    await db.asOwner(async (tx) => {
      await tx.execute(sql`ANALYZE tickets, itil_followups, itil_actors, entities, users`);
    });

    logger.log(`Jeu de charge « ${palier.nom} » pret en ${String(Date.now() - debut)} ms.`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
