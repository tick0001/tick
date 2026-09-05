import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { notificationQueue, sql, type SQL } from '@tick/db';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { EventBus } from '../plugins/event-bus.service.js';
import { MailerService } from './mailer.service.js';
import { toText } from '../tickets/ticket-sql.js';

interface Destinataire {
  userId: number | null;
  email: string;
  locale: string;
}

interface ModeleRendu {
  templateId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  targets: string[];
}

/**
 * Notifications élémentaires.
 *
 * Trois principes qui ne changeront pas quand le module s'étoffera au jalon J5 :
 *
 *  - les destinataires sont des **rôles** résolus au moment de l'envoi, jamais
 *    des adresses figées : « le demandeur » désigne quelqu'un de différent d'un
 *    ticket à l'autre ;
 *  - la file est en base, pas seulement en mémoire : on doit pouvoir répondre à
 *    « ce message est-il parti, et sinon pourquoi » des semaines plus tard ;
 *  - l'écriture métier ne dépend jamais de l'envoi : une panne de messagerie
 *    ne doit pas empêcher de résoudre un ticket.
 */
@Injectable()
export class NotificationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly events: EventBus,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap(): void {
    for (const evenement of [
      'ticket.created',
      'ticket.statusChanged',
      'ticket.solved',
      'ticket.escalated',
      'followup.added',
    ] as const) {
      this.events.registerCore(evenement, async (payload) => {
        await this.handle(evenement, payload);
      });
    }
  }

  /**
   * Traite un événement : trouve les modèles applicables, résout les
   * destinataires, met en file.
   *
   * Toute erreur est journalisée sans être propagée : un défaut de notification
   * ne doit pas faire échouer le traitement de l'événement, ni provoquer des
   * réessais qui produiraient des doublons.
   */
  private async handle(evenement: string, payload: object): Promise<void> {
    try {
      const donnees = payload as Record<string, unknown>;
      const ticketId = Number(donnees['id'] ?? donnees['ticketId'] ?? 0);

      if (!ticketId) return;

      const ticket = await this.chargerTicket(ticketId);

      if (!ticket) return;

      const modeles = await this.modelesFor(evenement, ticket.entityId);

      for (const modele of modeles) {
        const destinataires = await this.destinatairesFor(ticketId, modele.targets);

        for (const destinataire of destinataires) {
          await this.enfiler(evenement, ticket, modele, destinataire, donnees);
        }
      }
    } catch (erreur) {
      this.logger.error(`Notification ${evenement} impossible : ${String(erreur)}`);
    }
  }

  private async chargerTicket(
    id: number,
  ): Promise<{ id: number; name: string; status: string; entityId: number } | null> {
    const lignes = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<
        {
          id: number;
          name: string;
          status: string;
          entityId: number;
        } & Record<string, unknown>
      >(sql`
        SELECT id, name, status::text AS status, entity_id AS "entityId"
          FROM tickets WHERE id = ${id} AND deleted_at IS NULL
      `);

      return resultat.rows;
    });

    return lignes[0] ?? null;
  }

  /**
   * Modèles applicables à une entité.
   *
   * La visibilité suit la règle de configuration — l'entité elle-même, ou un
   * ancêtre marqué récursif — mais est résolue avec le rôle propriétaire :
   * l'envoi a lieu hors de toute session, il n'y a pas de contexte à invoquer.
   */
  private async modelesFor(evenement: string, entityId: number): Promise<ModeleRendu[]> {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<ModeleRendu & Record<string, unknown>>(sql`
        SELECT m.id AS "templateId", t.subject, t.body_text AS "bodyText",
               t.body_html AS "bodyHtml",
               coalesce(array_agg(c.target::text) FILTER (WHERE c.target IS NOT NULL), '{}')
                 AS "targets"
          FROM notification_templates m
          JOIN entities cible ON cible.id = ${entityId}
          JOIN entities origine ON origine.id = m.entity_id
          JOIN notification_template_translations t ON t.template_id = m.id
          LEFT JOIN notification_template_targets c ON c.template_id = m.id
         WHERE m.event = ${evenement}
           AND m.is_active
           AND t.locale = 'fr'
           AND (origine.path = cible.path OR (m.is_recursive AND origine.path @> cible.path))
         GROUP BY m.id, t.subject, t.body_text, t.body_html
      `);

      return resultat.rows;
    });
  }

  /** Résout les rôles en adresses, en écartant les comptes sans adresse. */
  private async destinatairesFor(
    ticketId: number,
    roles: readonly string[],
  ): Promise<Destinataire[]> {
    if (roles.length === 0) return [];

    const roleActeurs = roles.filter((role) =>
      ['requester', 'observer', 'assigned'].includes(role),
    );
    const sources: SQL[] = [];

    if (roleActeurs.length > 0) {
      sources.push(sql`
        SELECT a.actor_id AS id
          FROM itil_actors a
         WHERE a.itil_type = 'ticket' AND a.itil_id = ${ticketId}
           AND a.actor_type = 'user'
           AND a.role::text IN (${sql.join(
             roleActeurs.map((role) => sql`${role}`),
             sql`, `,
           )})
      `);
    }

    // Un groupe attribue designe des personnes, pas une adresse : c'est le
    // destinataire naturel d'une escalade, et l'omettre ferait qu'un modele
    // visant le groupe n'atteindrait silencieusement personne.
    if (roles.includes('assigned_group')) {
      sources.push(sql`
        SELECT m.user_id AS id
          FROM itil_actors a
          JOIN group_members m ON m.group_id = a.actor_id
         WHERE a.itil_type = 'ticket' AND a.itil_id = ${ticketId}
           AND a.actor_type = 'group' AND a.role = 'assigned'
      `);
    }

    // L'auteur n'est pas toujours le demandeur : un technicien qui saisit un
    // ticket pour quelqu'un d'autre veut suivre ce qu'il a ouvert.
    if (roles.includes('author')) {
      sources.push(sql`SELECT t.created_by_id AS id FROM tickets t WHERE t.id = ${ticketId}`);
    }

    if (sources.length === 0) return [];

    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<Destinataire & Record<string, unknown>>(sql`
        SELECT DISTINCT u.id AS "userId", u.email::text AS email,
               coalesce(u.locale, 'fr') AS locale
          FROM (${sql.join(sources, sql` UNION `)}) AS cibles
          JOIN users u ON u.id = cibles.id
         WHERE u.email IS NOT NULL
           AND u.is_active
           AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM notification_preferences p
              WHERE p.user_id = u.id AND p.enabled = false
           )
      `);

      return resultat.rows;
    });
  }

  private async enfiler(
    evenement: string,
    ticket: { id: number; name: string; status: string; entityId: number },
    modele: ModeleRendu,
    destinataire: Destinataire,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // La charge utile de l'evenement est exposee telle quelle, en plus des
    // variables du ticket. Enumerer chaque champ a la main obligerait a revenir
    // ici a chaque nouvel evenement, et un modele ne pourrait jamais citer ce
    // que l'evenement est seul a savoir — le niveau d'escalade franchi, par
    // exemple. Seules les valeurs simples passent : un objet imbrique n'a pas
    // de representation textuelle utile dans un courriel.
    const variables: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(payload)
          .filter(
            ([, valeur]) =>
              typeof valeur === 'string' ||
              typeof valeur === 'number' ||
              typeof valeur === 'boolean',
          )
          .map(([cle, valeur]) => [cle, toText(valeur)]),
      ),
      'ticket.id': String(ticket.id),
      'ticket.name': ticket.name,
      'ticket.status': ticket.status,
      'ticket.url': `${loadEnv().WEB_URL}/tickets/${String(ticket.id)}`,
      evenement: evenement,
    };

    const [ligne] = await this.db.asOwner((tx) =>
      tx
        .insert(notificationQueue)
        .values({
          entityId: ticket.entityId,
          entityPath: null,
          event: evenement,
          itemType: 'ticket',
          itemId: ticket.id,
          recipientEmail: destinataire.email,
          recipientUserId: destinataire.userId,
          locale: destinataire.locale,
          subject: rendre(modele.subject, variables),
          bodyText: rendre(modele.bodyText, variables),
          bodyHtml: modele.bodyHtml ? rendre(modele.bodyHtml, variables) : null,
        })
        .returning({ id: notificationQueue.id }),
    );

    if (ligne) await this.mailer.enqueue(ligne.id);
  }
}

/**
 * Substitution de variables `{{ nom }}`.
 *
 * Volontairement minimale : ni condition ni boucle. Un modèle de notification
 * qui contient de la logique devient impossible à relire pour la personne qui
 * l'écrit, et c'est rarement un développeur.
 */
export function rendre(modele: string, variables: Record<string, string>): string {
  return modele.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (correspondance, cle: string) =>
    cle in variables ? (variables[cle] ?? '') : correspondance,
  );
}
