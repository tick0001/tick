import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DEFAULT_LOCALE } from '@tick/contracts';
import { notificationQueue, sql, type SQL } from '@tick/db';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { EventBus } from '../plugins/event-bus.service.js';
import { toText } from '../tickets/ticket-sql.js';
import { MailerService } from './mailer.service.js';
import { NOTIFIABLE_EVENTS, ROLES_INTERNES } from './notification-events.js';

interface Destinataire {
  userId: number | null;
  email: string;
  locale: string;
}

interface Traduction {
  locale: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}

interface Cible {
  target: string;
  address: string | null;
}

interface Modele {
  templateId: number;
  translations: Traduction[];
  targets: Cible[];
}

interface TicketNotifie {
  id: number;
  name: string;
  status: string;
  entityId: number;
}

/**
 * Notifications.
 *
 * Trois principes :
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
    for (const { name } of NOTIFIABLE_EVENTS) {
      this.events.registerCore(name, async (payload) => {
        await this.handle(name, payload);
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
        const destinataires = await this.destinatairesFor(
          ticketId,
          evenement,
          this.ciblesRetenues(modele.targets, donnees),
          donnees,
        );

        for (const destinataire of destinataires) {
          await this.enfiler(evenement, ticket, modele, destinataire, donnees);
        }
      }
    } catch (erreur) {
      this.logger.error(`Notification ${evenement} impossible : ${String(erreur)}`);
    }
  }

  /**
   * Restreint les rôles quand l'objet à l'origine de l'événement est privé.
   *
   * Un suivi privé est invisible du demandeur dans l'interface ; le notifier
   * par courriel reviendrait à contourner ce que l'interface protège.
   */
  private ciblesRetenues(cibles: readonly Cible[], payload: Record<string, unknown>): Cible[] {
    if (payload['isPrivate'] !== true) return [...cibles];

    return cibles.filter((cible) => ROLES_INTERNES.includes(cible.target));
  }

  private async chargerTicket(id: number): Promise<TicketNotifie | null> {
    const lignes = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<TicketNotifie & Record<string, unknown>>(sql`
        SELECT id, name, status::text AS status, entity_id AS "entityId"
          FROM tickets WHERE id = ${id} AND deleted_at IS NULL
      `);

      return resultat.rows;
    });

    return lignes[0] ?? null;
  }

  /**
   * Modèles applicables à une entité, avec toutes leurs traductions.
   *
   * La visibilité suit la règle de configuration — l'entité elle-même, ou un
   * ancêtre marqué récursif — mais est résolue avec le rôle propriétaire :
   * l'envoi a lieu hors de toute session, il n'y a pas de contexte à invoquer.
   *
   * Toutes les traductions sont chargées, et non celle d'une langue choisie
   * d'avance : le destinataire n'est connu qu'après, et deux destinataires du
   * même message peuvent ne pas lire la même langue.
   */
  private async modelesFor(evenement: string, entityId: number): Promise<Modele[]> {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<Modele & Record<string, unknown>>(sql`
        SELECT m.id AS "templateId",
               COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object(
                           'locale', t.locale, 'subject', t.subject,
                           'bodyText', t.body_text, 'bodyHtml', t.body_html))
                    FROM notification_template_translations t WHERE t.template_id = m.id),
                 '[]'::jsonb) AS translations,
               COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object(
                           'target', c.target::text, 'address', c.address))
                    FROM notification_template_targets c WHERE c.template_id = m.id),
                 '[]'::jsonb) AS targets
          FROM notification_templates m
          JOIN entities cible ON cible.id = ${entityId}
          JOIN entities origine ON origine.id = m.entity_id
         WHERE m.event = ${evenement}
           AND m.is_active
           AND (origine.path = cible.path OR (m.is_recursive AND origine.path @> cible.path))
      `);

      return resultat.rows.filter((modele) => modele.translations.length > 0);
    });
  }

  /**
   * Traduction à servir à un destinataire.
   *
   * Repli sur la langue par défaut plutôt que silence : recevoir un message
   * dans la mauvaise langue reste préférable à ne rien recevoir du tout.
   */
  private traductionPour(modele: Modele, locale: string): Traduction | undefined {
    return (
      modele.translations.find((traduction) => traduction.locale === locale) ??
      modele.translations.find((traduction) => traduction.locale === DEFAULT_LOCALE) ??
      modele.translations[0]
    );
  }

  /** Résout les rôles en adresses, en écartant les comptes sans adresse. */
  private async destinatairesFor(
    ticketId: number,
    evenement: string,
    cibles: readonly Cible[],
    payload: Record<string, unknown>,
  ): Promise<Destinataire[]> {
    const roles = cibles.map((cible) => cible.target);
    const sources: SQL[] = [];

    const roleActeurs = roles.filter((role) =>
      ['requester', 'observer', 'assigned'].includes(role),
    );

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

    // Un groupe designe des personnes, pas une adresse : c'est le destinataire
    // naturel d'une escalade, et l'omettre ferait qu'un modele visant le groupe
    // n'atteindrait silencieusement personne.
    for (const [role, roleActeur, managerOnly] of [
      ['assigned_group', 'assigned', false],
      ['assigned_group_manager', 'assigned', true],
      ['requester_group', 'requester', false],
      ['requester_group_manager', 'requester', true],
    ] as const) {
      if (!roles.includes(role)) continue;

      sources.push(sql`
        SELECT m.user_id AS id
          FROM itil_actors a
          JOIN group_members m ON m.group_id = a.actor_id
         WHERE a.itil_type = 'ticket' AND a.itil_id = ${ticketId}
           AND a.actor_type = 'group' AND a.role::text = ${roleActeur}
           ${managerOnly ? sql`AND m.is_manager` : sql``}
      `);
    }

    // L'auteur n'est pas toujours le demandeur : un technicien qui saisit un
    // ticket pour quelqu'un d'autre veut suivre ce qu'il a ouvert.
    if (roles.includes('author')) {
      sources.push(sql`SELECT t.created_by_id AS id FROM tickets t WHERE t.id = ${ticketId}`);
    }

    // L'auteur du suivi vient de l'evenement, pas du ticket : c'est la seule
    // facon de distinguer « celui qui vient d'ecrire » de « celui qui a ouvert ».
    const auteurEvenement = Number(payload['authorId'] ?? 0);

    if (roles.includes('followup_author') && auteurEvenement > 0) {
      sources.push(sql`SELECT ${auteurEvenement}::bigint AS id`);
    }

    const destinataires: Destinataire[] = [];

    if (sources.length > 0) {
      const rows = await this.db.asOwner(async (tx) => {
        const resultat = await tx.execute<Destinataire & Record<string, unknown>>(sql`
          SELECT DISTINCT u.id AS "userId", u.email::text AS email,
                 coalesce(u.locale, ${DEFAULT_LOCALE}) AS locale
            FROM (${sql.join(sources, sql` UNION `)}) AS cibles
            JOIN users u ON u.id = cibles.id
           WHERE u.email IS NOT NULL
             AND u.is_active
             AND u.deleted_at IS NULL
             -- La preference porte sur **cet** evenement : la lire sans le
             -- filtrer couperait toutes les notifications d'un utilisateur des
             -- qu'il en desactive une.
             AND NOT EXISTS (
               SELECT 1 FROM notification_preferences p
                WHERE p.user_id = u.id AND p.event = ${evenement} AND p.enabled = false
             )
        `);

        return resultat.rows;
      });

      destinataires.push(...rows);
    }

    for (const cible of cibles) {
      if (cible.target !== 'fixed' || !cible.address) continue;

      destinataires.push({ userId: null, email: cible.address, locale: DEFAULT_LOCALE });
    }

    return destinataires;
  }

  private async enfiler(
    evenement: string,
    ticket: TicketNotifie,
    modele: Modele,
    destinataire: Destinataire,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const traduction = this.traductionPour(modele, destinataire.locale);

    if (!traduction) return;

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
          locale: traduction.locale,
          subject: rendre(traduction.subject, variables),
          bodyText: rendre(traduction.bodyText, variables),
          bodyHtml: traduction.bodyHtml ? rendre(traduction.bodyHtml, variables) : null,
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
