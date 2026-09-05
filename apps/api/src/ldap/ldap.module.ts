import { Module } from '@nestjs/common';
import { RulesCoreModule } from '../rules/rules-core.module.js';
import { LdapSyncService } from './ldap-sync.service.js';
import { LdapService } from './ldap.service.js';

/**
 * Aucune dependance vers le module d'authentification : c'est lui qui orchestre
 * l'annuaire, jamais l'inverse. Le cycle entre les deux serait sinon inevitable.
 */
@Module({
  imports: [RulesCoreModule],
  providers: [LdapService, LdapSyncService],
  exports: [LdapService, LdapSyncService],
})
export class LdapModule {}
