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
  upsertGroupSchema,
  upsertMemberSchema,
  upsertProfileSchema,
  upsertUserSchema,
  userFilterSchema,
  type Authorization,
  type Group,
  type Profile,
  type RightObject,
  type UpsertAuthorization,
  type UpsertGroup,
  type UpsertMember,
  type UpsertProfile,
  type UpsertUser,
  type UserDetail,
  type UserFilter,
  type UserSummary,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { translate } from '../search/search-labels.js';
import { GroupsService } from './groups.service.js';
import { ProfilesService } from './profiles.service.js';
import { RIGHT_CATALOGUE } from './right-catalogue.js';
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
}
