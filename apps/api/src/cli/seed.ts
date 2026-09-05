import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  authorizations,
  entities,
  entitySettings,
  groupMembers,
  groups,
  ldapDirectories,
  ldapGroupMappings,
  profileRights,
  profiles,
  sql,
  users,
  type Transaction,
} from '@tick/db';
import { AppModule } from '../app.module.js';
import { loadEnvFiles } from '../config/env.js';
import { PasswordService } from '../auth/password.service.js';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';

type RightScope = 'own' | 'group' | 'entity' | 'recursive' | 'all';
type RightTriple = [object: string, action: string, scope: RightScope];

/**
 * Jeux de droits de reference, calques sur ceux de GLPI.
 *
 * La portee compte autant que le droit : un technicien voit les tickets de son
 * entite mais ne modifie que ceux de ses groupes.
 */
const PROFILE_RIGHTS: Record<string, RightTriple[]> = {
  'Self-service': [
    ['ticket', 'read', 'own'],
    ['ticket', 'create', 'entity'],
    ['ticket', 'update', 'own'],
    ['kb', 'read', 'entity'],
  ],
  Technicien: [
    ['ticket', 'read', 'entity'],
    ['ticket', 'create', 'entity'],
    ['ticket', 'update', 'group'],
    ['entity', 'read', 'entity'],
    ['group', 'read', 'entity'],
    ['kb', 'read', 'entity'],
  ],
  Superviseur: [
    ['ticket', 'read', 'recursive'],
    ['ticket', 'create', 'recursive'],
    ['ticket', 'update', 'recursive'],
    ['ticket', 'delete', 'recursive'],
    ['entity', 'read', 'recursive'],
    ['group', 'read', 'recursive'],
    ['kb', 'read', 'recursive'],
  ],
  Administrateur: [
    ['ticket', 'read', 'all'],
    ['ticket', 'create', 'all'],
    ['ticket', 'update', 'all'],
    ['ticket', 'delete', 'all'],
    ['entity', 'read', 'all'],
    ['entity', 'create', 'all'],
    ['entity', 'update', 'all'],
    ['entity', 'delete', 'all'],
    ['group', 'read', 'all'],
    ['group', 'create', 'all'],
    ['group', 'update', 'all'],
    ['profile', 'read', 'all'],
    ['profile', 'update', 'all'],
    ['user', 'read', 'all'],
    ['user', 'create', 'all'],
    ['user', 'update', 'all'],
    ['kb', 'read', 'all'],
  ],
};

