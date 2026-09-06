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
  upsertAuthorizationSchema,
  upsertLdapDirectorySchema,
  writeSettingsSchema,
  upsertGroupSchema,
  upsertMemberSchema,
  upsertProfileSchema,
  upsertUserSchema,
  userFilterSchema,
  type Authorization,
  type DirectoryTest,
  type EntitySettings,
  type Group,
  type LdapDirectory,
  type Profile,
  type RightObject,
  type UpsertAuthorization,
  type UpsertGroup,
  type UpsertLdapDirectory,
  type UpsertMember,
  type UpsertProfile,
  type UpsertUser,
  type UserDetail,
  type UserFilter,
  type UserSummary,
  type WriteSettings,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { translate } from '../search/search-labels.js';
import { DirectoriesService } from './directories.service.js';
import { GroupsService } from './groups.service.js';
import { ProfilesService } from './profiles.service.js';
import { RIGHT_CATALOGUE } from './right-catalogue.js';
import { SettingsService } from './settings.service.js';
import { UsersService } from './users.service.js';

/**
 * Administration : comptes, groupes, profils et droits.
 *
 * Ces routes sont gardées par le droit, pas seulement par la session : les
 * tables `users`, `profiles` et `profile_rights` sont globales et n'ont pas de
 * politique de sécurité au niveau des lignes. La garde est donc le seul rempart,
 * et c'est la raison pour laquelle les droits `user:*` et `profile:*` ne doivent
 * être accordés qu'à un profil d'administration.
 */
