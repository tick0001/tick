import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RulesCoreModule } from './rules-core.module.js';
import { RulesController } from './rules.controller.js';

/**
 * Façade HTTP du moteur de règles.
 *
 * Le moteur lui-même vit dans `RulesCoreModule` : les modules qui l'utilisent
 * — annuaire, tickets — importent celui-là, jamais celui-ci, et n'entraînent
 * donc pas l'authentification dans leur graphe de dépendances.
 */
@Module({
  imports: [AuthModule, RulesCoreModule],
  controllers: [RulesController],
  exports: [RulesCoreModule],
})
export class RulesModule {}
