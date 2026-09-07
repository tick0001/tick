import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { documentItems, documents, sql } from '@tick/db';
import { appRoot, loadEnv } from '../config/env.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { nomAffiche } from '../common/sql.js';

/** Taille maximale d'une pièce jointe. */
export const MAX_SIZE = 25 * 1024 * 1024;

/**
 * Types acceptés.
 *
 * Liste blanche plutôt que liste noire : une liste noire laisse toujours passer
 * ce qu'on n'a pas anticipé, et une pièce jointe est servie telle quelle au
 * navigateur d'un collègue.
 */
const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

/**
 * Fichier recu, tel que l'intercepteur multipart le fournit.
 *
 * Declare ici plutot que via le type ambiant `Express.Multer.File` : celui-ci
 * impose de charger une declaration globale dans toute la compilation, alors
 * que quatre proprietes suffisent.
 */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredDocument {
  id: number;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadedBy: string | null;
}

@Injectable()
export class DocumentsService {
  /** Racine de stockage, résolue comme les autres chemins de l'application. */
  private get root(): string {
    const configure = loadEnv().STORAGE_PATH;

    return isAbsolute(configure) ? configure : resolve(appRoot(), configure);
  }

  constructor(private readonly db: DatabaseService) {}

  /**
   * Enregistre un fichier et le rattache à un objet.
   *
   * Le contenu est adressé par son empreinte : deux envois du même fichier ne
   * l'écrivent qu'une fois sur le disque, et l'empreinte permet de vérifier
   * l'intégrité sans relire l'original.
   */
  async upload(
    fichier: UploadedFileLike,
    lien: { itemType: string; itemId: number },
  ): Promise<StoredDocument> {
    if (fichier.size > MAX_SIZE) {
      throw new BadRequestException(
        `Fichier trop volumineux : ${String(Math.round(fichier.size / 1024))} Ko pour un maximum de ${String(MAX_SIZE / 1024 / 1024)} Mo.`,
      );
    }

    if (!ALLOWED.has(fichier.mimetype)) {
      throw new BadRequestException(`Type de fichier non accepte : ${fichier.mimetype}.`);
    }

    // L'entite vient de l'objet auquel la piece est rattachee, jamais de
    // l'entite active de l'expediteur : sinon un administrateur travaillant a
    // la racine deposerait des pieces invisibles des techniciens du site, sur
    // leurs propres tickets.
    const entityId = await this.entityOf(lien.itemType, lien.itemId);
    const context = requireContext();
    const empreinte = createHash('sha256').update(fichier.buffer).digest('hex');
    const chemin = this.pathFor(empreinte);

    await mkdir(join(this.root, empreinte.slice(0, 2)), { recursive: true });
    await writeFile(chemin, fichier.buffer);

    const id = await this.db.asUser(async (tx) => {
      const [ligne] = await tx
        .insert(documents)
        .values({
          entityId,
          entityPath: 'temporaire',
          // Le nom d'origine n'est jamais utilise comme chemin : il sert
          // uniquement d'etiquette et de nom propose au telechargement.
          name: fichier.originalname.slice(0, 255),
          mimeType: fichier.mimetype,
          size: fichier.size,
          checksum: empreinte,
          uploadedById: context.userId,
        })
        .returning({ id: documents.id });

      if (!ligne) throw new BadRequestException('Enregistrement impossible dans ce perimetre.');

      await tx
        .insert(documentItems)
        .values({ documentId: ligne.id, itemType: lien.itemType, itemId: lien.itemId })
        .onConflictDoNothing();

      return ligne.id;
    });

    const liste = await this.listFor(lien.itemType, lien.itemId);
    const trouve = liste.find((document) => document.id === id);

    if (!trouve) throw new NotFoundException('Document introuvable apres enregistrement.');

    return trouve;
  }

  async listFor(itemType: string, itemId: number): Promise<StoredDocument[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<StoredDocument & Record<string, unknown>>(sql`
        SELECT d.id, d.name, d.mime_type AS "mimeType", d.size,
               d.created_at AS "createdAt",
               ${nomAffiche()} AS "uploadedBy"
          FROM documents d
          JOIN document_items l ON l.document_id = d.id
          LEFT JOIN users u ON u.id = d.uploaded_by_id
         WHERE l.item_type = ${itemType} AND l.item_id = ${itemId}
           AND d.deleted_at IS NULL
         ORDER BY d.created_at
      `);

      return resultat.rows.map((ligne) => ({
        ...ligne,
        size: Number(ligne.size),
        createdAt: new Date(String(ligne.createdAt)).toISOString(),
      }));
    });
  }

  /**
   * Lit un document.
   *
   * L'accès passe par la base, donc par le Row-Level Security : un identifiant
   * deviné ne suffit pas, et le contenu n'est jamais servi depuis un chemin
   * statique.
   */
  async read(id: number): Promise<{ document: StoredDocument; contenu: Buffer }> {
    const [ligne] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<
        StoredDocument & { checksum: string } & Record<string, unknown>
      >(sql`
        SELECT d.id, d.name, d.mime_type AS "mimeType", d.size, d.checksum,
               d.created_at AS "createdAt", NULL::text AS "uploadedBy"
          FROM documents d
         WHERE d.id = ${id} AND d.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    if (!ligne) throw new NotFoundException('Document introuvable dans ce perimetre.');

    try {
      const contenu = await readFile(this.pathFor(ligne.checksum));

      return {
        document: {
          ...ligne,
          size: Number(ligne.size),
          createdAt: new Date(String(ligne.createdAt)).toISOString(),
        },
        contenu,
      };
    } catch {
      throw new NotFoundException('Contenu du document introuvable sur le stockage.');
    }
  }

  /**
   * Suppression logique.
   *
   * Le fichier reste sur le disque : une autre pièce jointe peut partager la
   * même empreinte, et le purger ici la casserait. Le ramassage des contenus
   * orphelins est une tâche planifiée distincte.
   */
  async remove(id: number): Promise<void> {
    await this.db.asUser((tx) =>
      tx.execute(sql`UPDATE documents SET deleted_at = now() WHERE id = ${id}`),
    );
  }

  /**
   * Entite de l'objet porteur.
   *
   * Un type inconnu retombe sur l'entite active : c'est le comportement le plus
   * restrictif possible, et il ne devient un probleme que le jour ou un
   * nouveau type d'objet oublie de s'enregistrer ici.
   */
  private async entityOf(itemType: string, itemId: number): Promise<number> {
    if (itemType !== 'ticket') return requireContext().entityId;

    const [ligne] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ entityId: number } & Record<string, unknown>>(
        sql`SELECT entity_id AS "entityId" FROM tickets WHERE id = ${itemId} AND deleted_at IS NULL`,
      );

      return resultat.rows;
    });

    if (!ligne) throw new NotFoundException('Objet introuvable dans ce perimetre.');

    return ligne.entityId;
  }

  private pathFor(empreinte: string): string {
    return join(this.root, empreinte.slice(0, 2), empreinte);
  }
}
