import { BadRequestException, Injectable } from '@nestjs/common';
import type { SearchNode, SearchOperator } from '@tick/contracts';
import { sql, type SQL } from '@tick/db';
import {
  cleSondage,
  OPERATEUR_DENSE,
  tableauIdentifiants,
  type CibleTextuelle,
  type Resolution,
} from '../tickets/sonde-textuelle.service.js';
import { SearchRegistry, type SearchableField } from './search-registry.service.js';

/** Profondeur maximale d'un arbre de critères. */
const MAX_DEPTH = 6;

/** Une recherche textuelle a sonder avant de compiler. */
export interface DemandeTextuelle {
  readonly cible: CibleTextuelle;
  readonly motif: string;
}

/**
 * Compile un arbre de critères en clause SQL.
 *
 * Trois règles tiennent la sécurité de ce moteur :
 *
 *  1. un critère ne peut nommer qu'une **clé enregistrée**, jamais une colonne ;
 *  2. l'expression SQL vient du registre, écrite par un développeur ;
 *  3. les valeurs passent en paramètres liés, jamais concaténées.
 *
 * Sans ces trois règles, une recherche multi-critères revient à laisser
 * l'utilisateur composer la clause `WHERE`.
 */
@Injectable()
export class SearchCompiler {
  constructor(private readonly registry: SearchRegistry) {}

  /**
   * `resolution` porte ce que la sonde textuelle a trouve. Sans elle, les
   * criteres textuels compilent en `ILIKE` seul — le comportement d'avant, et
   * celui que gardent les appelants qui n'ont pas a paginer.
   */
  compile(node: SearchNode | undefined, resolution?: Resolution, profondeur = 0): SQL | undefined {
    if (!node) return undefined;

    if (profondeur > MAX_DEPTH) {
      throw new BadRequestException('Critères trop imbriqués.');
    }

    if (node.kind === 'group') {
      const enfants = (node.children ?? [])
        .map((enfant) => this.compile(enfant, resolution, profondeur + 1))
        .filter((clause): clause is SQL => clause !== undefined);

      if (enfants.length === 0) return undefined;

      const liaison = node.link === 'or' ? sql` OR ` : sql` AND `;

      return sql`(${sql.join(enfants, liaison)})`;
    }

    const champ = this.registry.get(node.field ?? '');

    if (!champ) {
      throw new BadRequestException(`Champ de recherche inconnu : ${node.field ?? '(vide)'}.`);
    }

    const operateur = node.operator;

    if (!operateur || !champ.operators.includes(operateur)) {
      throw new BadRequestException(
        `Opérateur ${operateur ?? '(absent)'} non applicable au champ ${champ.key}.`,
      );
    }

    return this.clause(champ, operateur, node.value, resolution);
  }

  /**
   * Les recherches textuelles qu'un arbre demandera, pour les sonder d'abord.
   *
   * Ne leve rien : un arbre invalide est refuse par `compile`, avec le message
   * qui convient. Appeler `compile` avant evite de sonder pour rien.
   */
  textuels(node: SearchNode | undefined, profondeur = 0): DemandeTextuelle[] {
    if (!node || profondeur > MAX_DEPTH) return [];

    if (node.kind === 'group') {
      return (node.children ?? []).flatMap((enfant) => this.textuels(enfant, profondeur + 1));
    }

    const champ = this.registry.get(node.field ?? '');
    const motif = this.motif(node.operator, node.value);

    if (!champ?.semblable || motif === undefined) return [];

    return [{ cible: champ.semblable.cible, motif }];
  }

  /** Le motif `ILIKE` d'un operateur textuel, ou rien pour les autres. */
  private motif(operateur: SearchOperator | undefined, valeur: unknown): string | undefined {
    if (typeof valeur !== 'string') return undefined;
    if (operateur === 'contains') return `%${valeur}%`;
    if (operateur === 'startsWith') return `${valeur}%`;

    return undefined;
  }

