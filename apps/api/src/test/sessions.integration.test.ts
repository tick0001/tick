import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, sql, type Connection } from '@tick/db';
import { RAFRAICHISSEMENT_MS, SESSION_TTL_MS, SessionService } from '../auth/session.service.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Les sessions, et ce qu'une requête écrit en les résolvant.
 *
 * Chaque appel d'API résout la session. Il la réécrivait aussi, pour la
 * prolonger : une écriture par requête. Elle n'est plus réécrite que si sa
 * dernière prolongation date de plus de cinq minutes.
 */
describe('Sessions', () => {
  let owner: Connection;
  let app: Connection;
  let service: SessionService;
  const ouvertes: string[] = [];

  beforeAll(() => {
    owner = createDatabase({ connectionString: process.env['DATABASE_URL'] as string, max: 2 });
    app = createDatabase({ connectionString: process.env['DATABASE_APP_URL'] as string, max: 2 });
    service = new SessionService(new DatabaseService(app.db, owner.db, { owner, app }));
  });

  afterAll(async () => {
    for (const id of ouvertes) {
      await owner.db.execute(sql`DELETE FROM sessions WHERE id = ${id}`);
    }
    await Promise.all([owner.close(), app.close()]);
  });

  async function ouvrir() {
    const resultat = await owner.db.execute<{
      user_id: number;
      profile_id: number;
      entity_id: number;
    }>(sql`
      SELECT user_id, profile_id, entity_id FROM authorizations LIMIT 1
    `);
    const habilitation = resultat.rows[0];

    if (!habilitation)
      throw new Error('Aucune habilitation : le jeu de demonstration est-il charge ?');

    const session = await service.issue(
      {
        userId: Number(habilitation.user_id),
        profileId: Number(habilitation.profile_id),
        entityId: Number(habilitation.entity_id),
        includeSubEntities: true,
      },
      {},
    );

    ouvertes.push(session.id);

    return session;
  }

  async function etat(id: string) {
    const resultat = await owner.db.execute<{ vu: string; expire: string }>(
      sql`SELECT last_seen_at::text AS vu, expires_at::text AS expire FROM sessions WHERE id = ${id}`,
    );

    return resultat.rows[0];
  }

  it('ne réécrit pas une session prolongée il y a peu', async () => {
    const session = await ouvrir();
    const avant = await etat(session.id);

    expect(await service.resolve(session.cookieValue)).toMatchObject({ id: session.id });
    expect(await service.resolve(session.cookieValue)).toMatchObject({ id: session.id });

    expect(await etat(session.id)).toEqual(avant);
  });

  it('prolonge une session dont la dernière prolongation est ancienne', async () => {
    const session = await ouvrir();

    await owner.db.execute(sql`
      UPDATE sessions
         SET last_seen_at = now() - make_interval(secs => ${(RAFRAICHISSEMENT_MS + 60_000) / 1000}),
             expires_at = now() + interval '1 hour'
       WHERE id = ${session.id}
    `);

    const debut = Date.now();

    expect(await service.resolve(session.cookieValue)).not.toBeNull();

    const apres = await etat(session.id);
    const expiration = new Date(String(apres?.expire)).getTime();

    // Repoussée à douze heures, et non plus à une.
    expect(expiration).toBeGreaterThan(debut + SESSION_TTL_MS - 60_000);
    expect(new Date(String(apres?.vu)).getTime()).toBeGreaterThan(debut - 5_000);
  });

  it('refuse toujours une session expirée, même non réécrite', async () => {
    const session = await ouvrir();

    await owner.db.execute(
      sql`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id = ${session.id}`,
    );

    expect(await service.resolve(session.cookieValue)).toBeNull();
  });

  it('refuse une session révoquée', async () => {
    const session = await ouvrir();

    await service.revoke(session.id);

    expect(await service.resolve(session.cookieValue)).toBeNull();
  });
});
