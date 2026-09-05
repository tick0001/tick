import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  groupMembers,
  itilActors,
  notificationTemplateTargets,
  notificationTemplateTranslations,
  notificationTemplates,
  sql,
  tickets,
  users,
} from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { MailerService } from '../notifications/mailer.service.js';
import type { EventBus } from '../plugins/event-bus.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Résolution des destinataires d'une notification.
 *
 * Un destinataire est un **rôle**, résolu au moment de l'envoi. Ce test existe
 * parce que l'échec est silencieux : un modèle qui vise un rôle non résolu
 * n'atteint personne, sans erreur ni trace, et la notification manquante ne se
 * remarque que le jour où quelqu'un attendait le courriel.
 */
describe('Destinataires des notifications', () => {
  let fixture: Fixture;

  const enfiles: number[] = [];
  const ids = { demandeur: 0, technicien: 0, membre: 0, auteur: 0, ticket: 0, modele: 0 };

  /**
   * Gestionnaires que le service enregistre au démarrage, par événement.
   *
   * Indexés par nom : le service en pose un par événement, et n'en retenir
   * qu'un ferait silencieusement déclencher le mauvais.
   */
  const gestionnaires = new Map<string, (payload: object) => Promise<void>>();

  beforeAll(async () => {
    fixture = await createFixture('NOTIF');

    const db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    // Bus et messagerie remplacés par des doublures : ce qui est mesuré ici est
    // le contenu de la file, pas l'acheminement SMTP.
    const bus = {
      registerCore: (nom: string, handler: (payload: object) => Promise<void>) => {
        gestionnaires.set(nom, handler);
      },
    } as unknown as EventBus;

    const mailer = {
      enqueue: async (id: number) => {
        enfiles.push(id);

        return Promise.resolve();
      },
    } as unknown as MailerService;

    new NotificationsService(db, bus, mailer).onApplicationBootstrap();

    const creerUtilisateur = async (cle: keyof typeof ids, nom: string): Promise<void> => {
      const [ligne] = await fixture.owner.db
        .insert(users)
        .values({
          username: `notif-${nom}-${String(Date.now())}`,
          email: `${nom}@notifications.test`,
        })
        .returning({ id: users.id });

      ids[cle] = (ligne as { id: number }).id;
    };

    await creerUtilisateur('demandeur', 'demandeur');
    await creerUtilisateur('technicien', 'technicien');
    await creerUtilisateur('membre', 'membre');
    await creerUtilisateur('auteur', 'auteur');

    // Le membre appartient au groupe attribué, sans être acteur du ticket : il
    // ne doit être joint que par le rôle « groupe attribué ».
    await fixture.owner.db.insert(groupMembers).values({
      userId: ids.membre,
      groupId: fixture.groupIds['equipeA'] as number,
    });

    const [ticket] = await fixture.owner.db
      .insert(tickets)
      .values({
        entityId: fixture.entityIds['siteA'] as number,
        entityPath: 'temporaire',
        name: 'NOTIF ticket',
        content: 'Support de test.',
        createdById: ids.auteur,
      })
      .returning({ id: tickets.id });
    ids.ticket = (ticket as { id: number }).id;

    await fixture.owner.db.insert(itilActors).values([
      {
        itilType: 'ticket',
        itilId: ids.ticket,
        role: 'requester',
        actorType: 'user',
        actorId: ids.demandeur,
      },
      {
        itilType: 'ticket',
        itilId: ids.ticket,
        role: 'assigned',
        actorType: 'user',
        actorId: ids.technicien,
      },
      {
        itilType: 'ticket',
        itilId: ids.ticket,
        role: 'assigned',
        actorType: 'group',
        actorId: fixture.groupIds['equipeA'] as number,
      },
    ]);

    const [modele] = await fixture.owner.db
      .insert(notificationTemplates)
      .values({
        entityId: fixture.entityIds['racine'] as number,
        entityPath: 'temporaire',
        isRecursive: true,
        event: 'ticket.escalated',
        name: 'NOTIF escalade',
      })
      .returning({ id: notificationTemplates.id });
    ids.modele = (modele as { id: number }).id;

    await fixture.owner.db.insert(notificationTemplateTranslations).values({
      templateId: ids.modele,
      locale: 'fr',
      subject: 'Escalade #{{ ticket.id }}',
      bodyText: 'Niveau {{ levelName }} de {{ agreementName }} sur {{ ticket.name }}.',
    });
  }, 30_000);

  afterAll(async () => {
    const racine = fixture.paths['racine'] as string;

    await fixture.owner.db.execute(
      sql`DELETE FROM notification_queue WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM notification_templates WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM itil_actors WHERE itil_id = ${ids.ticket}`);
    await fixture.owner.db.execute(sql`DELETE FROM logs WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE id = ${ids.ticket}`);
    await fixture.owner.db.execute(sql`DELETE FROM group_members WHERE user_id = ${ids.membre}`);
    await fixture.owner.db.execute(
      sql`DELETE FROM users WHERE id IN (${ids.demandeur}, ${ids.technicien}, ${ids.membre}, ${ids.auteur})`,
    );
    await fixture.cleanup();
  });

  /** Vide la file et relance l'événement avec les rôles voulus. */
  const envoyer = async (roles: readonly string[]): Promise<string[]> => {
    await fixture.owner.db.execute(
      sql`DELETE FROM notification_queue WHERE item_id = ${ids.ticket}`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM notification_template_targets WHERE template_id = ${ids.modele}`,
    );
    await fixture.owner.db.insert(notificationTemplateTargets).values(
      roles.map((role) => ({
        templateId: ids.modele,
        target: role as 'assigned',
      })),
    );

    const declencher = gestionnaires.get('ticket.escalated');

    if (!declencher) throw new Error('Aucun gestionnaire pour ticket.escalated.');

    await declencher({
      id: ids.ticket,
      entityId: fixture.entityIds['siteA'] as number,
      levelId: 1,
      levelName: 'Rappel',
      agreementName: 'Resolution 4 h',
    });

    const resultat = await fixture.owner.db.execute<{ email: string }>(sql`
      SELECT recipient_email AS email FROM notification_queue
       WHERE item_id = ${ids.ticket} ORDER BY recipient_email
    `);

    return resultat.rows.map((ligne) => ligne.email);
  };

  it('joint les acteurs individuels selon leur role', async () => {
    expect(await envoyer(['requester'])).toEqual(['demandeur@notifications.test']);
    expect(await envoyer(['assigned'])).toEqual(['technicien@notifications.test']);
  });

  it('joint les membres du groupe attribue', async () => {
    // Le membre n'est acteur d'aucun ticket : seul son appartenance au groupe
    // le designe. C'est le destinataire naturel d'une escalade.
    expect(await envoyer(['assigned_group'])).toEqual(['membre@notifications.test']);
  });

  it("joint l'auteur, qui n'est pas forcement le demandeur", async () => {
    expect(await envoyer(['author'])).toEqual(['auteur@notifications.test']);
  });

  it('ne joint chaque personne qu’une fois, quels que soient ses roles', async () => {
    const destinataires = await envoyer(['requester', 'assigned', 'assigned_group', 'author']);

    expect(destinataires).toEqual([
      'auteur@notifications.test',
      'demandeur@notifications.test',
      'membre@notifications.test',
      'technicien@notifications.test',
    ]);
  });

  it('substitue les variables de l’evenement, pas seulement celles du ticket', async () => {
    await envoyer(['assigned']);

    const resultat = await fixture.owner.db.execute<{ subject: string; body: string }>(sql`
      SELECT subject, body_text AS body FROM notification_queue
       WHERE item_id = ${ids.ticket} LIMIT 1
    `);

    expect(resultat.rows[0]?.subject).toBe(`Escalade #${String(ids.ticket)}`);
    // `levelName` et `agreementName` ne viennent pas du ticket : sans exposition
    // de la charge utile, le modele afficherait les marqueurs bruts.
    expect(resultat.rows[0]?.body).toBe('Niveau Rappel de Resolution 4 h sur NOTIF ticket.');
  });

  it('met les messages en file pour envoi', () => {
    expect(enfiles.length).toBeGreaterThan(0);
  });
});
