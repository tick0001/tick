import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MailCollector, MailCollectorLog, UpsertMailCollector } from '@tick/contracts';
import { mailCollectors, sql } from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';

interface CollectorRow extends Record<string, unknown> {
  id: number;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  login: string;
  folder: string;
  afterRead: MailCollector['afterRead'];
  targetFolder: string | null;
  isActive: boolean;
  entityId: number;
  profileId: number;
  requestSourceId: number | null;
  createUnknownRequester: boolean;
  maxPerRun: number;
  lastRunAt: unknown;
  lastError: string | null;
  hasPassword: boolean;
}

/**
 * Configuration des boîtes relevées.
 *
 * Le mot de passe ne ressort jamais : l'écran affiche seulement qu'il existe.
 * Le renvoyer, même à un administrateur, en ferait une donnée qui circule à
 * chaque affichage de la page.
 */
@Injectable()
export class MailCollectorsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly secrets: SecretsService,
  ) {}

  async list(): Promise<MailCollector[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<CollectorRow>(sql`${this.selection()} ORDER BY name`);

      return resultat.rows;
    });

    return this.nommer(rows);
  }

  async findById(id: number): Promise<MailCollector> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<CollectorRow>(sql`${this.selection()} WHERE c.id = ${id}`);

      return resultat.rows;
    });

    const [collecteur] = await this.nommer(rows);

    if (!collecteur) throw new NotFoundException('Collecteur introuvable dans ce perimetre.');

    return collecteur;
  }

  async save(input: UpsertMailCollector, id?: number): Promise<MailCollector> {
    if (input.afterRead === 'move' && !input.targetFolder) {
      throw new BadRequestException('Deplacer un message exige un dossier de destination.');
    }

    if (!id && !input.password) {
      throw new BadRequestException('Un mot de passe est requis a la creation.');
    }

    const context = requireContext();
    const chiffre = input.password ? this.secrets.encrypt(input.password) : null;

    const collectorId = await this.db.asUser(async (tx) => {
      if (id) {
        const resultat = await tx.execute(sql`
          UPDATE mail_collectors
             SET name = ${input.name}, host = ${input.host}, port = ${input.port},
                 use_tls = ${input.useTls}, login = ${input.login},
                 folder = ${input.folder}, after_read = ${input.afterRead}::mail_after_read,
                 target_folder = ${input.targetFolder ?? null},
                 is_active = ${input.isActive}, profile_id = ${input.profileId},
                 request_source_id = ${input.requestSourceId ?? null},
                 create_unknown_requester = ${input.createUnknownRequester},
                 max_per_run = ${input.maxPerRun},
                 -- Un mot de passe absent conserve celui deja enregistre.
                 password_encrypted = COALESCE(${chiffre}, password_encrypted),
                 updated_at = now()
           WHERE id = ${id}
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Collecteur introuvable dans ce perimetre.');
        }

        return id;
      }

      const [ligne] = await tx
        .insert(mailCollectors)
        .values({
          entityId: context.entityId,
          entityPath: 'temporaire',
          name: input.name,
          host: input.host,
          port: input.port,
          useTls: input.useTls,
          login: input.login,
          passwordEncrypted: chiffre,
          folder: input.folder,
          afterRead: input.afterRead,
          targetFolder: input.targetFolder ?? null,
          isActive: input.isActive,
          profileId: input.profileId,
          requestSourceId: input.requestSourceId ?? null,
          createUnknownRequester: input.createUnknownRequester,
          maxPerRun: input.maxPerRun,
        })
        .returning({ id: mailCollectors.id });

      if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');

      return ligne.id;
    });

    return this.findById(collectorId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(sql`DELETE FROM mail_collectors WHERE id = ${id}`);

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Collecteur introuvable dans ce perimetre.');
      }
    });
  }

  /** Journal de relève, du plus récent au plus ancien. */
  async logs(collectorId: number, limit = 50): Promise<MailCollectorLog[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<MailCollectorLog & Record<string, unknown>>(sql`
        SELECT id, collector_id AS "collectorId", message_id AS "messageId", sender, subject,
               action::text AS action, ticket_id AS "ticketId", detail,
               created_at AS "createdAt"
          FROM mail_collector_logs
         WHERE collector_id = ${collectorId}
         ORDER BY id DESC
         LIMIT ${limit}
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({ ...row, createdAt: toIso(row.createdAt) }));
  }

  private selection() {
    return sql`
      SELECT c.id, c.name, c.host, c.port, c.use_tls AS "useTls", c.login, c.folder,
             c.after_read::text AS "afterRead", c.target_folder AS "targetFolder",
             c.is_active AS "isActive", c.entity_id AS "entityId", c.profile_id AS "profileId",
             c.request_source_id AS "requestSourceId",
             c.create_unknown_requester AS "createUnknownRequester",
             c.max_per_run AS "maxPerRun", c.last_run_at AS "lastRunAt",
             c.last_error AS "lastError",
             (c.password_encrypted IS NOT NULL) AS "hasPassword"
        FROM mail_collectors c
    `;
  }

  /** Le nom de l'entite est resolu a part : voir `entityNames`. */
  private async nommer(rows: readonly CollectorRow[]): Promise<MailCollector[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      host: row.host,
      port: row.port,
      useTls: row.useTls,
      login: row.login,
      folder: row.folder,
      afterRead: row.afterRead,
      targetFolder: row.targetFolder,
      isActive: row.isActive,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      profileId: row.profileId,
      requestSourceId: row.requestSourceId,
      createUnknownRequester: row.createUnknownRequester,
      maxPerRun: row.maxPerRun,
      lastRunAt: row.lastRunAt === null ? null : toIso(row.lastRunAt),
      lastError: row.lastError,
      hasPassword: row.hasPassword,
    }));
  }
}

/** Les horodatages du SQL brut arrivent en chaine : voir `SlaService`. */
function toIso(valeur: unknown): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(String(valeur)).toISOString();
}
