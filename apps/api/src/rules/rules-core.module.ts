import { Module } from '@nestjs/common';
import { RuleCatalogService } from './rule-catalog.service.js';
import { RuleEngineService } from './rule-engine.service.js';
import { RulesService } from './rules.service.js';

/**
 * Moteur de règles, sans sa façade HTTP.
 *
 * Séparé de `RulesModule` pour une raison précise : l'annuaire consomme les
 * règles, et l'authentification consomme l'annuaire. Si le module qui porte le
 * contrôleur — et donc les gardes, donc l'authentification — était le seul
 * disponible, la boucle serait immédiate. Ce module-ci ne dépend de rien.
 */
@Module({
  providers: [RulesService, RuleEngineService, RuleCatalogService],
  exports: [RulesService, RuleEngineService, RuleCatalogService],
})
export class RulesCoreModule {}
