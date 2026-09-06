import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  notificationQueueFilterSchema,
  setNotificationPreferenceSchema,
  upsertNotificationTemplateSchema,
  type NotificationEvent,
  type NotificationPreference,
  type NotificationQueueEntry,
  type NotificationQueueFilter,
  type NotificationTemplate,
  type SetNotificationPreference,
  type UpsertNotificationTemplate,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { NotificationTemplatesService } from './notification-templates.service.js';

@Controller('notifications')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationTemplatesService) {}

  /**
   * Préférences de l'utilisateur courant.
   *
   * Aucun droit exigé : chacun règle ce qu'il reçoit, et le subordonner à un
   * droit d'administration reviendrait à confier ce choix à quelqu'un d'autre.
   */
  @Get('preferences')
  async preferences(): Promise<NotificationPreference[]> {
    return this.service.preferences(currentContext()?.locale ?? 'fr');
  }

  @Put('preferences')
  @HttpCode(204)
  async setPreference(
    @Body(new ZodValidationPipe(setNotificationPreferenceSchema)) body: SetNotificationPreference,
  ): Promise<void> {
    await this.service.setPreference(body.event, body.enabled);
  }

  @Get('events')
  @RequireRight('notification', 'read')
  events(): NotificationEvent[] {
    return this.service.events(currentContext()?.locale ?? 'fr');
  }

  @Get('variables')
  @RequireRight('notification', 'read')
  variables(): string[] {
    return this.service.variables();
  }

  @Get('queue')
  @RequireRight('notification', 'read')
  async queue(
    @Query(new ZodValidationPipe(notificationQueueFilterSchema)) filtre: NotificationQueueFilter,
  ): Promise<NotificationQueueEntry[]> {
    return this.service.queue(filtre);
  }

  @Post('queue/:id/replay')
  @RequireRight('notification', 'update')
  @HttpCode(204)
  async replay(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.replay(id);
  }

  @Post('queue/purge')
  @RequireRight('notification', 'update')
  @HttpCode(200)
  async purge(@Query('days') days?: string): Promise<{ removed: number }> {
    const jours = Number(days);

    return { removed: await this.service.purge(Number.isInteger(jours) && jours > 0 ? jours : 30) };
  }

  @Get('templates')
  @RequireRight('notification', 'read')
  async list(): Promise<NotificationTemplate[]> {
    return this.service.list();
  }

  @Get('templates/:id')
  @RequireRight('notification', 'read')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<NotificationTemplate> {
    return this.service.findById(id);
  }

  @Post('templates')
  @RequireRight('notification', 'update')
  async create(
    @Body(new ZodValidationPipe(upsertNotificationTemplateSchema))
    body: UpsertNotificationTemplate,
  ): Promise<NotificationTemplate> {
    return this.service.save(body);
  }

  @Put('templates/:id')
  @RequireRight('notification', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertNotificationTemplateSchema))
    body: UpsertNotificationTemplate,
  ): Promise<NotificationTemplate> {
    return this.service.save(body, id);
  }

  @Delete('templates/:id')
  @RequireRight('notification', 'update')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.remove(id);
  }
}