@Controller('admin')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly groups: GroupsService,
    private readonly profiles: ProfilesService,
    private readonly directories: DirectoriesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Catalogue des droits configurables, libellés traduits.
   *
   * Servi par le serveur parce que les plugins en déclarent : une liste figée
   * côté interface rendrait leurs droits inconfigurables, donc leurs écrans
   * inaccessibles.
   */
  @Get('rights')
  @RequireRight('profile', 'read')
  rightCatalogue(): RightObject[] {
    const locale = currentContext()?.locale ?? 'fr';

    return RIGHT_CATALOGUE.map((entree) => ({
      object: entree.object,
      label: translate(entree.labelKey, locale),
      group: entree.group,
      actions: [...entree.actions],
      scopes: [...entree.scopes],
    }));
  }

  // --- Utilisateurs ---------------------------------------------------------

  @Get('users')
  @RequireRight('user', 'read')
  async listUsers(
    @Query(new ZodValidationPipe(userFilterSchema)) filter: UserFilter,
  ): Promise<UserSummary[]> {
    return this.users.list(filter);
  }

  @Get('users/:id')
  @RequireRight('user', 'read')
  async findUser(@Param('id', ParseIntPipe) id: number): Promise<UserDetail> {
    return this.users.findById(id);
  }

  @Post('users')
  @RequireRight('user', 'create')
  async createUser(
    @Body(new ZodValidationPipe(upsertUserSchema)) body: UpsertUser,
  ): Promise<UserDetail> {
    return this.users.create(body);
  }

  @Put('users/:id')
  @RequireRight('user', 'update')
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertUserSchema)) body: UpsertUser,
  ): Promise<UserDetail> {
    return this.users.update(id, body);
  }

  @Post('users/:id/authorizations')
  @RequireRight('user', 'update')
  async grant(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertAuthorizationSchema)) body: UpsertAuthorization,
  ): Promise<Authorization[]> {
    return this.users.grant(id, body);
  }

  @Delete('users/:id/authorizations/:entityId/:profileId')
  @RequireRight('user', 'update')
  async revoke(
    @Param('id', ParseIntPipe) id: number,
    @Param('entityId', ParseIntPipe) entityId: number,
    @Param('profileId', ParseIntPipe) profileId: number,
  ): Promise<Authorization[]> {
    return this.users.revoke(id, entityId, profileId);
  }

  // --- Groupes --------------------------------------------------------------

  @Get('groups')
  @RequireRight('group', 'read')
  async listGroups(): Promise<Group[]> {
    return this.groups.list();
  }

  @Post('groups')
  @RequireRight('group', 'create')
  async createGroup(
    @Body(new ZodValidationPipe(upsertGroupSchema)) body: UpsertGroup,
  ): Promise<Group> {
    return this.groups.save(body);
  }

  @Put('groups/:id')
  @RequireRight('group', 'update')
  async updateGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertGroupSchema)) body: UpsertGroup,
  ): Promise<Group> {
    return this.groups.save(body, id);
  }

  @Delete('groups/:id')
  @HttpCode(204)
  @RequireRight('group', 'delete')
  async removeGroup(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.groups.remove(id);
  }

  @Post('groups/:id/members')
  @RequireRight('group', 'update')
  async addMember(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertMemberSchema)) body: UpsertMember,
  ): Promise<Group> {
    return this.groups.addMember(id, body);
  }

  @Delete('groups/:id/members/:userId')
  @RequireRight('group', 'update')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Group> {
    return this.groups.removeMember(id, userId);
  }

  // --- Profils --------------------------------------------------------------

  @Get('profiles')
  @RequireRight('profile', 'read')
  async listProfiles(): Promise<Profile[]> {
    return this.profiles.list();
  }

  @Post('profiles')
  @RequireRight('profile', 'update')
  async createProfile(
    @Body(new ZodValidationPipe(upsertProfileSchema)) body: UpsertProfile,
  ): Promise<Profile> {
    return this.profiles.save(body);
  }

  @Put('profiles/:id')
  @RequireRight('profile', 'update')
  async updateProfile(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertProfileSchema)) body: UpsertProfile,
  ): Promise<Profile> {
    return this.profiles.save(body, id);
  }

  @Delete('profiles/:id')
  @HttpCode(204)
  @RequireRight('profile', 'update')
  async removeProfile(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.profiles.remove(id);
  }

  // --- Annuaires ------------------------------------------------------------

  @Get('directories')
  @RequireRight('ldap', 'read')
  async listDirectories(): Promise<LdapDirectory[]> {
    return this.directories.list();
  }

  @Post('directories')
  @RequireRight('ldap', 'update')
  async createDirectory(
    @Body(new ZodValidationPipe(upsertLdapDirectorySchema)) body: UpsertLdapDirectory,
  ): Promise<LdapDirectory> {
    return this.directories.save(body);
  }

  @Put('directories/:id')
  @RequireRight('ldap', 'update')
  async updateDirectory(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertLdapDirectorySchema)) body: UpsertLdapDirectory,
  ): Promise<LdapDirectory> {
    return this.directories.save(body, id);
  }

  @Delete('directories/:id')
  @HttpCode(204)
  @RequireRight('ldap', 'update')
  async removeDirectory(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.directories.remove(id);
  }

  /**
   * Essai de connexion.
   *
   * En `POST` bien qu'il ne modifie rien : il ouvre une connexion sortante vers
   * un hote arbitraire, et un `GET` serait declenchable depuis une image.
   */
  @Post('directories/:id/test')
  @HttpCode(200)
  @RequireRight('ldap', 'update')
  async testDirectory(@Param('id', ParseIntPipe) id: number): Promise<DirectoryTest> {
    return this.directories.test(id);
  }

  // --- Reglages par entite --------------------------------------------------

  @Get('settings/:entityId')
  @RequireRight('entity', 'read')
  async readSettings(
    @Param('entityId', ParseIntPipe) entityId: number,
  ): Promise<EntitySettings> {
    return this.settings.read(entityId);
  }

  @Put('settings/:entityId')
  @RequireRight('entity', 'update')
  async writeSettings(
    @Param('entityId', ParseIntPipe) entityId: number,
    @Body(new ZodValidationPipe(writeSettingsSchema)) body: WriteSettings,
  ): Promise<EntitySettings> {
    return this.settings.write(entityId, body);
  }
}
