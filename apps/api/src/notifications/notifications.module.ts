import { Module } from '@nestjs/common';
import { PluginsModule } from '../plugins/plugins.module.js';
import { MailerService } from './mailer.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications elementaires du jalon J3.
 *
 * Le module s'abonne aux evenements du coeur et met en file : la configuration
 * complete (evenements personnalises, destinataires calcules, editeur de
 * modeles) arrive au jalon J5, sans changer ce socle.
 */
@Module({
  imports: [PluginsModule],
  providers: [NotificationsService, MailerService],
  exports: [MailerService],
})
export class NotificationsModule {}
