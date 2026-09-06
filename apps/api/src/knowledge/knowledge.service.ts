import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  KbArticle,
  KbArticleSummary,
  KbCategory,
  KbQuery,
  KbRevision,
  PublicArticle,
  PublicArticleSummary,
  UpsertKbArticle,
  UpsertKbCategory,
} from '@tick/contracts';
import { kbArticleTargets, kbArticles, kbCategories, sql, type SQL } from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';

interface ArticleRow extends Record<string, unknown> {
  id: number;
  name: string;
  content: string;
  categoryId: number | null;
  categoryName: string | null;
  isFaq: boolean;
  isPublished: boolean;
  viewCount: number;
  version: number;
  entityId: number;
  isRecursive: boolean;
  isFavorite: boolean;
  author: string | null;
  updatedAt: unknown;
  targets: unknown;
}

/** Longueur de l'extrait affiché dans une liste. */
const EXTRAIT = 240;

/**
 * Base de connaissances.
 *
 * Deux niveaux de visibilité se superposent, et il est important de ne pas les
 * confondre :
 *
 *  - l'**entité**, tranchée par le Row-Level Security comme pour toute
 *    configuration — un article écrit à la racine et marqué récursif descend
 *    dans toute l'arborescence ;
 *  - le **ciblage fin** — profil, groupe, utilisateur — résolu ici, dans la
 *    requête. Il dépend des groupes de la personne connectée, que la session ne
 *    porte pas : le déporter dans une politique SQL exigerait de les y injecter,
 *    donc de les recalculer à chaque requête.
 */
