import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';

/**
 * Perimetre de visibilite d'un utilisateur, deduit de ses habilitations.
 *
 * Deux listes distinctes, parce que l'habilitation porte un drapeau « recursif » :
 * une habilitation recursive rend visible tout le sous-arbre, une habilitation
 * simple ne rend visible que l'entite elle-meme.
 */
export interface EntityScope {
  /** Chemins dont toute la descendance est visible. */
  subtreePaths: string[];
  /** Chemins visibles exactement, sans leur descendance. */
  exactPaths: string[];
}

/**
 * Contexte de travail d'une requete. Il n'est jamais passe en argument aux
 * requetes metier : il est injecte dans la transaction PostgreSQL, et c'est lui
 * qui alimente les politiques de Row-Level Security.
 */
export interface RequestContext {
  userId: number;
  profileId: number;
  /** Entite active : celle ou l'on cree, et celle qui resout la configuration. */
  entityPath: string;
  scope: EntityScope;
}

const LTREE_LABEL = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

/**
 * Assemble un litteral de tableau PostgreSQL.
 *
 * Les chemins sont valides avant d'etre concatenes : ils transitent par
 * `set_config` en parametre lie, mais une valeur malformee produirait une
 * erreur de cast difficile a diagnostiquer plus loin dans la politique.
 */
export function toLtreeArrayLiteral(paths: readonly string[]): string {
  for (const path of paths) {
    if (!LTREE_LABEL.test(path)) {
      throw new Error(`Chemin d'entite invalide : ${path}`);
    }
  }

  return `{${paths.join(',')}}`;
}

/**
 * Ouvre une transaction portant le contexte, puis execute le travail demande.
 *
 * `set_config(..., true)` limite la portee des parametres a la transaction :
 * une connexion rendue au pool ne conserve aucun contexte residuel, ce qui
 * eliminerait sinon toute garantie d'isolation.
 */
export async function withRequestContext<T>(
  db: Database,
  context: RequestContext,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT
        set_config('tick.user_id', ${String(context.userId)}, true),
        set_config('tick.profile_id', ${String(context.profileId)}, true),
        set_config('tick.entity_path', ${context.entityPath}, true),
        set_config('tick.scope_paths', ${toLtreeArrayLiteral(context.scope.subtreePaths)}, true),
        set_config('tick.exact_paths', ${toLtreeArrayLiteral(context.scope.exactPaths)}, true)
    `);

    return work(tx);
  });
}