  private clause(
    champ: SearchableField,
    operateur: SearchOperator,
    valeur: unknown,
    resolution: Resolution | undefined,
  ): SQL {
    const colonne = champ.column;

    switch (operateur) {
      case 'isNull':
        return sql`${colonne} IS NULL`;
      case 'isNotNull':
        return sql`${colonne} IS NOT NULL`;

      case 'contains':
      case 'startsWith': {
        this.texte(valeur, champ);

        return this.semblable(champ, this.motif(operateur, valeur) ?? '', resolution);
      }

      case 'in': {
        const valeurs = Array.isArray(valeur) ? valeur : [valeur];

        if (valeurs.length === 0) {
          // Une liste vide ne doit rien selectionner, et surtout pas tout.
          return sql`FALSE`;
        }

        return sql`${colonne} IN (${sql.join(
          valeurs.map((element) => sql`${this.scalaire(element, champ)}`),
          sql`, `,
        )})`;
      }

      case 'ne':
        // `IS DISTINCT FROM` plutot que `<>` : sinon une valeur nulle ne serait
        // jamais « differente de » quoi que ce soit, ce qui surprend toujours.
        return sql`${colonne} IS DISTINCT FROM ${this.scalaire(valeur, champ)}`;

      case 'eq':
        return sql`${colonne} = ${this.scalaire(valeur, champ)}`;
      case 'lt':
        return sql`${colonne} < ${this.scalaire(valeur, champ)}`;
      case 'lte':
        return sql`${colonne} <= ${this.scalaire(valeur, champ)}`;
      case 'gt':
        return sql`${colonne} > ${this.scalaire(valeur, champ)}`;
      case 'gte':
        return sql`${colonne} >= ${this.scalaire(valeur, champ)}`;
    }
  }

  /**
   * Un critere textuel, servi par l'index quand la sonde l'a permis.
   *
   * Le filtre `ILIKE` reste en place meme quand les identifiants sont connus :
   * la sonde et la page ne lisent pas le meme instantane, et un ticket renomme
   * entre les deux ne doit pas ressortir. Sur deux mille lignes au plus, il ne
   * coute rien.
   *
   * Des correspondances denses passent par `OPERATEUR_DENSE` : c'est le
   * parcours de la liste dans l'ordre qui les sert, et le planificateur ne le
   * choisit qu'avec cette estimation.
   */
  private semblable(
    champ: SearchableField,
    motif: string,
    resolution: Resolution | undefined,
  ): SQL {
    const filtre = sql`${champ.column} ILIKE ${motif}`;
    const sondage = champ.semblable && resolution?.get(cleSondage(champ.semblable.cible, motif));

    if (!champ.semblable || !sondage) return filtre;
    if (sondage.dense) return sql`${champ.column} ${OPERATEUR_DENSE} ${motif}`;

    const identifiants = tableauIdentifiants(sondage.identifiants);

    return sql`(${champ.semblable.identifiant} = ANY(${identifiants}::bigint[]) AND ${filtre})`;
  }

  private texte(valeur: unknown, champ: SearchableField): string {
    if (typeof valeur !== 'string') {
      throw new BadRequestException(`Le champ ${champ.key} attend du texte.`);
    }

    return valeur;
  }

  /**
   * Normalise une valeur selon le type déclaré du champ.
   *
   * Refuse plutôt que de convertir au mieux : une date illisible comparée comme
   * du texte produirait un résultat plausible et faux, ce qui est pire qu'une
   * erreur.
   */
  private scalaire(valeur: unknown, champ: SearchableField): string | number | boolean | Date {
    switch (champ.type) {
      case 'number':
      case 'reference': {
        const nombre = typeof valeur === 'number' ? valeur : Number(valeur);

        if (!Number.isFinite(nombre)) {
          throw new BadRequestException(`Le champ ${champ.key} attend un nombre.`);
        }

        return nombre;
      }

      case 'boolean':
        return valeur === true || valeur === 'true';

      case 'date': {
        const date = valeur instanceof Date ? valeur : new Date(String(valeur));

        if (Number.isNaN(date.getTime())) {
          throw new BadRequestException(`Le champ ${champ.key} attend une date.`);
        }

        return date;
      }

      case 'enum': {
        const texte = String(valeur);

        if (champ.options && !champ.options.includes(texte)) {
          throw new BadRequestException(`Valeur ${texte} hors des choix du champ ${champ.key}.`);
        }

        return texte;
      }

      default:
        return String(valeur);
    }
  }
}
