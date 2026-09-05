import { Injectable, Logger } from '@nestjs/common';
import type { RuleActionType, RuleOperator, RuleTrace } from '@tick/contracts';

export interface EngineCriterion {
  field: string;
  operator: RuleOperator;
  value: string | null;
}

export interface EngineAction {
  field: string;
  action: RuleActionType;
  value: string | null;
}

export interface EngineRule {
  id: number;
  name: string;
  matchAll: boolean;
  stopAfter: boolean;
  criteria: readonly EngineCriterion[];
  actions: readonly EngineAction[];
}

export interface EngineOptions {
  /**
   * Chaine les regles : les criteres d'une regle voient ce que les precedentes
   * ont decide.
   *
   * Vrai pour les tickets, ou les regles se completent — normaliser la
   * categorie puis en deduire le groupe. Faux pour les habilitations, ou chaque
   * regle produit une decision **independante** : sans cela, la deuxieme regle
   * verrait le profil pose par la premiere et ne pourrait plus s'appliquer.
   */
  chain?: boolean;
}

export interface EngineResult {
  /** Champs décidés par les règles. Une valeur nulle est un effacement voulu. */
  output: Record<string, string | null>;
  traces: RuleTrace[];
}

/**
 * Longueur maximale d'une expression régulière.
 *
 * Les expressions sont écrites par des administrateurs, pas par des visiteurs,
 * mais elles s'exécutent sur chaque ticket créé. Une borne courte réduit la
 * surface d'une expression pathologique sans gêner aucun usage réel — Node ne
 * sait pas interrompre une évaluation trop longue.
 */
const MAX_REGEX = 200;

/** Sépare deux valeurs concaténées par une action « ajouter à la suite ». */
const SEPARATEUR_APPEND = ' ';

/**
 * Représentation textuelle d'une valeur d'entrée.
 *
 * Tout est comparé sous forme de texte : c'est ce qui permet au même opérateur
 * « contient » de fonctionner sur un titre, sur une liste de groupes et sur un
 * identifiant, sans que chaque champ ait à déclarer sa propre comparaison.
 */
function toText(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) {
    return null;
  }

  if (Array.isArray(valeur)) {
    return valeur.length === 0 ? null : valeur.map((element) => String(element)).join('|');
  }

  if (valeur instanceof Date) {
    return valeur.toISOString();
  }

  if (typeof valeur === 'boolean' || typeof valeur === 'number') {
    return String(valeur);
  }

  return typeof valeur === 'string' ? valeur : JSON.stringify(valeur);
}

function normalise(valeur: string | null): string {
  return (valeur ?? '').trim().toLocaleLowerCase();
}