@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DatabaseService) {}

  // --- Catégories ------------------------------------------------------------

  async categories(): Promise<KbCategory[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<KbCategory & Record<string, unknown>>(sql`
        SELECT id, parent_id AS "parentId", name, complete_name AS "completeName",
               path::text AS path, nlevel(path) - 1 AS level
          FROM kb_categories WHERE deleted_at IS NULL
         ORDER BY path
      `);

      return resultat.rows;
    });
  }

  async saveCategory(input: UpsertKbCategory, id?: number): Promise<KbCategory> {
    const context = requireContext();

    const categoryId = await this.db.asUser(async (tx) => {
      if (id) {
        const resultat = await tx.execute(sql`
          UPDATE kb_categories
             SET parent_id = ${input.parentId ?? null}, name = ${input.name},
                 comment = ${input.comment ?? null}, is_recursive = ${input.isRecursive},
                 updated_at = now()
           WHERE id = ${id} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Categorie introuvable dans ce perimetre.');
        }

        return id;
      }

      const [ligne] = await tx
        .insert(kbCategories)
        .values({
          entityId: context.entityId,
          entityPath: 'temporaire',
          isRecursive: input.isRecursive,
          parentId: input.parentId ?? null,
          // Chemin et nom complet sont poses par le declencheur, comme pour
          // tout referentiel arborescent.
          path: 'temporaire',
          name: input.name,
          completeName: input.name,
          comment: input.comment ?? null,
        })
        .returning({ id: kbCategories.id });

      if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');

      return ligne.id;
    });

    const trouvee = (await this.categories()).find((categorie) => categorie.id === categoryId);

    if (!trouvee) throw new NotFoundException('Categorie introuvable apres enregistrement.');

    return trouvee;
  }

  async removeCategory(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE kb_categories SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Categorie introuvable dans ce perimetre.');
      }
    });
  }

  // --- Articles --------------------------------------------------------------

  /**
   * Liste filtrée.
   *
   * La recherche plein texte porte sur la colonne générée : le titre pèse plus
   * que le corps, et le classement suit la pertinence plutôt que la date. Sans
   * recherche, l'ordre est celui de la dernière mise à jour — ce que l'on veut
   * quand on parcourt.
   */
  async list(filtre: KbQuery): Promise<KbArticleSummary[]> {
    const recherche = filtre.search?.trim();

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<ArticleRow>(sql`
        ${this.selection()}
         WHERE a.deleted_at IS NULL
           AND ${this.visibilityCondition()}
           ${filtre.faqOnly ? sql`AND a.is_faq` : sql``}
           ${filtre.favoritesOnly ? sql`AND f.user_id IS NOT NULL` : sql``}
           ${filtre.categoryId ? sql`AND a.category_id = ${filtre.categoryId}` : sql``}
           ${
             recherche ? sql`AND a.search_vector @@ plainto_tsquery('french', ${recherche})` : sql``
           }
         ORDER BY ${
           recherche
             ? sql`ts_rank(a.search_vector, plainto_tsquery('french', ${recherche})) DESC`
             : sql`a.updated_at DESC`
         }
         LIMIT ${filtre.limit}
      `);

      return resultat.rows;
    });

    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => {
      // Ni le contenu entier ni les cibles dans une liste : le premier alourdit
      // la reponse, les secondes ne servent qu'a l'ecran d'edition.
      const { content, targets: _cibles, ...reste } = this.toArticle(row, noms);

      return { ...reste, excerpt: extrait(content) };
    });
  }

  async findById(id: number): Promise<KbArticle> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<ArticleRow>(sql`
        ${this.selection()}
         WHERE a.id = ${id} AND a.deleted_at IS NULL AND ${this.visibilityCondition()}
      `);

      return resultat.rows;
    });

    const row = rows[0];

    if (!row) throw new NotFoundException('Article introuvable ou hors de votre perimetre.');

    const noms = await entityNames(this.db, [row.entityId]);

    return this.toArticle(row, noms);
  }

  /**
   * Consultation : incrémente le compteur.
   *
   * Séparé de la lecture pour que l'affichage d'une liste, d'un aperçu ou d'une
   * relecture par l'auteur ne gonfle pas un chiffre censé mesurer l'usage réel.
   */
  async read(id: number): Promise<KbArticle> {
    const article = await this.findById(id);

    await this.db.asUser((tx) =>
      tx.execute(sql`UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ${id}`),
    );

    return { ...article, viewCount: article.viewCount + 1 };
  }

  async save(input: UpsertKbArticle, id?: number): Promise<KbArticle> {
    const context = requireContext();

    const articleId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        // La revision garde l'etat **precedent** : c'est ce qui permet de
        // repondre a « que disait cet article avant cette modification ».
        await tx.execute(sql`
          INSERT INTO kb_article_revisions (article_id, version, name, content, author_id)
          SELECT id, version, name, content, updated_by_id
            FROM kb_articles WHERE id = ${cible}
          ON CONFLICT DO NOTHING
        `);

        const resultat = await tx.execute(sql`
          UPDATE kb_articles
             SET name = ${input.name}, content = ${input.content},
                 category_id = ${input.categoryId ?? null}, is_faq = ${input.isFaq},
                 is_published = ${input.isPublished}, is_recursive = ${input.isRecursive},
                 version = version + 1, updated_by_id = ${context.userId}, updated_at = now()
           WHERE id = ${cible} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Article introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(kbArticles)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            isRecursive: input.isRecursive,
            categoryId: input.categoryId ?? null,
            name: input.name,
            content: input.content,
            isFaq: input.isFaq,
            isPublished: input.isPublished,
            authorId: context.userId,
            updatedById: context.userId,
          })
          .returning({ id: kbArticles.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      await tx.execute(sql`DELETE FROM kb_article_targets WHERE article_id = ${cible}`);

      if (input.targets.length > 0) {
        await tx.insert(kbArticleTargets).values(
          input.targets.map((cibleVisibilite) => ({
            articleId: cible,
            targetType: cibleVisibilite.targetType,
            targetId: cibleVisibilite.targetId,
          })),
        );
      }

      return cible;
    });

    return this.findById(articleId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE kb_articles SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Article introuvable dans ce perimetre.');
      }
    });
  }

  async revisions(id: number): Promise<KbRevision[]> {
    // La visibilite de l'article conditionne celle de son historique.
    await this.findById(id);

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<KbRevision & Record<string, unknown>>(sql`
        SELECT r.version, r.name, r.content,
               coalesce(u.first_name || ' ' || u.last_name, u.username) AS author,
               r.created_at AS "createdAt"
          FROM kb_article_revisions r
          LEFT JOIN users u ON u.id = r.author_id
         WHERE r.article_id = ${id}
         ORDER BY r.version DESC
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({ ...row, createdAt: toIso(row.createdAt) }));
  }

  async toggleFavorite(id: number): Promise<boolean> {
    const context = requireContext();

    await this.findById(id);

    return this.db.asUser(async (tx) => {
      const retire = await tx.execute(
        sql`DELETE FROM kb_favorites WHERE user_id = ${context.userId} AND article_id = ${id}`,
      );

      if ((retire.rowCount ?? 0) > 0) return false;

      await tx.execute(
        sql`INSERT INTO kb_favorites (user_id, article_id) VALUES (${context.userId}, ${id})`,
      );

      return true;
    });
  }

  // --- FAQ publique ----------------------------------------------------------

  /**
   * Articles publiés dans la FAQ, sans authentification.
   *
   * Lus avec le rôle propriétaire, et restreints à `is_faq` **et**
   * `is_published`. Le drapeau est la décision de publication : aucune autre
   * règle de visibilité ne s'applique, parce qu'il n'y a personne dont on
   * pourrait vérifier le profil ou l'entité.
   */
  async publicList(recherche?: string): Promise<PublicArticleSummary[]> {
    const motif = recherche?.trim();

    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<PublicArticle & Record<string, unknown>>(sql`
        SELECT a.id, a.name, a.content, c.complete_name AS "categoryName",
               a.updated_at AS "updatedAt"
          FROM kb_articles a
          LEFT JOIN kb_categories c ON c.id = a.category_id
         WHERE a.deleted_at IS NULL AND a.is_faq AND a.is_published
           ${motif ? sql`AND a.search_vector @@ plainto_tsquery('french', ${motif})` : sql``}
         ORDER BY ${
           motif
             ? sql`ts_rank(a.search_vector, plainto_tsquery('french', ${motif})) DESC`
             : sql`a.updated_at DESC`
         }
         LIMIT 50
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      categoryName: row.categoryName,
      updatedAt: toIso(row.updatedAt),
      excerpt: extrait(row.content),
    }));
  }

  async publicArticle(id: number): Promise<PublicArticle> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<PublicArticle & Record<string, unknown>>(sql`
        SELECT a.id, a.name, a.content, c.complete_name AS "categoryName",
               a.updated_at AS "updatedAt"
          FROM kb_articles a
          LEFT JOIN kb_categories c ON c.id = a.category_id
         WHERE a.id = ${id} AND a.deleted_at IS NULL AND a.is_faq AND a.is_published
      `);

      return resultat.rows;
    });

    const article = rows[0];

    if (!article) throw new NotFoundException('Article introuvable.');

    await this.db.asOwner((tx) =>
      tx.execute(sql`UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ${id}`),
    );

    return { ...article, updatedAt: toIso(article.updatedAt) };
  }

  // --- Interne ---------------------------------------------------------------

  private selection() {
    const context = requireContext();

    return sql`
      SELECT a.id, a.name, a.content, a.category_id AS "categoryId",
             c.complete_name AS "categoryName", a.is_faq AS "isFaq",
             a.is_published AS "isPublished", a.view_count AS "viewCount", a.version,
             a.entity_id AS "entityId", a.is_recursive AS "isRecursive",
             (f.user_id IS NOT NULL) AS "isFavorite",
             coalesce(auteur.first_name || ' ' || auteur.last_name, auteur.username) AS author,
             a.updated_at AS "updatedAt",
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'targetType', t.target_type::text, 'targetId', t.target_id))
                  FROM kb_article_targets t WHERE t.article_id = a.id),
               '[]'::jsonb) AS targets
        FROM kb_articles a
        LEFT JOIN kb_categories c ON c.id = a.category_id
        LEFT JOIN users auteur ON auteur.id = a.author_id
        LEFT JOIN kb_favorites f ON f.article_id = a.id AND f.user_id = ${context.userId}
    `;
  }

  /**
   * Condition de ciblage fin, en plus de celle du Row-Level Security.
   *
   * Un article sans cible est visible de tous ; sinon il faut correspondre à au
   * moins une — le profil actif, un groupe dont on est membre, ou soi-même. Un
   * brouillon n'est visible que de son auteur.
   */
  private visibilityCondition(): SQL {
    const context = requireContext();

    return sql`
      (a.is_published OR a.author_id = ${context.userId})
      AND (
        NOT EXISTS (SELECT 1 FROM kb_article_targets t WHERE t.article_id = a.id)
        OR EXISTS (
          SELECT 1 FROM kb_article_targets t
           WHERE t.article_id = a.id
             AND (
               (t.target_type = 'profile' AND t.target_id = ${context.profileId})
               OR (t.target_type = 'user' AND t.target_id = ${context.userId})
               OR (t.target_type = 'group' AND EXISTS (
                     SELECT 1 FROM group_members m
                      WHERE m.group_id = t.target_id AND m.user_id = ${context.userId}))
             )
        )
      )
    `;
  }

  private toArticle(row: ArticleRow, noms: Map<number, string>): KbArticle {
    return {
      id: row.id,
      name: row.name,
      content: row.content,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      isFaq: row.isFaq,
      isPublished: row.isPublished,
      viewCount: row.viewCount,
      version: row.version,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      isFavorite: row.isFavorite,
      author: row.author,
      updatedAt: toIso(row.updatedAt),
      targets: Array.isArray(row.targets) ? (row.targets as KbArticle['targets']) : [],
    };
  }
}

/** Extrait lisible, coupé sur un mot entier. */
function extrait(contenu: string): string {
  const propre = contenu.replaceAll(/\s+/g, ' ').trim();

  if (propre.length <= EXTRAIT) return propre;

  const coupe = propre.slice(0, EXTRAIT);

  return `${coupe.slice(0, coupe.lastIndexOf(' '))}…`;
}

/** Les horodatages du SQL brut arrivent en chaine : voir `SlaService`. */
function toIso(valeur: unknown): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(String(valeur)).toISOString();
}
