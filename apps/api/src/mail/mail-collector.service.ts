import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DEFAULT_LOCALE } from '@tick/contracts';
import { sql } from '@tick/db';
import { Queue, Worker } from 'bullmq';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { loadEnv } from '../config/env.js';
import { runWithContext } from '../common/request-context.js';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { TimelineService } from '../tickets/timeline.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import {
  bareAddress,
  citedMessageIds,
  isAutoReply,
  isFromSelf,
  stripQuotedReply,
  ticketFromSubject,
  type IncomingMail,
} from './mail-message.js';

export const MAIL_COLLECT_QUEUE = 'tick.mail.collect';

/**
 * Période de relève.
 *
 * Deux minutes : au-delà, un demandeur qui écrit puis regarde l'interface ne
 * trouve pas son ticket et en ouvre un second. En deçà, on interroge une boîte
 * distante pour rien la plupart du temps.
 */
const PERIODE_MS = 120_000;

/** Un corps de courriel plus long que cela est une pièce jointe déguisée. */
const MAX_CORPS = 60_000;

interface Collecteur {
  id: number;
  entityId: number;
  entityPath: string;
  profileId: number;
  name: string;
  host: string;
  port: number;
  useTls: boolean;
  login: string;
  passwordEncrypted: string | null;
  folder: string;
  afterRead: 'delete' | 'flag' | 'move';
  targetFolder: string | null;
  requestSourceId: number | null;
  createUnknownRequester: boolean;
  maxPerRun: number;
}

type Action = 'ticket' | 'followup' | 'ignored' | 'refused' | 'error';

interface Decision {
  action: Action;
  ticketId: number | null;
  detail: string | null;
  /** Ce qui identifie le message, pour que le journal serve a quelque chose. */
  messageId: string | null;
  sender: string | null;
  subject: string | null;
}

/**
 * Collecteur de courriel entrant.
 *
 * Le message crée un ticket, ou complète celui qu'il cite. Le rattachement se
 * fait d'abord par les en-têtes `In-Reply-To` et `References`, ensuite seulement
 * par le marqueur du sujet : le premier survit à une traduction ou à une
 * réécriture du sujet, le second survit à un client de messagerie négligent.
 *
 * Le traitement passe par les services applicatifs sous un contexte reconstitué
 * — l'expéditeur, le profil déclaré par le collecteur, l'entité de la boîte —
 * et non par des écritures directes : un ticket né d'un courriel doit recevoir
 * ses règles, ses engagements et son historique comme n'importe quel autre.
 */