/**
 * Moteur d'évaluation.
 *
 * Sans état et sans accès à la base : il reçoit des règles et des valeurs, il
 * rend des valeurs et une trace. C'est ce qui permet au simulateur d'exercer
 * exactement le code qui tourne en production, et aux tests de couvrir chaque
 * opérateur sans monter de contexte.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  run(
    rules: readonly EngineRule[],
    input: Record<string, unknown>,
    options: EngineOptions = {},
  ): EngineResult {
    const chaine = options.chain ?? true;
    const output: Record<string, string | null> = {};
    const traces: RuleTrace[] = [];

    for (const rule of rules) {
      const propre: Record<string, string | null> = {};
      const accumule = chaine ? output : propre;
      const courant = (field: string): string | null =>
        field in accumule ? (accumule[field] ?? null) : toText(input[field]);

      const captures = new Map<string, RegExpExecArray>();
      const detail: RuleTrace['criteria'] = [];
      let satisfaite = rule.matchAll;

      for (const critere of rule.criteria) {
        const actuel = courant(critere.field);
        const verdict = this.evaluate(critere, actuel, captures);

        detail.push({
          field: critere.field,
          operator: critere.operator,
          value: critere.value ?? null,
          actual: actuel,
          matched: verdict,
        });

        satisfaite = rule.matchAll ? satisfaite && verdict : satisfaite || verdict;
      }

      // Une règle sans critère s'applique toujours : c'est la façon d'exprimer
      // une valeur par défaut, et c'est le comportement attendu par qui écrit
      // une dernière règle « attraper le reste ».
      if (rule.criteria.length === 0) {
        satisfaite = true;
      }

      const applied: RuleTrace['applied'] = [];

      if (satisfaite) {
        for (const action of rule.actions) {
          const valeur = this.apply(action, courant(action.field), captures);

          output[action.field] = valeur;
          propre[action.field] = valeur;
          applied.push({ field: action.field, value: valeur });
        }
      }

      const stopped = satisfaite && rule.stopAfter;

      traces.push({
        ruleId: rule.id,
        name: rule.name,
        matched: satisfaite,
        criteria: detail,
        applied,
        stopped,
      });

      if (stopped) {
        break;
      }
    }

    return { output, traces };
  }

  private evaluate(
    critere: EngineCriterion,
    actuel: string | null,
    captures: Map<string, RegExpExecArray>,
  ): boolean {
    const attendu = critere.value ?? '';

    switch (critere.operator) {
      case 'is':
        return normalise(actuel) === normalise(attendu);
      case 'is_not':
        return normalise(actuel) !== normalise(attendu);
      case 'contains':
        return actuel !== null && normalise(actuel).includes(normalise(attendu));
      case 'not_contains':
        return actuel === null || !normalise(actuel).includes(normalise(attendu));
      case 'starts_with':
        return actuel !== null && normalise(actuel).startsWith(normalise(attendu));
      case 'ends_with':
        return actuel !== null && normalise(actuel).endsWith(normalise(attendu));
      case 'regex':
        return this.matchRegex(critere.field, actuel, attendu, captures);
      case 'not_regex':
        return !this.matchRegex(critere.field, actuel, attendu, captures);
      // Comparaison de chemins matérialisés : `e1.e3` est sous `e1`, et `e10`
      // ne l'est pas — d'où le point exigé, qu'une simple comparaison de
      // préfixe manquerait.
      case 'under':
        return actuel !== null && (actuel === attendu || actuel.startsWith(`${attendu}.`));
      case 'not_under':
        return actuel === null || (actuel !== attendu && !actuel.startsWith(`${attendu}.`));
      case 'is_empty':
        return actuel === null || actuel.trim() === '';
      case 'is_not_empty':
        return actuel !== null && actuel.trim() !== '';
    }
  }

  /**
   * Évalue une expression et mémorise ses captures.
   *
   * Les captures sont indexées par champ : une action `regex_result` du même
   * champ peut ainsi réutiliser `#1`, ce qui est le seul moyen d'extraire un
   * numéro de série ou un code d'application depuis un objet de courriel.
   */
  private matchRegex(
    field: string,
    actuel: string | null,
    motif: string,
    captures: Map<string, RegExpExecArray>,
  ): boolean {
    if (actuel === null || motif === '') {
      return false;
    }

    if (motif.length > MAX_REGEX) {
      this.logger.warn(`Expression reguliere trop longue, critere ignore : ${field}`);

      return false;
    }

    let expression: RegExp;

    try {
      expression = new RegExp(motif, 'iu');
    } catch {
      this.logger.warn(`Expression reguliere invalide, critere ignore : ${motif}`);

      return false;
    }

    const resultat = expression.exec(actuel);

    if (!resultat) {
      return false;
    }

    captures.set(field, resultat);

    return true;
  }

  private apply(
    action: EngineAction,
    actuel: string | null,
    captures: Map<string, RegExpExecArray>,
  ): string | null {
    switch (action.action) {
      case 'assign':
        return action.value ?? null;
      case 'clear':
        return null;
      case 'append': {
        const ajout = action.value ?? '';

        if (ajout === '') {
          return actuel;
        }

        return actuel === null || actuel === '' ? ajout : `${actuel}${SEPARATEUR_APPEND}${ajout}`;
      }
      case 'regex_result':
        return this.substitute(action.value ?? '', captures.get(action.field));
    }
  }

  /**
   * Remplace `#0` à `#9` par les captures de l'expression du même champ.
   *
   * Une référence sans capture correspondante devient une chaîne vide plutôt
   * qu'un `#3` littéral : voir un marqueur brut dans un titre de ticket serait
   * plus déroutant qu'un blanc.
   */
  private substitute(gabarit: string, capture: RegExpExecArray | undefined): string | null {
    if (!capture) {
      return null;
    }

    const rendu = gabarit.replace(/#(\d)/g, (_, index: string) => capture[Number(index)] ?? '');

    return rendu === '' ? null : rendu;
  }
}