async function createEntity(
  tx: Transaction,
  name: string,
  parentId: number | null,
): Promise<number> {
  const [row] = await tx
    .insert(entities)
    .values({ name, parentId, path: 'temporaire', completeName: name })
    .returning({ id: entities.id });

  if (!row) throw new Error(`Creation de l'entite ${name} impossible.`);

  return row.id;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const logger = new Logger('Amorcage');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const db = app.get(DatabaseService);
  const passwords = app.get(PasswordService);
  const secrets = app.get(SecretsService);

  const secret = await passwords.hash('tick');

  await db.asOwner(async (tx) => {
    await tx.execute(sql`
      TRUNCATE sessions, authorizations, group_members, groups, profile_rights,
               profiles, entity_settings, users, ldap_group_mappings,
               ldap_directories, entities RESTART IDENTITY CASCADE
    `);

    const racine = await createEntity(tx, 'Racine', null);
    const siege = await createEntity(tx, 'Siege', racine);
    const dsi = await createEntity(tx, 'DSI', siege);
    await createEntity(tx, 'RH', siege);
    const nord = await createEntity(tx, 'Filiale Nord', racine);
    const siteA = await createEntity(tx, 'Site A', nord);
    const siteB = await createEntity(tx, 'Site B', nord);

    // Configuration heritee : la racine pose les valeurs par defaut, la Filiale
    // Nord en redefinit une seule. Les sites en heritent sans rien declarer.
    await tx.insert(entitySettings).values([
      {
        entityId: racine,
        autoCloseDelayDays: 7,
        mailFrom: 'assistance@exemple.fr',
        defaultLocale: 'fr',
      },
      { entityId: nord, autoCloseDelayDays: 3 },
    ]);

    const profileIds = new Map<string, number>();
    for (const [name, rights] of Object.entries(PROFILE_RIGHTS)) {
      const [profile] = await tx
        .insert(profiles)
        .values({
          name,
          interface: name === 'Self-service' ? 'self_service' : 'standard',
          isDefault: name === 'Self-service',
        })
        .returning({ id: profiles.id });

      if (!profile) throw new Error(`Creation du profil ${name} impossible.`);

      profileIds.set(name, profile.id);
      await tx.insert(profileRights).values(
        rights.map(([object, action, scope]) => ({
          profileId: profile.id,
          object,
          action,
          scope,
        })),
      );
    }

    // Un groupe recursif defini a la racine est utilisable partout ; le meme
    // sans le drapeau n'existe que pour la racine. C'est toute la difference
    // entre un objet de configuration partage et un objet local.
    const [supportN1] = await tx
      .insert(groups)
      .values({
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        name: 'Support N1',
        completeName: 'Support N1',
      })
      .returning({ id: groups.id });

    await tx.insert(groups).values([
      {
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: false,
        name: 'Direction',
        completeName: 'Direction',
      },
      {
        entityId: siteA,
        entityPath: 'temporaire',
        isRecursive: false,
        name: 'Techniciens Site A',
        completeName: 'Techniciens Site A',
      },
      {
        entityId: siteB,
        entityPath: 'temporaire',
        isRecursive: false,
        name: 'Techniciens Site B',
        completeName: 'Techniciens Site B',
      },
    ]);

    const comptes = [
      { username: 'admin', firstName: 'Alice', lastName: 'Martin', defaultEntityId: racine },
      { username: 'sophie', firstName: 'Sophie', lastName: 'Bernard', defaultEntityId: nord },
      { username: 'thomas', firstName: 'Thomas', lastName: 'Petit', defaultEntityId: siteA },
      { username: 'lea', firstName: 'Lea', lastName: 'Moreau', defaultEntityId: siteB },
      { username: 'demandeur', firstName: 'Paul', lastName: 'Durand', defaultEntityId: dsi },
    ];

    const userIds = new Map<string, number>();
    for (const compte of comptes) {
      const [user] = await tx
        .insert(users)
        .values({
          ...compte,
          email: `${compte.username}@exemple.fr`,
          passwordHash: secret,
          locale: 'fr',
        })
        .returning({ id: users.id });

      if (!user) throw new Error(`Creation du compte ${compte.username} impossible.`);
      userIds.set(compte.username, user.id);
    }

    const reference = (name: string): number => {
      const value = userIds.get(name) ?? profileIds.get(name);
      if (value === undefined) throw new Error(`Reference inconnue : ${name}`);
      return value;
    };

    await tx.insert(authorizations).values([
      // Administrateur sur toute l'arborescence.
      {
        userId: reference('admin'),
        profileId: reference('Administrateur'),
        entityId: racine,
        isRecursive: true,
      },

      // Superviseur sur la Filiale Nord et sa descendance.
      {
        userId: reference('sophie'),
        profileId: reference('Superviseur'),
        entityId: nord,
        isRecursive: true,
      },

      // Technicien sur Site A seulement : pas de descendance, pas de Site B.
      {
        userId: reference('thomas'),
        profileId: reference('Technicien'),
        entityId: siteA,
        isRecursive: false,
      },

      // Le cas qui justifie le quadruplet : Lea est technicienne sur Site B et
      // simple demandeuse au Siege. Ses droits dependent du profil actif, jamais
      // de l'union des deux.
      {
        userId: reference('lea'),
        profileId: reference('Technicien'),
        entityId: siteB,
        isRecursive: false,
      },
      {
        userId: reference('lea'),
        profileId: reference('Self-service'),
        entityId: siege,
        isRecursive: true,
      },

      {
        userId: reference('demandeur'),
        profileId: reference('Self-service'),
        entityId: dsi,
        isRecursive: false,
      },
    ]);

    if (supportN1) {
      await tx.insert(groupMembers).values([
        { userId: reference('thomas'), groupId: supportN1.id },
        { userId: reference('lea'), groupId: supportN1.id, isManager: true },
      ]);
    }

    // Annuaire de developpement, servi par le conteneur openldap du Compose.
    //
    // Mode `search` obligatoire : OpenLDAP n'expose pas `memberOf` sans
    // surcouche. Un Active Directory reel utiliserait le mode `attribute`.
    const [annuaire] = await tx
      .insert(ldapDirectories)
      .values({
        name: 'Annuaire de developpement',
        host: process.env.LDAP_HOST ?? 'localhost',
        port: Number(process.env.LDAP_PORT ?? '1389'),
        baseDn: 'dc=exemple,dc=fr',
        bindDn: 'cn=admin,dc=exemple,dc=fr',
        bindPasswordEncrypted: secrets.encrypt('admin'),
        userFilter: '(objectClass=inetOrgPerson)',
        groupSearchMode: 'search',
        groupBaseDn: 'ou=groups,dc=exemple,dc=fr',
        groupFilter: '(objectClass=groupOfNames)',
        groupMemberAttribute: 'member',
        isDefault: true,
      })
      .returning({ id: ldapDirectories.id });

    if (annuaire) {
      // Appartenir a un groupe d'annuaire accorde une habilitation, retiree
      // automatiquement des que l'utilisateur en sort.
      await tx.insert(ldapGroupMappings).values([
        {
          directoryId: annuaire.id,
          groupDn: 'cn=Techniciens,ou=groups,dc=exemple,dc=fr',
          profileId: reference('Technicien'),
          entityId: siteA,
          isRecursive: false,
        },
        {
          directoryId: annuaire.id,
          groupDn: 'cn=Superviseurs,ou=groups,dc=exemple,dc=fr',
          profileId: reference('Superviseur'),
          entityId: nord,
          isRecursive: true,
        },
      ]);
    }
  });

  logger.log('Jeu de demonstration cree. Mot de passe commun a tous les comptes : tick');
  logger.log("Comptes d'annuaire : thomas.ldap et sophie.ldap, mot de passe : annuaire");
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
