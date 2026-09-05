import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Rule,
  RuleCollection,
  RuleField,
  SimulationResult,
  UpsertRule,
} from '@tick/contracts';
import { ruleActions, ruleCriteria, rules, sql } from '@tick/db';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { translate } from '../search/search-labels.js';
import { RuleCatalogService } from './rule-catalog.service.js';
import { RuleEngineService, type EngineResult, type EngineRule } from './rule-engine.service.js';

interface RuleRow extends Record<string, unknown> {
  id: number;
  collection: RuleCollection;
  name: string;
  description: string | null;
  ranking: number;
  isActive: boolean;
  matchAll: boolean;
  stopAfter: boolean;
  entityId: number;
  isRecursive: boolean;
  criteria: unknown;
  actions: unknown;
}

/**
 * Écart de rang laissé entre deux règles voisines.
 *
 * Réordonner par pas de dix permet d'intercaler une règle sans réécrire toute
 * la collection ; la renumérotation complète reste possible mais devient un
 * geste explicite plutôt qu'un effet de bord de chaque ajout.
 */
const PAS_DE_RANG = 10;

/**
 * Collections dont les règles s'évaluent indépendamment les unes des autres.
 *
 * Une affectation d'habilitation n'est pas une transformation successive d'un
 * objet : chaque règle qui correspond ajoute un droit, elle n'en corrige pas un
 * précédent.
 */
const SANS_CHAINAGE: readonly RuleCollection[] = ['authorization.assign', 'entity.assign'];

