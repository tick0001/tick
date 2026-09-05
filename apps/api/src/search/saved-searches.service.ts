import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { searchNodeSchema, type SavedSearch, type SaveSearch } from '@tick/contracts';
import { savedSearches, sql } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { SearchCompiler } from './search-compiler.service.js';

interface Row extends Record<string, unknown> {
  id: number;
  name: string;
  target: string;
  isPublic: boolean;
  isPinned: boolean;
  userId: number;
  criteria: unknown;
  owner: string | null;
}

/**
 * Recherches sauvegardées.
 *
 * La visibilité est portée par le Row-Level Security : une recherche est
 * visible de son auteur, ou de tous si elle est publique, et toujours dans le
 * périmètre. Le service n'a donc pas à refiltrer — sauf pour l'écriture, où
 * partager une recherche ne donne pas le droit de la modifier.
 */
@Injectable()
export class SavedSearchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly compiler: SearchCompiler,
  ) {}

  async list(target = 'ticket'): Promise<SavedSearch[]> {
    const context = requireContext();

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Row>(sql`
        SELECT r.id, r.name, r.target, r.is_public AS "isPublic", r.is_pinned AS "isPinned",
               r.user_id AS "userId", r.criteria,
               coalesce(
                 nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                 u.username::text
               ) AS owner
          FROM saved_searches r
          LEFT JOIN users u ON u.id = r.user_id
         WHERE r.target = ${target}
         ORDER BY r.is_pinned DESC, r.name
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      target: row.target,
      isPublic: row.isPublic,
      isPinned: row.isPinned,
      isMine: row.userId === context.userId,
      criteria: searchNodeSchema.parse(row.criteria),
      owner: row.owner ?? '',
    }));
  }

  async findById(id: number): Promise<SavedSearch> {
    const trouvee = (await this.list()).find((recherche) => recherche.id === id);

    if (!trouvee) throw new NotFoundException('Recherche introuvable.');

    return trouvee;
  }

  async save(input: SaveSearch, id?: number): Promise<SavedSearch> {
    const context = requireContext();

    // Compilée à l'enregistrement, et pas seulement à l'exécution : une
    // recherche invalide échouerait sinon chez celui qui l'ouvre, longtemps
    // après, sans que son auteur l'apprenne.
    this.compiler.compile(input.criteria);

    if (id) {
      const existante = await this.findById(id);

      if (!existante.isMine) {
        throw new ForbiddenException("Seul l'auteur peut modifier une recherche partagée.");
      }
    }

    const enregistree = await this.db.asUser(async (tx) => {
      if (id) {
        await tx.execute(sql`
          UPDATE saved_searches
             SET name = ${input.name}, is_public = ${input.isPublic},
                 is_pinned = ${input.isPinned},
                 criteria = ${JSON.stringify(input.criteria)}::jsonb,
                 updated_at = now()
           WHERE id = ${id}
        `);

        return id;
      }

      const [ligne] = await tx
        .insert(savedSearches)
        .values({
          entityId: context.entityId,
          entityPath: 'temporaire',
          userId: context.userId,
          name: input.name,
          target: input.target,
          isPublic: input.isPublic,
          isPinned: input.isPinned,
          criteria: input.criteria,
        })
        .returning({ id: savedSearches.id });

      if (!ligne) throw new NotFoundException('Enregistrement impossible dans ce perimetre.');

      return ligne.id;
    });

    return this.findById(enregistree);
  }

  async remove(id: number): Promise<void> {
    const existante = await this.findById(id);

    if (!existante.isMine) {
      throw new ForbiddenException("Seul l'auteur peut supprimer une recherche partagée.");
    }

    await this.db.asUser((tx) => tx.execute(sql`DELETE FROM saved_searches WHERE id = ${id}`));
  }
}
