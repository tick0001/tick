import {
  createDatabase,
  entities,
  eq,
  groups,
  sql,
  type Connection,
  type EntityScope,
  type RequestContext,
} from '@tick/db';

/**
 * Arborescence de test, batie sous sa propre racine.
 *
 * Elle cohabite avec le jeu de demonstration au lieu de vider la base : les
 * tests restent rejouables sur un poste de developpement sans detruire les
 * donnees avec lesquelles on travaille.
 */
export interface Fixture {
  owner: Connection;
  app: Connection;
  entityIds: Record<string, number>;
  paths: Record<string, string>;
  groupIds: Record<string, number>;
  cleanup: () => Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} est absent : les tests d'integration exigent une base reelle.`);
  }

  return value;
}

export async function createFixture(prefix: string): Promise<Fixture> {
  const owner = createDatabase({ connectionString: requireEnv('DATABASE_URL'), max: 2 });
  const app = createDatabase({ connectionString: requireEnv('DATABASE_APP_URL'), max: 4 });

  const entityIds: Record<string, number> = {};
  const paths: Record<string, string> = {};
  const groupIds: Record<string, number> = {};

  const addEntity = async (key: string, name: string, parent: string | null): Promise<void> => {
    const [row] = await owner.db
      .insert(entities)
      .values({
        name: `${prefix} ${name}`,
        parentId: parent === null ? null : (entityIds[parent] ?? null),
        path: 'temporaire',
        completeName: name,
      })
      .returning({ id: entities.id, path: entities.path });

    if (!row) throw new Error(`Creation de ${name} impossible.`);

    entityIds[key] = row.id;
    paths[key] = row.path;
  };

  const addGroup = async (key: string, entity: string, isRecursive: boolean): Promise<void> => {
    const [row] = await owner.db
      .insert(groups)
      .values({
        entityId: entityIds[entity] as number,
        entityPath: 'temporaire',
        isRecursive,
        name: `${prefix} ${key}`,
        completeName: key,
      })
      .returning({ id: groups.id });

    if (!row) throw new Error(`Creation du groupe ${key} impossible.`);

    groupIds[key] = row.id;
  };

  await addEntity('racine', 'Racine', null);
  await addEntity('siege', 'Siege', 'racine');
  await addEntity('nord', 'Filiale Nord', 'racine');
  await addEntity('siteA', 'Site A', 'nord');
  await addEntity('siteB', 'Site B', 'nord');

  await addGroup('partage', 'racine', true);
  await addGroup('local', 'racine', false);
  await addGroup('equipeA', 'siteA', false);
  await addGroup('equipeB', 'siteB', false);

  return {
    owner,
    app,
    entityIds,
    paths,
    groupIds,
    cleanup: async () => {
      const racine = paths['racine'];

      // Les profils et comptes crees par un test portent son prefixe. Sans ce
      // menage, ils s'accumulent a chaque execution et finissent par polluer
      // l'ecran d'administration du jeu de demonstration — ce qui s'est vu.
      const marque = `${prefix} %`;

      await owner.db.execute(sql`
        DELETE FROM authorizations WHERE profile_id IN (
          SELECT id FROM profiles WHERE name LIKE ${marque})
      `);
      await owner.db.execute(sql`DELETE FROM profiles WHERE name LIKE ${marque}`);
      await owner.db.execute(
        sql`DELETE FROM group_members WHERE user_id IN (
              SELECT id FROM users WHERE username::text LIKE ${prefix.toLowerCase() + '-%'})`,
      );
      await owner.db.execute(
        sql`DELETE FROM users WHERE username::text LIKE ${prefix.toLowerCase() + '-%'}`,
      );

      await owner.db.execute(
        sql`DELETE FROM groups WHERE entity_id IN (SELECT id FROM entities WHERE path <@ ${racine}::ltree)`,
      );
      // Les entites se referencent entre elles : on retire les feuilles jusqu'a
      // ce qu'il n'en reste plus, plutot que de tenter une suppression globale
      // que la cle etrangere refuserait.
      for (;;) {
        const resultat = await owner.db.execute(sql`
          DELETE FROM entities e
          WHERE e.path <@ ${racine}::ltree
            AND NOT EXISTS (SELECT 1 FROM entities enfant WHERE enfant.parent_id = e.id)
        `);

        if ((resultat.rowCount ?? 0) === 0) break;
      }
      await Promise.all([owner.close(), app.close()]);
    },
  };
}

/** Contexte de travail limite a une entite, sans sa descendance. */
export function exactly(entityPath: string, userId = 1, profileId = 1): RequestContext {
  return { userId, profileId, entityPath, scope: { subtreePaths: [], exactPaths: [entityPath] } };
}

/** Contexte de travail couvrant une entite et toute sa descendance. */
export function withSubtree(entityPath: string, userId = 1, profileId = 1): RequestContext {
  return { userId, profileId, entityPath, scope: { subtreePaths: [entityPath], exactPaths: [] } };
}

/** Perimetre vide : ce que voit une connexion sans contexte etabli. */
export const EMPTY_SCOPE: EntityScope = { subtreePaths: [], exactPaths: [] };

/** Rafraichit le chemin d'une entite apres un deplacement. */
export async function pathOf(fixture: Fixture, entityId: number): Promise<string> {
  const [row] = await fixture.owner.db
    .select({ path: entities.path })
    .from(entities)
    .where(eq(entities.id, entityId));

  if (!row) throw new Error('Entite introuvable.');

  return row.path;
}
