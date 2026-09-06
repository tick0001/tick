import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { MailerService } from './mailer.service.js';
import { NotificationTemplatesService } from './notification-templates.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications : reaction aux evenements d'un cote, configuration de l'autre.
 *
 * Les deux services ne se connaissent pas. L'envoi tourne hors session et lit
 * en proprietaire ; la configuration vit sous Row-Level Security. Les fondre
 * ferait dependre le chemin critique du code d'administration.
 */
@Module({
  imports: [AuthModule, PluginsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplatesService, MailerService],
  exports: [MailerService, NotificationTemplatesService],
})
export class NotificationsModule {}