@Injectable()
export class MailCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailCollectorService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly secrets: SecretsService,
    private readonly tickets: TicketsService,
    private readonly timeline: TimelineService,
    private readonly documents: DocumentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();

    if (!env.RUN_EVENT_WORKER) return;

    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(MAIL_COLLECT_QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    });

    await this.queue.upsertJobScheduler(
      'releve',
      { every: PERIODE_MS },
      { name: 'collecte', data: {} },
    );

    this.worker = new Worker(
      MAIL_COLLECT_QUEUE,
      async () => {
        await this.sweep();
      },
      { connection },
    );

    this.worker.on('error', (erreur) => {
      this.logger.error(`File de collecte : ${erreur.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Relève toutes les boîtes actives. */
  async sweep(): Promise<number> {
    const collecteurs = await this.charger(null);
    let total = 0;

    for (const collecteur of collecteurs) {
      total += await this.collect(collecteur);
    }

    return total;
  }

  /**
   * Relève une boîte nommément, active ou non.
   *
   * Le contrôle de visibilité appartient à l'appelant : une relève à la demande
   * suit une vérification sous Row-Level Security, elle ne la remplace pas.
   */
  async collectOne(id: number): Promise<number> {
    const [collecteur] = await this.charger(id);

    return collecteur ? this.collect(collecteur) : 0;
  }

  private async charger(id: number | null): Promise<Collecteur[]> {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<Collecteur & Record<string, unknown>>(sql`
        SELECT id, entity_id AS "entityId", entity_path::text AS "entityPath",
               profile_id AS "profileId", name, host, port, use_tls AS "useTls", login,
               password_encrypted AS "passwordEncrypted", folder,
               after_read::text AS "afterRead", target_folder AS "targetFolder",
               request_source_id AS "requestSourceId",
               create_unknown_requester AS "createUnknownRequester",
               max_per_run AS "maxPerRun"
          FROM mail_collectors
         WHERE ${id === null ? sql`is_active` : sql`id = ${id}`}
      `);

      return resultat.rows;
    });
  }

  /**
   * Relève une boîte.
   *
   * Un échec de connexion est enregistré sur le collecteur et n'interrompt pas
   * les autres : une boîte injoignable ne doit pas priver l'organisation de
   * celles qui répondent.
   */
  private async collect(collecteur: Collecteur): Promise<number> {
    const client = new ImapFlow({
      host: collecteur.host,
      port: collecteur.port,
      secure: collecteur.useTls,
      auth: {
        user: collecteur.login,
        pass: collecteur.passwordEncrypted
          ? this.secrets.decrypt(collecteur.passwordEncrypted)
          : '',
      },
      logger: false,
    });

    let traites = 0;

    try {
      await client.connect();

      const verrou = await client.getMailboxLock(collecteur.folder);

      try {
        // Les messages non lus seulement : c'est la marque que le collecteur
        // pose lui-meme, et elle survit a un redemarrage la ou un curseur en
        // memoire ferait tout relire.
        const numeros = await client.search({ seen: false }, { uid: true });
        const lot = (numeros === false ? [] : numeros).slice(0, collecteur.maxPerRun);

        for (const uid of lot) {
          const message = await client.fetchOne(String(uid), { source: true }, { uid: true });

          if (message === false || !message.source) continue;

          const analyse = await simpleParser(message.source);

          // Le journal sert aussi de garde-fou : si le classement du message a
          // echoue au cycle precedent, il est revenu non lu, et le retraiter
          // creerait un second ticket pour le meme courriel.
          if (analyse.messageId && (await this.dejaTraite(collecteur.id, analyse.messageId))) {
            await this.classer(client, collecteur, uid);
            continue;
          }

          const decision = await this.traiter(collecteur, analyse);

          await this.journaliser(collecteur, decision);
          await this.classer(client, collecteur, uid);
          traites += 1;
        }
      } finally {
        verrou.release();
      }

      await this.marquerReleve(collecteur.id, null);
    } catch (erreur) {
      this.logger.error(`Releve de « ${collecteur.name} » impossible : ${String(erreur)}`);
      await this.marquerReleve(collecteur.id, String(erreur));
    } finally {
      await client.logout().catch(() => undefined);
    }

    return traites;
  }

  /** Marque, déplace ou supprime le message selon le réglage du collecteur. */
  private async classer(client: ImapFlow, collecteur: Collecteur, uid: number): Promise<void> {
    const cible = { uid: true } as const;

    if (collecteur.afterRead === 'delete') {
      await client.messageDelete(String(uid), cible);

      return;
    }

    await client.messageFlagsAdd(String(uid), ['\\Seen'], cible);

    if (collecteur.afterRead === 'move' && collecteur.targetFolder) {
      await client.messageMove(String(uid), collecteur.targetFolder, cible);
    }
  }

  /**
   * Décide du sort d'un message, et l'applique.
   *
   * L'ordre des refus n'est pas indifférent : la boucle d'abord, parce qu'un
   * message que nous avons nous-mêmes émis ne doit jamais rien déclencher, puis
   * la réponse automatique, puis l'expéditeur inconnu.
   */
  private async traiter(collecteur: Collecteur, brutMessage: ParsedMail): Promise<Decision> {
    const mail = versIncomingMail(brutMessage);
    const env = loadEnv();
    const identite = {
      messageId: mail.messageId,
      sender: mail.from,
      subject: mail.subject || null,
    };

    if (isFromSelf(mail, [env.SMTP_FROM, collecteur.login])) {
      return {
        ...identite,
        action: 'ignored',
        ticketId: null,
        detail: 'message emis par nous-memes',
      };
    }

    if (isAutoReply(mail)) {
      return { ...identite, action: 'ignored', ticketId: null, detail: 'reponse automatique' };
    }

    const adresse = bareAddress(mail.from);

    if (!adresse) {
      return { ...identite, action: 'refused', ticketId: null, detail: 'expediteur illisible' };
    }

    const demandeur = await this.demandeur(collecteur, adresse, mail);

    if (!demandeur) {
      return {
        ...identite,
        action: 'refused',
        ticketId: null,
        detail: `expediteur inconnu : ${adresse}`,
      };
    }

    const corps = stripQuotedReply(mail.text).slice(0, MAX_CORPS) || '(message vide)';
    const cible = await this.ticketCite(collecteur, mail);

    try {
      return await this.dansLeContexte(collecteur, demandeur, async () => {
        if (cible) {
          await this.timeline.addFollowup(cible, {
            content: corps,
            isPrivate: false,
            source: 'email',
          });

          // Rattachee au ticket, et non au suivi : c'est la que l'interface
          // les montre, et un fichier reste utile quand on relit le dossier
          // sans se souvenir de quel message il venait.
          await this.attacher(mail, 'ticket', cible);

          return { ...identite, action: 'followup' as const, ticketId: cible, detail: null };
        }

        const ticket = await this.tickets.create({
          name: (mail.subject || '(sans objet)').slice(0, 255),
          content: corps,
          type: 'incident',
          urgency: 3,
          impact: 3,
          requestSourceId: collecteur.requestSourceId ?? undefined,
          actors: [{ role: 'requester', actorType: 'user', actorId: demandeur.id }],
        });

        await this.attacher(mail, 'ticket', ticket.id);

        return { ...identite, action: 'ticket' as const, ticketId: ticket.id, detail: null };
      });
    } catch (erreur) {
      // Un message qui echoue est journalise et marque lu : le laisser non lu
      // le ferait retenter a chaque cycle, indefiniment et sans progres.
      this.logger.error(`Message « ${mail.subject} » non traite : ${String(erreur)}`);

      return { ...identite, action: 'error', ticketId: null, detail: String(erreur) };
    }
  }

  /**
   * Exécute le travail sous un contexte reconstitué.
   *
   * Le périmètre est **exactement** l'entité de la boîte, jamais sa descendance :
   * un courriel adressé au support du siège ne doit pas pouvoir compléter le
   * ticket d'une filiale au motif que le sujet en citait le numéro.
   */
  private async dansLeContexte<T>(
    collecteur: Collecteur,
    demandeur: { id: number; locale: string },
    work: () => Promise<T>,
  ): Promise<T> {
    return runWithContext(
      {
        sessionId: 'mail',
        userId: demandeur.id,
        profileId: collecteur.profileId,
        entityId: collecteur.entityId,
        entityPath: collecteur.entityPath,
        includeSubEntities: false,
        locale: demandeur.locale,
        scope: { subtreePaths: [], exactPaths: [collecteur.entityPath] },
      },
      work,
    );
  }

  /** Compte de l'expéditeur, éventuellement créé si le collecteur l'autorise. */
  private async demandeur(
    collecteur: Collecteur,
    adresse: string,
    mail: IncomingMail,
  ): Promise<{ id: number; locale: string } | null> {
    const existants = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: number; locale: string | null }>(sql`
        SELECT id, locale FROM users
         WHERE email = ${adresse}::citext AND is_active AND deleted_at IS NULL
         LIMIT 1
      `);

      return resultat.rows;
    });

    const existant = existants[0];

    if (existant) return { id: existant.id, locale: existant.locale ?? DEFAULT_LOCALE };

    if (!collecteur.createUnknownRequester) return null;

    const nom = brut(mail.from) ?? adresse;

    const crees = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: number }>(sql`
        INSERT INTO users (username, email, first_name, auth_source)
        VALUES (${adresse}, ${adresse}::citext, ${nom.slice(0, 120)}, 'local')
        ON CONFLICT (username) DO NOTHING
        RETURNING id
      `);

      return resultat.rows;
    });

    const cree = crees[0];

    if (!cree) return null;

    this.logger.log(`Compte cree depuis un courriel : ${adresse}`);

    return { id: cree.id, locale: DEFAULT_LOCALE };
  }

  /**
   * Ticket cité par le message, s'il est ouvert et dans le périmètre du collecteur.
   *
   * Un ticket clos ne reçoit pas de suivi : la réponse ouvre alors un ticket
   * neuf. Greffer une demande sur un dossier fermé la rendrait invisible de la
   * file de travail, ce qui est la pire des deux issues.
   */
  private async ticketCite(collecteur: Collecteur, mail: IncomingMail): Promise<number | null> {
    const cites = citedMessageIds(mail);
    const parEnTete = cites.length === 0 ? null : await this.ticketDuMessage(cites);
    const candidat = parEnTete ?? ticketFromSubject(mail.subject);

    if (!candidat) return null;

    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: number }>(sql`
        SELECT id FROM tickets
         WHERE id = ${candidat}
           AND deleted_at IS NULL
           AND status <> 'closed'
           AND entity_id = ${collecteur.entityId}
      `);

      return resultat.rows;
    });

    return rows[0]?.id ?? null;
  }

  private async ticketDuMessage(cites: readonly string[]): Promise<number | null> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ itemId: number }>(sql`
        SELECT item_id AS "itemId" FROM notification_queue
         WHERE item_type = 'ticket'
           AND message_id IN (${sql.join(
             cites.map((identifiant) => sql`${identifiant}`),
             sql`, `,
           )})
         ORDER BY id DESC LIMIT 1
      `);

      return resultat.rows;
    });

    return rows[0]?.itemId ?? null;
  }

  /**
   * Enregistre les pièces jointes.
   *
   * Un fichier refusé — trop gros, type non accepté — ne fait pas échouer le
   * message : le texte a plus de valeur que la pièce, et perdre les deux serait
   * pire que d'en perdre une.
   */
  private async attacher(mail: IncomingMail, itemType: string, itemId: number): Promise<void> {
    for (const piece of mail.attachments) {
      try {
        await this.documents.upload(
          {
            buffer: piece.content,
            originalname: piece.filename,
            mimetype: piece.contentType,
            size: piece.content.length,
          },
          { itemType, itemId },
        );
      } catch (erreur) {
        this.logger.warn(`Piece jointe « ${piece.filename} » ignoree : ${String(erreur)}`);
      }
    }
  }

  /** Vrai si ce message a deja laisse une trace pour ce collecteur. */
  private async dejaTraite(collectorId: number, messageId: string): Promise<boolean> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: number }>(sql`
        SELECT id FROM mail_collector_logs
         WHERE collector_id = ${collectorId} AND message_id = ${messageId}
         LIMIT 1
      `);

      return resultat.rows;
    });

    return rows.length > 0;
  }

  private async journaliser(collecteur: Collecteur, decision: Decision): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.execute(sql`
        INSERT INTO mail_collector_logs
          (collector_id, entity_id, entity_path, message_id, sender, subject,
           action, ticket_id, detail)
        VALUES (${collecteur.id}, ${collecteur.entityId}, ${collecteur.entityPath}::ltree,
                ${decision.messageId}, ${decision.sender}, ${decision.subject},
                ${decision.action}::mail_action, ${decision.ticketId}, ${decision.detail})
      `),
    );
  }

  private async marquerReleve(id: number, erreur: string | null): Promise<void> {
    await this.db.asOwner((tx) =>
      tx.execute(sql`
        UPDATE mail_collectors SET last_run_at = now(), last_error = ${erreur} WHERE id = ${id}
      `),
    );
  }
}

/** Nom affiché de l'expéditeur, sans son adresse. */
function brut(from: string | null): string | null {
  if (!from) return null;

  const nom = from.split('<')[0]?.trim().replaceAll('"', '');

  return nom && nom.length > 0 ? nom : null;
}

/** Traduit la sortie de `mailparser` vers la forme que le module manipule. */
function versIncomingMail(brutMessage: ParsedMail): IncomingMail {
  const entetes: Record<string, string> = {};

  for (const [cle, valeur] of brutMessage.headers) {
    entetes[cle.toLowerCase()] = typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
  }

  const references = brutMessage.references;

  return {
    messageId: brutMessage.messageId ?? null,
    from: brutMessage.from?.text ?? null,
    subject: brutMessage.subject ?? '',
    text: brutMessage.text ?? '',
    html: typeof brutMessage.html === 'string' ? brutMessage.html : null,
    inReplyTo: brutMessage.inReplyTo ?? null,
    references: typeof references === 'string' ? [references] : (references ?? []),
    headers: entetes,
    attachments: brutMessage.attachments.map((piece) => ({
      filename: piece.filename ?? 'piece-jointe',
      contentType: piece.contentType,
      content: piece.content,
    })),
  };
}