@Injectable()
export class RulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: RuleCatalogService,
    private readonly engine: RuleEngineService,
  ) {}

  /** Catalogue traduit, tel que l'éditeur de règles le consomme. */
  fields(collection: RuleCollection, locale: string): RuleField[] {
    return this.catalog.list(collection).map((definition) => ({
      key: definition.key,
      label: translate(definition.labelKey, locale),
      type: definition.type,
      operators: [...definition.operators],
      actions: [...definition.actions],
      options: definition.options?.map((option) => ({
        value: option.value,
        label: translate(option.labelKey, locale),
      })),
    }));
  }

  async list(collection?: RuleCollection): Promise<Rule[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<RuleRow>(sql`
        ${this.selection()}
         WHERE r.deleted_at IS NULL
           ${collection ? sql`AND r.collection = ${collection}` : sql``}
         ORDER BY r.collection, r.ranking, r.id
      `);

      return resultat.rows;
    });

    return this.nommer(rows);
  }

  async findById(id: number): Promise<Rule> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<RuleRow>(sql`
        ${this.selection()} WHERE r.id = ${id} AND r.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const [regle] = await this.nommer(rows);

    if (!regle) throw new NotFoundException('Regle introuvable dans ce perimetre.');

    return regle;
  }

  async save(input: UpsertRule, id?: number): Promise<Rule> {
    this.assertValid(input);

    const context = requireContext();

    const ruleId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        const resultat = await tx.execute(sql`
          UPDATE rules
             SET name = ${input.name}, description = ${input.description ?? null},
                 collection = ${input.collection}, ranking = ${input.ranking},
                 is_active = ${input.isActive}, match_all = ${input.matchAll},
                 stop_after = ${input.stopAfter}, is_recursive = ${input.isRecursive},
                 updated_at = now()
           WHERE id = ${cible} AND deleted_at IS NULL
        `);

        if (resultat.rowCount === 0) {
          throw new NotFoundException('Regle introuvable dans ce perimetre.');
        }
      } else {
        const [ligne] = await tx
          .insert(rules)
          .values({
            entityId: context.entityId,
            // Le declencheur remplace ce marqueur par le chemin reel de
            // l'entite : le chemin n'est jamais fourni par l'appelant.
            entityPath: 'temporaire',
            collection: input.collection,
            name: input.name,
            description: input.description ?? null,
            ranking: input.ranking,
            isActive: input.isActive,
            matchAll: input.matchAll,
            stopAfter: input.stopAfter,
            isRecursive: input.isRecursive,
          })
          .returning({ id: rules.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      await tx.execute(sql`DELETE FROM rule_criteria WHERE rule_id = ${cible}`);
      await tx.execute(sql`DELETE FROM rule_actions WHERE rule_id = ${cible}`);

      if (input.criteria.length > 0) {
        await tx.insert(ruleCriteria).values(
          input.criteria.map((critere) => ({
            ruleId: cible,
            field: critere.field,
            operator: critere.operator,
            value: critere.value ?? null,
          })),
        );
      }

      if (input.actions.length > 0) {
        await tx.insert(ruleActions).values(
          input.actions.map((action) => ({
            ruleId: cible,
            field: action.field,
            action: action.action,
            value: action.value ?? null,
          })),
        );
      }

      return cible;
    });

    return this.findById(ruleId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(
        sql`UPDATE rules SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL`,
      );

      if (resultat.rowCount === 0) {
        throw new NotFoundException('Regle introuvable dans ce perimetre.');
      }
    });
  }

  /**
   * Fixe l'ordre d'évaluation.
   *
   * L'ordre est la moitié du sens d'une collection de règles : deux règles qui
   * décident du même champ ne se distinguent que par leur rang.
   */
  async reorder(ids: readonly number[]): Promise<void> {
    await this.db.asUser(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.execute(sql`
          UPDATE rules SET ranking = ${(index + 1) * PAS_DE_RANG}, updated_at = now()
           WHERE id = ${id} AND deleted_at IS NULL
        `);
      }
    });
  }

  /**
   * Exécute une collection dans le contexte de la requête en cours.
   *
   * Les règles visibles sont celles de l'entité active et celles héritées d'un
   * ancêtre récursif : c'est le Row-Level Security qui le décide, pas ce code.
   */
  async run(collection: RuleCollection, input: Record<string, unknown>): Promise<EngineResult> {
    const regles = await this.db.asUser((tx) => this.load(tx, collection, null));

    return this.engine.run(regles, input, { chain: !SANS_CHAINAGE.includes(collection) });
  }

  /**
   * Exécute une collection hors requête, pour une entité donnée.
   *
   * Nécessaire à la synchronisation d'annuaire et au balayage des escalades :
   * ces traitements n'ont pas d'utilisateur connecté, donc pas de contexte
   * d'entité à injecter dans les politiques. La visibilité ascendante est ici
   * reproduite explicitement, à l'identique de `tick_config_visible`.
   *
   * Un chemin nul retient **toutes** les règles de la collection. C'est le cas
   * de l'affectation d'habilitations : ces règles décident dans quelle entité
   * l'utilisateur obtient des droits, les filtrer par entité serait circulaire.
   */
  async runForEntity(
    collection: RuleCollection,
    entityPath: string | null,
    input: Record<string, unknown>,
  ): Promise<EngineResult> {
    const regles = await this.db.asOwner((tx) => this.load(tx, collection, entityPath));

    return this.engine.run(regles, input, { chain: !SANS_CHAINAGE.includes(collection) });
  }

  /**
   * Rejoue une collection sans rien écrire.
   *
   * Le simulateur appelle le moteur de production, pas une copie : c'est la
   * seule façon d'obtenir une réponse qui vaut encore demain.
   */
  async simulate(
    collection: RuleCollection,
    input: Record<string, unknown>,
  ): Promise<SimulationResult> {
    const { output, traces } = await this.run(collection, input);

    return { output, traces };
  }

  private async load(
    tx: Parameters<Parameters<DatabaseService['asUser']>[0]>[0],
    collection: RuleCollection,
    entityPath: string | null,
  ): Promise<EngineRule[]> {
    const resultat = await tx.execute<RuleRow>(sql`
      ${this.selection()}
       WHERE r.deleted_at IS NULL AND r.is_active AND r.collection = ${collection}
         ${
           entityPath === null
             ? sql``
             : sql`AND (r.entity_path = ${entityPath}::ltree
                        OR (r.is_recursive AND r.entity_path @> ${entityPath}::ltree))`
         }
       ORDER BY r.ranking, r.id
    `);

    return resultat.rows.map((row) => {
      const regle = this.toRule(row, new Map());

      return {
        id: regle.id,
        name: regle.name,
        matchAll: regle.matchAll,
        stopAfter: regle.stopAfter,
        criteria: regle.criteria.map((critere) => ({
          field: critere.field,
          operator: critere.operator,
          value: critere.value ?? null,
        })),
        actions: regle.actions.map((action) => ({
          field: action.field,
          action: action.action,
          value: action.value ?? null,
        })),
      };
    });
  }

  /**
   * Sélection commune.
   *
   * Les critères et les actions sont agrégés en JSON plutôt que rapportés par
   * une jointure plate : le produit cartésien de deux collections filles rendrait
   * le comptage faux, et le recollage côté application inutilement subtil.
   */
  private selection() {
    return sql`
      SELECT r.id, r.collection, r.name, r.description, r.ranking,
             r.is_active AS "isActive", r.match_all AS "matchAll",
             r.stop_after AS "stopAfter", r.is_recursive AS "isRecursive",
             r.entity_id AS "entityId",
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'field', c.field, 'operator', c.operator, 'value', c.value)
                       ORDER BY c.id)
                  FROM rule_criteria c WHERE c.rule_id = r.id),
               '[]'::jsonb) AS criteria,
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                         'field', a.field, 'action', a.action, 'value', a.value)
                       ORDER BY a.id)
                  FROM rule_actions a WHERE a.rule_id = r.id),
               '[]'::jsonb) AS actions
        FROM rules r
    `;
  }

  /** Complete les lignes avec le nom de leur entite, resolu a part. */
  private async nommer(rows: readonly RuleRow[]): Promise<Rule[]> {
    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => this.toRule(row, noms));
  }

  private toRule(row: RuleRow, noms: Map<number, string>): Rule {
    return {
      id: row.id,
      collection: row.collection,
      name: row.name,
      description: row.description,
      ranking: row.ranking,
      isActive: row.isActive,
      matchAll: row.matchAll,
      stopAfter: row.stopAfter,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      criteria: Array.isArray(row.criteria) ? (row.criteria as Rule['criteria']) : [],
      actions: Array.isArray(row.actions) ? (row.actions as Rule['actions']) : [],
    };
  }

  /**
   * Refuse une règle inexprimable.
   *
   * Une règle enregistrée mais jamais déclenchée est le pire des deux mondes :
   * elle rassure l'administrateur et ne fait rien. Le contrôle a donc lieu à
   * l'écriture, avec un message qui nomme le champ fautif.
   */
  private assertValid(input: UpsertRule): void {
    try {
      for (const critere of input.criteria) {
        this.catalog.assertCriterion(input.collection, critere.field, critere.operator);
      }

      for (const action of input.actions) {
        this.catalog.assertAction(input.collection, action.field, action.action);
      }
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }

    if (input.actions.length === 0) {
      throw new BadRequestException('Une regle sans action ne decide rien.');
    }
  }
}
