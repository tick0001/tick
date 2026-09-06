import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitiesModule } from '../entities/entities.module.js';
import { AdminController } from './admin.controller.js';
import { DirectoriesService } from './directories.service.js';
import { GroupsService } from './groups.service.js';
import { ProfilesService } from './profiles.service.js';
import { SettingsService } from './settings.service.js';
import { UsersService } from './users.service.js';

/**
 * Administration des comptes, groupes, profils et droits.
 *
 * Depend du module d'authentification pour deux raisons : la garde de droits en
 * vient, et le service de mots de passe aussi. La matrice de droits invalide au
 * passage le cache de `RightsService` — sans quoi un droit retire continuerait
 * de s'appliquer jusqu'au prochain redemarrage.
 */
@Module({
  imports: [AuthModule, EntitiesModule],
  controllers: [AdminController],
  providers: [UsersService, GroupsService, ProfilesService, DirectoriesService, SettingsService],
  exports: [UsersService, GroupsService, ProfilesService, DirectoriesService, SettingsService],
})
export class AdminModule {}
