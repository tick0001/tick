import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationEvent,
  NotificationPreference,
  NotificationQueueEntry,
  NotificationQueueFilter,
  NotificationTemplate,
  UpsertNotificationTemplate,
} from '@tick/contracts';
import {
  notificationTemplateTargets,
  notificationTemplateTranslations,
  notificationTemplates,
  sql,
} from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { translate } from '../search/search-labels.js';
import { MailerService } from './mailer.service.js';
import { NOTIFIABLE_EVENTS, TEMPLATE_VARIABLES } from './notification-events.js';

interface TemplateRow extends Record<string, unknown> {
  id: number;
  event: string;
  name: string;
  isActive: boolean;
  entityId: number;
  isRecursive: boolean;
  targets: unknown;
  translations: unknown;
}

/**
 * Au-delà, une purge devient un verrou long sur la table la plus écrite du
 * module. Plusieurs passes valent mieux qu'une transaction interminable.
 */
const PURGE_MAX = 5000;

/**
 * Configuration des notifications : modèles, file, préférences.
 *
 * Séparé de `NotificationsService`, qui n'a qu'un rôle : réagir aux événements.
 * Mélanger les deux ferait dépendre l'envoi — chemin critique, sans session —
 * du code de configuration, qui lui vit sous Row-Level Security.
 */
