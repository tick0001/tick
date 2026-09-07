import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileRights, profiles, satisfactionConfigs, sql, tickets, users } from '@tick/db';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import type { EventBus } from '../plugins/event-bus.service.js';
import { setEventPublisher, type PendingEvent } from '../plugins/event-buffer.js';
import { SatisfactionService } from '../satisfaction/satisfaction.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Enquêtes de satisfaction.
 *
 * Trois choses se vérifient mal à l'œil et se cassent en silence : le tirage
 * qui ne doit avoir lieu qu'une fois, le jeton qui ne doit servir qu'une fois,
 * et la relance qui ne doit partir qu'une fois.
 */
describe('Enquetes de satisfaction', () => {
  let fixture: Fixture;
  let service: SatisfactionService;

  const ids = { profil: 0, utilisateur: 0, ticket: 0 };
  const publies: PendingEvent[] = [];

  /** Gestionnaires enregistrés par le service sur le bus, par événement. */
  const gestionnaires = new Map<string, (payload: object) => Promise<void>>();

  const dans = async <T>(work: () => Promise<T>): Promise<T> => {
    const path = fixture.paths['racine'] as string;

    return runWithContext(
      {
        sessionId: 'test',
        userId: ids.utilisateur,
        profileId: ids.profil,
        entityId: fixture.entityIds['racine'] as number,
        entityPath: path,
        includeSubEntities: true,
        locale: 'fr',
        profileInterface: 'standard',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  beforeAll(async () => {
    fixture = await createFixture('SAT');

    const db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    const bus = {
      registerCore: (nom: string, handler: (payload: object) => Promise<void>) => {
        gestionnaires.set(nom, handler);
      },
    } as unknown as EventBus;

    service = new SatisfactionService(db, bus);
    service.onApplicationBootstrap();

    // Les evenements publies hors transaction partent par le publieur global :
    // l'intercepter est la facon la plus simple de constater ce qui est emis.
    setEventPublisher(async (evenements) => {
      publies.push(...evenements);

      return Promise.resolve();
    });

    const [profil] = await fixture.owner.db
      .insert(profiles)
      .values({ name: `SAT profil ${String(Date.now())}` })
      .returning({ id: profiles.id });
    ids.profil = (profil as { id: number }).id;

    await fixture.owner.db.insert(profileRights).values(
      (
        [
          ['satisfaction', 'read'],
          ['satisfaction', 'update'],
        ] as const
      ).map(([object, action]) => ({
        profileId: ids.profil,
        object,
        action,
        scope: 'all' as const,
      })),
    );

    const [utilisateur] = await fixture.owner.db
      .insert(users)
      .values({ username: `sat-${String(Date.now())}` })
      .returning({ id: users.id });
    ids.utilisateur = (utilisateur as { id: number }).id;

    const [ticket] = await fixture.owner.db
      .insert(tickets)
      .values({
        entityId: fixture.entityIds['siteA'] as number,
        entityPath: 'temporaire',
        name: 'SAT ticket',
        content: 'Clos, donc candidat a une enquete.',
        status: 'closed',
      })
      .returning({ id: tickets.id });
    ids.ticket = (ticket as { id: number }).id;

    await fixture.owner.db.insert(satisfactionConfigs).values({
      entityId: fixture.entityIds['racine'] as number,
      entityPath: 'temporaire',
      isRecursive: true,
      isActive: true,
      // Cent pour cent : le tirage aleatoire ne doit pas rendre le test
      // intermittent, et ce qui est verifie ici n'est pas le hasard.
      percentage: 100,
      delayDays: 0,
      durationDays: 30,
      reminderDays: 1,
    });
  }, 30_000);

  afterAll(async () => {
    setEventPublisher(undefined);

    const racine = fixture.paths['racine'] as string;

    await fixture.owner.db.execute(
      sql`DELETE FROM satisfactions WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM satisfaction_configs WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM logs WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE id = ${ids.ticket}`);
    await fixture.owner.db.execute(sql`DELETE FROM users WHERE id = ${ids.utilisateur}`);
    await fixture.owner.db.execute(sql`DELETE FROM profiles WHERE id = ${ids.profil}`);
    await fixture.cleanup();
  });

  const declencherCloture = async (): Promise<void> => {
    const handler = gestionnaires.get('ticket.closed');

    if (!handler) throw new Error('Aucun gestionnaire pour ticket.closed.');

    await handler({ id: ids.ticket, entityId: fixture.entityIds['siteA'] as number });
  };

  const enquete = async (): Promise<Record<string, unknown> | undefined> => {
    const resultat = await fixture.owner.db.execute<Record<string, unknown>>(
      sql`SELECT * FROM satisfactions WHERE ticket_id = ${ids.ticket}`,
    );

    return resultat.rows[0];
  };

  it('programme une enquete a la cloture, une seule fois', async () => {
    await declencherCloture();

    const premiere = await enquete();

    expect(premiere).toBeDefined();
    expect(premiere?.['requestedAt'] ?? premiere?.['requested_at']).toBeNull();

    // Une seconde cloture — reouverture puis nouvelle fermeture — ne doit pas
    // produire une deuxieme enquete sur le meme ticket.
    await declencherCloture();

    const compte = await fixture.owner.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM satisfactions WHERE ticket_id = ${ids.ticket}`,
    );

    expect(compte.rows[0]?.total).toBe(1);
  });

  /** Evenements d'enquete concernant **notre** ticket, et eux seuls. */
  const notresEvenements = (): { token: string; url: string }[] =>
    publies
      .filter((publie) => publie.name === 'satisfaction.requested')
      .map((publie) => publie.payload as { id: number; token: string; url: string })
      .filter((charge) => charge.id === ids.ticket);

  it('envoie l’enquete due et publie l’evenement qui porte le lien', async () => {
    publies.length = 0;

    // Le balayage est global : les enquetes d'autres jeux de donnees peuvent
    // partir en meme temps, et l'assertion porte donc sur la notre.
    await service.sweep();

    const [charge] = notresEvenements();

    expect(charge?.token).toBeTruthy();
    // Le lien porte le jeton : c'est ce qui rend l'enquete remplissable sans
    // compte, et ce qu'un modele de notification doit pouvoir citer.
    expect(charge?.url).toContain(charge?.token ?? 'introuvable');

    const ligne = await enquete();

    expect(ligne?.['requestedAt'] ?? ligne?.['requested_at']).not.toBeNull();

    // Le second balayage ne la renvoie pas : l'envoi est marque en base.
    publies.length = 0;
    await service.sweep();

    expect(notresEvenements()).toHaveLength(0);
  });

  it('sert le formulaire public par son jeton, et refuse un jeton inconnu', async () => {
    const ligne = await enquete();
    const token = String(ligne?.['token']);

    const formulaire = await service.byToken(token);

    expect(formulaire.ticketId).toBe(ids.ticket);
    expect(formulaire.answered).toBe(false);

    await expect(service.byToken('jeton-invente')).rejects.toThrow(/introuvable/i);
  });

  it('enregistre une reponse, et n’en accepte qu’une', async () => {
    const ligne = await enquete();
    const token = String(ligne?.['token']);

    await service.answer(token, { rating: 4, comment: 'Rapide et clair.' });

    const apres = await enquete();

    expect(apres?.['rating']).toBe(4);
    expect(apres?.['comment']).toBe('Rapide et clair.');

    // Le jeton circule en clair dans un courriel : le laisser reecrire la note
    // en ferait un droit permanent de corriger une statistique.
    await expect(service.answer(token, { rating: 1, comment: null })).rejects.toThrow(
      /deja repondue|introuvable/i,
    );
  });

  it('compte les enquetes et la note moyenne du perimetre', async () => {
    const stats = await dans(() => service.stats());

    expect(stats.requested).toBe(1);
    expect(stats.answered).toBe(1);
    expect(stats.averageRating).toBe(4);
    expect(stats.distribution).toEqual([{ rating: 4, count: 1 }]);
  });

  it('ne relance pas une enquete deja repondue', async () => {
    // L'enquete a ete envoyee il y a deux jours et repondue : la relance ne
    // doit pas partir, sans quoi le demandeur recevrait un rappel pour un avis
    // qu'il vient de donner.
    await fixture.owner.db.execute(sql`
      UPDATE satisfactions SET requested_at = now() - interval '2 days'
       WHERE ticket_id = ${ids.ticket}
    `);

    publies.length = 0;
    await service.sweep();

    expect(notresEvenements()).toHaveLength(0);

    const ligne = await enquete();

    expect(ligne?.['reminderSentAt'] ?? ligne?.['reminder_sent_at']).toBeNull();
  });

  it('relance une enquete restee sans reponse, une seule fois', async () => {
    await fixture.owner.db.execute(sql`
      UPDATE satisfactions
         SET answered_at = NULL, rating = NULL, comment = NULL,
             requested_at = now() - interval '2 days'
       WHERE ticket_id = ${ids.ticket}
    `);

    publies.length = 0;
    await service.sweep();

    expect(notresEvenements()).toHaveLength(1);

    publies.length = 0;
    await service.sweep();

    expect(notresEvenements()).toHaveLength(0);
  });
});
