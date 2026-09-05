import 'reflect-metadata';

/**
 * Ce script doit etre execute compile (`node dist/cli/seed.js`), jamais par un
 * lanceur fonde sur esbuild comme tsx.
 *
 * esbuild n'emet pas `emitDecoratorMetadata` : NestJS ne voit alors aucune
 * dependance a injecter, construit les services avec des arguments manquants,
 * et echoue plus loin sur un `undefined` sans rapport apparent avec la cause.
 * L'echec est silencieux, ce qui le rend particulierement couteux.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  authorizations,
  notificationTemplateTargets,
  notificationTemplateTranslations,
  notificationTemplates,
  ticketTemplateFields,
  ticketTemplates,
  entities,
  entitySettings,
  groupMembers,
  groups,
  itilActors,
  itilCategories,
  itilFollowups,
  ldapDirectories,
  ldapGroupMappings,
  locations,
  profileRights,
  profiles,
  requestSources,
  solutionTypes,
  sql,
  taskCategories,
  tickets,
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
    ['plugin', 'read', 'recursive'],
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
    ['plugin', 'read', 'all'],
    ['plugin', 'update', 'all'],
    ['plugin', 'delete', 'all'],
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
  // Un outil en ligne de commande ne consomme pas la file : il volerait des
  // evenements a l'API et les acquitterait sans les traiter.
  process.env['RUN_EVENT_WORKER'] = 'false';

  const logger = new Logger('Amorcage');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const db = app.get(DatabaseService);
  const passwords = app.get(PasswordService);
  const secrets = app.get(SecretsService);

  const secret = await passwords.hash('tick');

  await db.asOwner(async (tx) => {
    await tx.execute(sql`
      TRUNCATE document_items, documents, notification_queue,
               notification_template_targets, notification_template_translations,
               notification_templates, notification_preferences, saved_searches,
               logs, itil_links, itil_costs, itil_validations, itil_solutions,
               itil_tasks, itil_followups, itil_actors, tickets,
               ticket_template_fields, ticket_templates, suppliers, locations,
               solution_types, task_categories, request_sources, itil_categories,
               sessions, authorizations, group_members, groups, profile_rights,
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

    // ------------------------------------------------------------------
    // Gabarit de ticket
    //
    // Prerempli, obligatoire et masque se combinent : le type et l'urgence sont
    // proposes, le titre et la description exiges, le lieu retire du formulaire.
    // ------------------------------------------------------------------
    const [gabarit] = await tx
      .insert(ticketTemplates)
      .values({
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        name: 'Incident standard',
        comment: 'Gabarit de demonstration : valeurs proposees et champs exiges.',
      })
      .returning({ id: ticketTemplates.id });

    if (gabarit) {
      await tx.insert(ticketTemplateFields).values([
        { templateId: gabarit.id, field: 'type', kind: 'predefined', value: '"incident"' },
        { templateId: gabarit.id, field: 'urgency', kind: 'predefined', value: '3' },
        { templateId: gabarit.id, field: 'impact', kind: 'predefined', value: '3' },
        { templateId: gabarit.id, field: 'name', kind: 'mandatory', value: null },
        { templateId: gabarit.id, field: 'content', kind: 'mandatory', value: null },
        { templateId: gabarit.id, field: 'locationId', kind: 'hidden', value: null },
      ]);
    }

    // ------------------------------------------------------------------
    // Modeles de notification
    //
    // Recursifs depuis la racine : toute l'organisation en herite sans avoir a
    // les redeclarer. Les destinataires sont des roles, resolus a l'envoi.
    // ------------------------------------------------------------------
    const modeles: {
      event: string;
      name: string;
      cibles: ('requester' | 'observer' | 'assigned')[];
      fr: { subject: string; body: string };
      en: { subject: string; body: string };
    }[] = [
      {
        event: 'ticket.created',
        name: 'Ouverture de ticket',
        cibles: ['requester', 'assigned'],
        fr: {
          subject: '[Tick&] Ticket #{{ ticket.id }} ouvert : {{ ticket.name }}',
          body: 'Le ticket #{{ ticket.id }} a ete ouvert.\n\nSujet : {{ ticket.name }}\nSuivi : {{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] Ticket #{{ ticket.id }} opened: {{ ticket.name }}',
          body: 'Ticket #{{ ticket.id }} has been opened.\n\nSubject: {{ ticket.name }}\nFollow: {{ ticket.url }}',
        },
      },
      {
        event: 'followup.added',
        name: 'Nouveau suivi',
        cibles: ['requester', 'assigned', 'observer'],
        fr: {
          subject: '[Tick&] Nouveau suivi sur le ticket #{{ ticket.id }}',
          body: 'Un suivi a ete ajoute au ticket #{{ ticket.id }} ({{ ticket.name }}).\n\n{{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] New followup on ticket #{{ ticket.id }}',
          body: 'A followup was added to ticket #{{ ticket.id }} ({{ ticket.name }}).\n\n{{ ticket.url }}',
        },
      },
      {
        event: 'ticket.solved',
        name: 'Ticket resolu',
        cibles: ['requester'],
        fr: {
          subject: '[Tick&] Ticket #{{ ticket.id }} resolu',
          body: 'Le ticket #{{ ticket.id }} ({{ ticket.name }}) a ete marque comme resolu.\n\n{{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] Ticket #{{ ticket.id }} solved',
          body: 'Ticket #{{ ticket.id }} ({{ ticket.name }}) has been marked as solved.\n\n{{ ticket.url }}',
        },
      },
    ];

    for (const modele of modeles) {
      const [cree] = await tx
        .insert(notificationTemplates)
        .values({
          entityId: racine,
          entityPath: 'temporaire',
          isRecursive: true,
          event: modele.event,
          name: modele.name,
        })
        .returning({ id: notificationTemplates.id });

      if (!cree) continue;

      await tx.insert(notificationTemplateTranslations).values([
        {
          templateId: cree.id,
          locale: 'fr',
          subject: modele.fr.subject,
          bodyText: modele.fr.body,
        },
        {
          templateId: cree.id,
          locale: 'en',
          subject: modele.en.subject,
          bodyText: modele.en.body,
        },
      ]);

      await tx
        .insert(notificationTemplateTargets)
        .values(modele.cibles.map((cible) => ({ templateId: cree.id, target: cible })));
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

    // ------------------------------------------------------------------
    // Referentiels ITIL
    //
    // Definis a la racine avec le drapeau recursif : utilisables partout, sans
    // avoir a les redeclarer entite par entite. C'est exactement l'usage pour
    // lequel `is_recursive` existe.
    // ------------------------------------------------------------------
    const referentielRacine = { entityId: racine, entityPath: 'temporaire', isRecursive: true };

    const creerCategorie = async (nom: string, parent: number | null): Promise<number> => {
      const [ligne] = await tx
        .insert(itilCategories)
        .values({ ...referentielRacine, parentId: parent, path: 'x', name: nom, completeName: nom })
        .returning({ id: itilCategories.id });

      if (!ligne) throw new Error(`Creation de la categorie ${nom} impossible.`);

      return ligne.id;
    };

    const materiel = await creerCategorie('Materiel', null);
    const impression = await creerCategorie('Impression', materiel);
    await creerCategorie('Poste de travail', materiel);
    const logiciel = await creerCategorie('Logiciel', null);
    const messagerie = await creerCategorie('Messagerie', logiciel);
    await creerCategorie('Acces et comptes', null);

    const [sourceTelephone] = await tx
      .insert(requestSources)
      .values([
        { ...referentielRacine, name: 'Telephone', isDefault: true },
        { ...referentielRacine, name: 'Courriel' },
        { ...referentielRacine, name: 'Guichet' },
        { ...referentielRacine, name: 'Supervision' },
      ])
      .returning({ id: requestSources.id });

    await tx.insert(taskCategories).values([
      { ...referentielRacine, parentId: null, path: 'x', name: 'Diagnostic', completeName: 'x' },
      { ...referentielRacine, parentId: null, path: 'x', name: 'Intervention', completeName: 'x' },
      { ...referentielRacine, parentId: null, path: 'x', name: 'Suivi', completeName: 'x' },
    ]);

    await tx.insert(solutionTypes).values([
      { ...referentielRacine, name: 'Correctif' },
      { ...referentielRacine, name: 'Contournement' },
      { ...referentielRacine, name: 'Sans suite' },
    ]);

    const [siteNord] = await tx
      .insert(locations)
      .values({
        ...referentielRacine,
        parentId: null,
        path: 'x',
        name: 'Batiment Nord',
        completeName: 'x',
      })
      .returning({ id: locations.id });

    // ------------------------------------------------------------------
    // Tickets de demonstration, repartis dans l'arborescence
    //
    // Leur repartition n'est pas decorative : elle permet de verifier qu'un
    // technicien de Site A ne voit pas les tickets de Site B, et qu'une portee
    // `own` ne montre que les siens.
    // ------------------------------------------------------------------
    const creerTicket = async (options: {
      entite: number;
      titre: string;
      contenu: string;
      type: 'incident' | 'request';
      statut: 'new' | 'assigned' | 'planned' | 'waiting' | 'solved' | 'closed';
      urgence: number;
      impact: number;
      priorite: number;
      categorie: number | null;
      demandeur: number;
      assigne?: number;
    }): Promise<number> => {
      const [ligne] = await tx
        .insert(tickets)
        .values({
          entityId: options.entite,
          entityPath: 'temporaire',
          name: options.titre,
          content: options.contenu,
          type: options.type,
          status: options.statut,
          urgency: options.urgence,
          impact: options.impact,
          priority: options.priorite,
          categoryId: options.categorie,
          requestSourceId: sourceTelephone?.id ?? null,
          locationId: siteNord?.id ?? null,
          createdById: options.demandeur,
          updatedById: options.demandeur,
          dateTakenIntoAccount: options.statut === 'new' ? null : new Date(),
        })
        .returning({ id: tickets.id });

      if (!ligne) throw new Error(`Creation du ticket ${options.titre} impossible.`);

      await tx.insert(itilActors).values([
        {
          itilType: 'ticket' as const,
          itilId: ligne.id,
          role: 'requester' as const,
          actorType: 'user' as const,
          actorId: options.demandeur,
        },
        ...(options.assigne
          ? [
              {
                itilType: 'ticket' as const,
                itilId: ligne.id,
                role: 'assigned' as const,
                actorType: 'user' as const,
                actorId: options.assigne,
              },
            ]
          : []),
      ]);

      return ligne.id;
    };

    const premier = await creerTicket({
      entite: siteA,
      titre: 'Imprimante du 2e etage hors service',
      contenu: 'Voyant rouge clignotant, aucun document ne sort depuis ce matin.',
      type: 'incident',
      statut: 'assigned',
      urgence: 4,
      impact: 3,
      priorite: 4,
      categorie: impression,
      demandeur: reference('demandeur'),
      assigne: reference('thomas'),
    });

    await creerTicket({
      entite: siteA,
      titre: 'Demande de licence bureautique',
      contenu: 'Nouvelle arrivee au service comptabilite, poste a equiper.',
      type: 'request',
      statut: 'new',
      urgence: 2,
      impact: 2,
      priorite: 2,
      categorie: logiciel,
      demandeur: reference('demandeur'),
    });

    await creerTicket({
      entite: siteB,
      titre: 'Messagerie inaccessible depuis l exterieur',
      contenu: 'Le webmail repond une erreur 502 depuis les acces distants.',
      type: 'incident',
      statut: 'waiting',
      urgence: 5,
      impact: 4,
      priorite: 5,
      categorie: messagerie,
      demandeur: reference('lea'),
      assigne: reference('lea'),
    });

    await creerTicket({
      entite: dsi,
      titre: 'Renouvellement du certificat du portail',
      contenu: 'Expiration dans trois semaines, prevoir le renouvellement.',
      type: 'request',
      statut: 'planned',
      urgence: 3,
      impact: 4,
      priorite: 4,
      categorie: null,
      demandeur: reference('admin'),
      assigne: reference('sophie'),
    });

    await creerTicket({
      entite: nord,
      titre: 'Poste de travail lent au demarrage',
      contenu: 'Plus de cinq minutes avant d obtenir la session.',
      type: 'incident',
      statut: 'solved',
      urgence: 2,
      impact: 1,
      priorite: 1,
      categorie: materiel,
      demandeur: reference('demandeur'),
      assigne: reference('sophie'),
    });

    // Ticket dans l'entite du demandeur : sans lui, la portee `own` ne serait
    // demontrable par aucun compte du jeu de demonstration.
    await creerTicket({
      entite: dsi,
      titre: 'Acces au partage comptabilite refuse',
      contenu: 'Message de droits insuffisants a l ouverture du dossier partage.',
      type: 'incident',
      statut: 'new',
      urgence: 3,
      impact: 2,
      priorite: 3,
      categorie: null,
      demandeur: reference('demandeur'),
    });

    await tx.insert(itilFollowups).values([
      {
        itilType: 'ticket' as const,
        itilId: premier,
        entityId: siteA,
        entityPath: 'temporaire',
        content: 'Deplacement prevu cet apres-midi pour diagnostic sur site.',
        authorId: reference('thomas'),
        source: 'interface' as const,
      },
      {
        itilType: 'ticket' as const,
        itilId: premier,
        entityId: siteA,
        entityPath: 'temporaire',
        content: 'Piece a commander : le tambour est hors garantie.',
        isPrivate: true,
        authorId: reference('thomas'),
        source: 'interface' as const,
      },
    ]);

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