@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly mailer: MailerService,
  ) {}

  /** Catalogue des événements notifiables, libellés déjà traduits. */
  events(locale: string): NotificationEvent[] {
    return NOTIFIABLE_EVENTS.map((evenement) => ({
      name: evenement.name,
      label: translate(evenement.labelKey, locale),
    }));
  }

  /** Variables citables dans un modèle, en plus de celles de l'événement. */
  variables(): string[] {
    return [...TEMPLATE_VARIABLES];
  }

  async list(): Promise<NotificationTemplate[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TemplateRow>(sql`
        ${this.selection()} ORDER BY m.event, m.name
      `);

      return resultat.rows;
    });

    return this.nommer(rows);
  }

  async findById(id: number): Promise<NotificationTemplate> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TemplateRow>(sql`${this.selection()} WHERE m.id = ${id}`);

      return resultat.rows;
    });

    const [modele] = await this.nommer(rows);

    if (!modele) throw new NotFoundException('Modele introuvable dans ce perimetre.');

    return modele;
  }

  async save(input: UpsertNotificationTemplate, id?: number): Promise<NotificationTemplate> {
    const fixe = input.targets.find((cible) => cible.target === 'fixed');

    if (fixe && !fixe.address) {
      throw new BadRequestException('Le destinataire « adresse fixe » exige une adresse.');
    }

    const context = requireContext();

    const templateId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        const resultat = await tx.execute(sql`
          UPDATE notification_templates
             SET event = ${input.event}, name = ${input.name}, is_active = ${input.isActive},
                 is_recursive = ${input.isRecursive}, updated_at = now()
           WHERE id = ${cible}
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Modele introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(notificationTemplates)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            event: input.event,
            name: input.name,
            isActive: input.isActive,
            isRecursive: input.isRecursive,
          })
          .returning({ id: notificationTemplates.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      await tx.execute(sql`DELETE FROM notification_template_targets WHERE template_id = ${cible}`);
      await tx.execute(
        sql`DELETE FROM notification_template_translations WHERE template_id = ${cible}`,
      );

      await tx.insert(notificationTemplateTargets).values(
        input.targets.map((entree) => ({
          templateId: cible,
          target: entree.target,
          address: entree.target === 'fixed' ? (entree.address ?? null) : null,
        })),
      );

      await tx.insert(notificationTemplateTranslations).values(
        input.translations.map((traduction) => ({
          templateId: cible,
          locale: traduction.locale,
          subject: traduction.subject,
          bodyText: traduction.bodyText,
          bodyHtml: traduction.bodyHtml ?? null,
        })),
      );

      return cible;
    });

    return this.findById(templateId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(sql`DELETE FROM notification_templates WHERE id = ${id}`);

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Modele introuvable dans ce perimetre.');
      }
    });
  }

  // --- File d'envoi ----------------------------------------------------------

  async queue(filtre: NotificationQueueFilter): Promise<NotificationQueueEntry[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<NotificationQueueEntry & Record<string, unknown>>(sql`
        SELECT id, event, item_type AS "itemType", item_id AS "itemId",
               recipient_email AS "recipientEmail", subject, state::text AS state,
               attempts, last_error AS "lastError",
               created_at AS "createdAt", sent_at AS "sentAt"
          FROM notification_queue
         WHERE 1 = 1
           ${filtre.state ? sql`AND state::text = ${filtre.state}` : sql``}
         ORDER BY id DESC
         LIMIT ${filtre.limit} OFFSET ${filtre.offset}
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      ...row,
      createdAt: toIso(row.createdAt),
      sentAt: row.sentAt === null ? null : toIso(row.sentAt),
    }));
  }

  /**
   * Remet un message en attente et le réinscrit dans la file.
   *
   * Le compteur de tentatives est remis à zéro : le rejeu est une décision
   * humaine prise après correction, pas la suite des essais automatiques, et
   * conserver le compteur ferait échouer immédiatement un message qui avait
   * épuisé ses tentatives.
   */
  async replay(id: number): Promise<void> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ id: number }>(sql`
        UPDATE notification_queue
           SET state = 'pending', attempts = 0, last_error = NULL
         WHERE id = ${id} AND state <> 'sent'
        RETURNING id
      `);

      return resultat.rows;
    });

    if (rows.length === 0) {
      throw new NotFoundException('Message introuvable, ou deja parti.');
    }

    await this.mailer.enqueue(id);
  }

  /**
   * Purge les messages partis depuis plus de `jours`.
   *
   * Seuls les envois réussis : un échec conservé est une question sans réponse
   * qu'on voudra reposer, et le supprimer effacerait la trace du problème.
   */
  async purge(jours: number): Promise<number> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute(sql`
        DELETE FROM notification_queue
         WHERE id IN (
           SELECT id FROM notification_queue
            WHERE state = 'sent' AND sent_at < now() - make_interval(days => ${jours})
            LIMIT ${PURGE_MAX}
         )
      `);

      return resultat.rowCount ?? 0;
    });
  }

  // --- Préférences -----------------------------------------------------------

  /**
   * Préférences de l'utilisateur courant, une ligne par événement notifiable.
   *
   * L'absence de ligne vaut « activé » : exiger un enregistrement pour chaque
   * événement obligerait à en créer à la volée pour chaque nouveau compte, et à
   * les rattraper à chaque événement ajouté.
   */
  async preferences(locale: string): Promise<NotificationPreference[]> {
    const context = requireContext();

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ event: string; enabled: boolean }>(
        sql`SELECT event, enabled FROM notification_preferences WHERE user_id = ${context.userId}`,
      );

      return resultat.rows;
    });

    const desactives = new Map(rows.map((row) => [row.event, row.enabled]));

    return NOTIFIABLE_EVENTS.map((evenement) => ({
      event: evenement.name,
      label: translate(evenement.labelKey, locale),
      enabled: desactives.get(evenement.name) ?? true,
    }));
  }

  async setPreference(event: string, enabled: boolean): Promise<void> {
    const context = requireContext();

    await this.db.asUser((tx) =>
      tx.execute(sql`
        INSERT INTO notification_preferences (user_id, event, enabled)
        VALUES (${context.userId}, ${event}, ${enabled})
        ON CONFLICT (user_id, event) DO UPDATE SET enabled = EXCLUDED.enabled
      `),
    );
  }

  private selection() {
    return sql`
      SELECT m.id, m.event, m.name, m.is_active AS "isActive",
             m.entity_id AS "entityId", m.is_recursive AS "isRecursive",
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'target', c.target::text, 'address', c.address) ORDER BY c.target)
                  FROM notification_template_targets c WHERE c.template_id = m.id),
               '[]'::jsonb) AS targets,
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'locale', t.locale, 'subject', t.subject,
                         'bodyText', t.body_text, 'bodyHtml', t.body_html) ORDER BY t.locale)
                  FROM notification_template_translations t WHERE t.template_id = m.id),
               '[]'::jsonb) AS translations
        FROM notification_templates m
    `;
  }

  /** Le nom de l'entite est resolu a part : voir `entityNames`. */
  private async nommer(rows: readonly TemplateRow[]): Promise<NotificationTemplate[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => ({
      id: row.id,
      event: row.event,
      name: row.name,
      isActive: row.isActive,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      targets: Array.isArray(row.targets) ? (row.targets as NotificationTemplate['targets']) : [],
      translations: Array.isArray(row.translations)
        ? (row.translations as NotificationTemplate['translations'])
        : [],
    }));
  }
}

/** Les horodatages du SQL brut arrivent en chaine : voir `SlaService`. */
function toIso(valeur: unknown): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(String(valeur)).toISOString();
}
