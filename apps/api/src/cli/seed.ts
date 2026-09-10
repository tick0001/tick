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
  agreementLevelActions,
  changes,
  dashboards,
  dashboardWidgets,
  recurringTickets,
  unavailabilities,
  itilLinks,
  problems,
  formDestinations,
  formQuestionConditions,
  formQuestions,
  formSections,
  forms,
  kbArticles,
  kbCategories,
  mailCollectors,
  satisfactionConfigs,
  agreementLevels,
  agreements,
  authorizations,
  calendarSegments,
  calendars,
  holidays,
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
  itilTasks,
  ldapDirectories,
  locations,
  profileRights,
  profiles,
  requestSources,
  ruleActions,
  ruleCriteria,
  rules,
  solutionTypes,
  sql,
  taskCategories,
  tickets,
  users,
  type Transaction,
} from '@tick/db';
import type { RuleActionType, RuleCollection, RuleOperator } from '@tick/contracts';
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
    // Lecture seule sur le socle ITIL : un technicien consulte le probleme
    // auquel son incident est rattache, il ne decide pas de son analyse.
    ['problem', 'read', 'entity'],
    ['change', 'read', 'entity'],
    // Le planning et les indicateurs se lisent, ils ne se configurent pas :
    // un technicien consulte son agenda, il ne cree pas de recurrence.
    ['planning', 'read', 'entity'],
    ['stats', 'read', 'entity'],
    ['entity', 'read', 'entity'],
    ['group', 'read', 'entity'],
    ['kb', 'read', 'entity'],
  ],
  Superviseur: [
    ['plugin', 'read', 'recursive'],
    ['slm', 'read', 'recursive'],
    ['rule', 'read', 'recursive'],
    ['notification', 'read', 'recursive'],
    ['mailcollector', 'read', 'recursive'],
    ['satisfaction', 'read', 'recursive'],
    ['form', 'read', 'recursive'],
    ['ticket', 'read', 'recursive'],
    ['ticket', 'create', 'recursive'],
    ['ticket', 'update', 'recursive'],
    ['ticket', 'delete', 'recursive'],
    ['problem', 'read', 'recursive'],
    ['problem', 'create', 'recursive'],
    ['problem', 'update', 'recursive'],
    ['problem', 'delete', 'recursive'],
    ['change', 'read', 'recursive'],
    ['change', 'create', 'recursive'],
    ['change', 'update', 'recursive'],
    ['change', 'delete', 'recursive'],
    ['planning', 'read', 'recursive'],
    ['planning', 'update', 'recursive'],
    ['stats', 'read', 'recursive'],
    ['recurrence', 'read', 'recursive'],
    ['recurrence', 'update', 'recursive'],
    ['entity', 'read', 'recursive'],
    ['group', 'read', 'recursive'],
    ['kb', 'read', 'recursive'],
  ],
  Administrateur: [
    ['ticket', 'read', 'all'],
    ['ticket', 'create', 'all'],
    ['ticket', 'update', 'all'],
    ['ticket', 'delete', 'all'],
    ['problem', 'read', 'all'],
    ['problem', 'create', 'all'],
    ['problem', 'update', 'all'],
    ['problem', 'delete', 'all'],
    ['change', 'read', 'all'],
    ['change', 'create', 'all'],
    ['change', 'update', 'all'],
    ['change', 'delete', 'all'],
    ['planning', 'read', 'all'],
    ['planning', 'update', 'all'],
    ['stats', 'read', 'all'],
    ['recurrence', 'read', 'all'],
    ['recurrence', 'update', 'all'],
    ['category', 'create', 'all'],
    ['category', 'update', 'all'],
    ['category', 'delete', 'all'],
    ['entity', 'read', 'all'],
    ['entity', 'create', 'all'],
    ['entity', 'update', 'all'],
    ['entity', 'delete', 'all'],
    ['group', 'read', 'all'],
    ['group', 'create', 'all'],
    ['group', 'update', 'all'],
    ['group', 'delete', 'all'],
    ['profile', 'read', 'all'],
    ['profile', 'update', 'all'],
    ['ldap', 'read', 'all'],
    ['ldap', 'update', 'all'],
    ['user', 'read', 'all'],
    ['user', 'create', 'all'],
    ['user', 'update', 'all'],
    ['kb', 'read', 'all'],
    ['plugin', 'read', 'all'],
    ['plugin', 'update', 'all'],
    ['plugin', 'delete', 'all'],
    ['slm', 'read', 'all'],
    ['slm', 'update', 'all'],
    ['rule', 'read', 'all'],
    ['rule', 'update', 'all'],
    ['notification', 'read', 'all'],
    ['notification', 'update', 'all'],
    ['mailcollector', 'read', 'all'],
    ['mailcollector', 'update', 'all'],
    ['satisfaction', 'read', 'all'],
    ['satisfaction', 'update', 'all'],
    ['kb', 'update', 'all'],
    ['form', 'read', 'all'],
    ['form', 'update', 'all'],
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
               itil_tasks, itil_followups, itil_actors, ticket_escalations,
               dashboard_widgets, dashboards, recurrence_runs, recurring_tickets,
               unavailabilities, problems, changes, tickets,
               ticket_template_fields, ticket_templates, suppliers, locations,
               solution_types, task_categories, request_sources, itil_categories,
               -- form_translations est nommee explicitement, et il le faut :
               -- la table est polymorphe, donc **sans cle etrangere**, et le
               -- CASCADE ne l'atteint pas. Omise, ses lignes survivent au
               -- RESTART IDENTITY qui remet les identifiants a 1 : la premiere
               -- section recreee heurte alors la traduction d'une section
               -- disparue, sur la cle (item_type, item_id, locale). L'amorcage
               -- echoue au deuxieme passage, pas au premier.
               form_translations,
               form_submissions, form_destinations, form_access,
               form_question_conditions, form_questions, form_sections, forms,
               kb_favorites, kb_article_targets, kb_article_revisions,
               kb_articles, kb_categories,
               satisfactions, satisfaction_configs,
               mail_collector_logs, mail_collectors,
               rule_actions, rule_criteria, rules,
               agreement_level_actions, agreement_levels, agreements,
               holidays, calendar_segments, calendars,
               sessions, authorizations, group_members, groups, profile_rights,
               profiles, entity_settings, users,
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
        // L'adresse de reponse est celle que le collecteur releve : c'est ce
        // qui ferme la boucle, une reponse au courriel revenant au ticket.
        mailFrom: 'support@exemple.fr',
        mailReplyTo: 'support@exemple.fr',
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
      cibles: ('requester' | 'observer' | 'assigned' | 'assigned_group' | 'author')[];
      fr: { subject: string; body: string };
      en: { subject: string; body: string };
    }[] = [
      {
        event: 'ticket.created',
        name: 'Ouverture de ticket',
        cibles: ['requester', 'assigned'],
        fr: {
          subject: '[Tick&] Ouverture : {{ ticket.name }}',
          body: 'Le ticket #{{ ticket.id }} a ete ouvert.\n\nSujet : {{ ticket.name }}\nSuivi : {{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] Opened: {{ ticket.name }}',
          body: 'Ticket #{{ ticket.id }} has been opened.\n\nSubject: {{ ticket.name }}\nFollow: {{ ticket.url }}',
        },
      },
      {
        event: 'followup.added',
        name: 'Nouveau suivi',
        cibles: ['requester', 'assigned', 'assigned_group', 'observer'],
        fr: {
          subject: '[Tick&] Nouveau suivi : {{ ticket.name }}',
          body: 'Un suivi a ete ajoute au ticket #{{ ticket.id }} ({{ ticket.name }}).\n\n{{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] New followup: {{ ticket.name }}',
          body: 'A followup was added to ticket #{{ ticket.id }} ({{ ticket.name }}).\n\n{{ ticket.url }}',
        },
      },
      {
        event: 'ticket.solved',
        name: 'Ticket resolu',
        cibles: ['requester'],
        fr: {
          subject: '[Tick&] Resolu : {{ ticket.name }}',
          body: 'Le ticket #{{ ticket.id }} ({{ ticket.name }}) a ete marque comme resolu.\n\n{{ ticket.url }}',
        },
        en: {
          subject: '[Tick&] Solved: {{ ticket.name }}',
          body: 'Ticket #{{ ticket.id }} ({{ ticket.name }}) has been marked as solved.\n\n{{ ticket.url }}',
        },
      },
      // Sans ce modele, l'action « notifier » d'un niveau d'escalade n'aurait
      // rien a envoyer : c'est le modele qui decide du contenu et des
      // destinataires, l'escalade ne fait que publier l'evenement.
      {
        event: 'satisfaction.requested',
        name: 'Enquete de satisfaction',
        cibles: ['requester'],
        fr: {
          subject: '[Tick&] Votre avis sur : {{ ticket.name }}',
          body: 'Votre demande a ete close. Un avis en une minute nous aide a faire mieux.\n\n{{ url }}',
        },
        en: {
          subject: '[Tick&] Your feedback on: {{ ticket.name }}',
          body: 'Your request has been closed. One minute of feedback helps us improve.\n\n{{ url }}',
        },
      },
      {
        event: 'ticket.escalated',
        name: 'Escalade',
        cibles: ['assigned', 'assigned_group'],
        fr: {
          subject: '[Tick&] Escalade : {{ ticket.name }}',
          body: "Le ticket #{{ ticket.id }} ({{ ticket.name }}) a franchi le niveau « {{ levelName }} » de l'engagement {{ agreementName }}.\n\n{{ ticket.url }}",
        },
        en: {
          subject: '[Tick&] Escalation: {{ ticket.name }}',
          body: 'Ticket #{{ ticket.id }} ({{ ticket.name }}) crossed level "{{ levelName }}" of agreement {{ agreementName }}.\n\n{{ ticket.url }}',
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

    const [sourceTelephone, sourceCourriel, sourceGuichet] = await tx
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
    /**
     * Dates et delais coherents avec le statut.
     *
     * Les delais sont en secondes, comme en production : ce sont eux que les
     * moyennes exploitent, et les inventer proportionnels au statut donne un
     * jeu lisible sans avoir a rejouer un historique complet.
     */
    const cycleDeVie = (statut: string): Record<string, unknown> => {
      if (statut === 'new') return { dateTakenIntoAccount: null };

      const maintenant = new Date();
      const base: Record<string, unknown> = {
        dateTakenIntoAccount: new Date(maintenant.getTime() - 3 * 3600_000),
        takeIntoAccountDelay: 3 * 3600,
      };

      if (statut === 'solved' || statut === 'closed') {
        base['dateSolved'] = new Date(maintenant.getTime() - 3600_000);
        base['solveDelay'] = 11 * 3600;
      }

      if (statut === 'closed') {
        base['dateClosed'] = maintenant;
        base['closeDelay'] = 12 * 3600;
      }

      return base;
    };

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
          // Les dates et delais de sortie accompagnent le statut : un ticket
          // « resolu » sans date de resolution laisserait les statistiques de
          // demonstration vides, ce qui les rendrait invisibles a l'examen.
          ...cycleDeVie(options.statut),
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

    // ---- Probleme et changement --------------------------------------------
    //
    // L'incident de l'imprimante reste ouvert : le demandeur attend toujours
    // une reponse. Le probleme qu'il revele vit a cote, dans l'entite qui en a
    // la charge, et le changement qui le corrigera est encore a planifier.
    const [probleme] = await tx
      .insert(problems)
      .values({
        entityId: nord,
        entityPath: 'temporaire',
        name: 'Pannes repetees sur le parc d impression du Site A',
        content: 'Quatre incidents en trois semaines sur le meme modele d imprimante.',
        status: 'assigned',
        urgency: 4,
        impact: 4,
        priority: 4,
        categoryId: impression,
        symptoms: 'Voyant rouge clignotant, bourrage papier signale a chaque fois.',
        causes: 'Tambours en fin de vie sur une serie livree en meme temps.',
        impacts: 'Le service comptabilite imprime au 3e etage, avec deux etages de marche.',
        createdById: reference('sophie'),
        updatedById: reference('sophie'),
      })
      .returning({ id: problems.id });

    if (!probleme) throw new Error('Probleme de demonstration non cree.');

    const [changement] = await tx
      .insert(changes)
      .values({
        entityId: nord,
        entityPath: 'temporaire',
        name: 'Remplacement du parc d impression du Site A',
        content: 'Remplacer les six imprimantes de la serie concernee.',
        status: 'planned',
        urgency: 3,
        impact: 4,
        priority: 4,
        categoryId: impression,
        deploymentPlan: 'Livraison le samedi, installation etage par etage le dimanche.',
        rollbackPlan:
          'Les anciens materiels restent stockes une semaine, reinstallables en deux heures.',
        validationPlan: 'Une impression de test par etage, et une semaine sans incident.',
        checklist: [
          { label: 'Commander les six materiels', done: true },
          { label: 'Prevenir les utilisateurs', done: false },
          { label: 'Reprendre les anciens materiels', done: false },
        ],
        createdById: reference('sophie'),
        updatedById: reference('sophie'),
      })
      .returning({ id: changes.id });

    if (!changement) throw new Error('Changement de demonstration non cree.');

    await tx.insert(itilActors).values([
      {
        itilType: 'problem' as const,
        itilId: probleme.id,
        role: 'requester' as const,
        actorType: 'user' as const,
        actorId: reference('sophie'),
      },
      {
        itilType: 'problem' as const,
        itilId: probleme.id,
        role: 'assigned' as const,
        actorType: 'user' as const,
        actorId: reference('thomas'),
      },
      {
        itilType: 'change' as const,
        itilId: changement.id,
        role: 'requester' as const,
        actorType: 'user' as const,
        actorId: reference('sophie'),
      },
    ]);

    await tx.insert(itilLinks).values([
      {
        sourceType: 'ticket' as const,
        sourceId: premier,
        targetType: 'problem' as const,
        targetId: probleme.id,
        linkType: 'linked' as const,
      },
      {
        sourceType: 'problem' as const,
        sourceId: probleme.id,
        targetType: 'change' as const,
        targetId: changement.id,
        linkType: 'linked' as const,
      },
    ]);

    // ---- Planning, recurrence et tableau de bord ----------------------------
    //
    // Les dates sont relatives a l'amorcage : un jeu de demonstration dont le
    // planning est vide parce qu'il date de six mois ne demontre rien.
    const jour = 86_400_000;
    const aujourdhui = new Date();
    const a = (joursApres: number, heure: number): Date => {
      const date = new Date(aujourdhui.getTime() + joursApres * jour);

      date.setHours(heure, 0, 0, 0);

      return date;
    };

    await tx.insert(itilTasks).values([
      {
        itilType: 'ticket' as const,
        itilId: premier,
        entityId: siteA,
        entityPath: 'temporaire',
        content: 'Diagnostic sur site, 2e etage',
        state: 'todo' as const,
        actionTime: 60,
        beginAt: a(1, 9),
        endAt: a(1, 11),
        technicianId: reference('thomas'),
        authorId: reference('thomas'),
      },
      // Chevauche volontairement la precedente : c'est ce que la detection de
      // conflits doit faire remonter, et sans exemple elle ne se voit jamais.
      {
        itilType: 'ticket' as const,
        itilId: premier,
        entityId: siteA,
        entityPath: 'temporaire',
        content: 'Commande du tambour de remplacement',
        state: 'todo' as const,
        actionTime: 15,
        beginAt: a(1, 10),
        endAt: a(1, 12),
        technicianId: reference('thomas'),
        authorId: reference('sophie'),
      },
      {
        itilType: 'ticket' as const,
        itilId: premier,
        entityId: siteA,
        entityPath: 'temporaire',
        content: 'Point hebdomadaire sur les incidents ouverts',
        state: 'information' as const,
        beginAt: a(2, 14),
        endAt: a(2, 15),
        technicianId: reference('sophie'),
        authorId: reference('sophie'),
      },
    ]);

    await tx.insert(unavailabilities).values({
      entityId: siteA,
      entityPath: 'temporaire',
      userId: reference('thomas'),
      beginAt: a(3, 0),
      endAt: a(5, 0),
      reason: 'Conges',
      createdById: reference('sophie'),
    });

    if (gabarit) {
      await tx.insert(recurringTickets).values({
        entityId: dsi,
        entityPath: 'temporaire',
        name: 'Verification hebdomadaire des sauvegardes',
        content:
          'Controler que les sauvegardes de la semaine se sont terminees, et relancer celles en echec.',
        isActive: true,
        templateId: gabarit.id,
        step: 'weekly' as const,
        interval: 1,
        beginAt: a(1, 8),
        endAt: null,
        // Deux jours d'avance : le ticket existe avant le week-end, ce qui est
        // la seule raison pour laquelle ce champ existe.
        createAheadMinutes: 2 * 24 * 60,
        nextOccurrenceAt: a(1, 8),
        createdById: reference('admin'),
      });
    }

    const [tableau] = await tx
      .insert(dashboards)
      .values({
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        name: 'Pilotage du service',
        isPublic: true,
        ownerId: reference('admin'),
      })
      .returning({ id: dashboards.id });

    if (tableau) {
      await tx.insert(dashboardWidgets).values([
        { dashboardId: tableau.id, kind: 'core.counts', title: '', position: 0, width: 12 },
        { dashboardId: tableau.id, kind: 'core.trend', title: '', position: 1, width: 12 },
        {
          dashboardId: tableau.id,
          kind: 'core.breakdown',
          title: '',
          position: 2,
          width: 6,
          config: { dimension: 'category' },
        },
        { dashboardId: tableau.id, kind: 'core.sla', title: '', position: 3, width: 3 },
        { dashboardId: tableau.id, kind: 'core.satisfaction', title: '', position: 4, width: 3 },
      ]);
    }

    // ---- Base de connaissances ---------------------------------------------
    //
    // Recursifs depuis la racine : un article ecrit une fois sert toute
    // l'organisation. Le dernier est publie dans la FAQ, donc lisible sans
    // compte — c'est une decision explicite, pas un effet de sa categorie.
    const categorieConnaissance = async (nom: string): Promise<number> => {
      const [ligne] = await tx
        .insert(kbCategories)
        .values({
          entityId: racine,
          entityPath: 'temporaire',
          isRecursive: true,
          parentId: null,
          path: 'temporaire',
          name: nom,
          completeName: nom,
        })
        .returning({ id: kbCategories.id });

      if (!ligne) throw new Error(`Categorie de connaissance ${nom} non creee.`);

      return ligne.id;
    };

    const procedures = await categorieConnaissance('Procedures');
    const pratique = await categorieConnaissance('Questions frequentes');

    await tx.insert(kbArticles).values([
      {
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        categoryId: procedures,
        name: 'Reinitialiser un mot de passe de session',
        content:
          'Ouvrir la console d administration, rechercher le compte, puis « Reinitialiser ».\n\nLe compte doit changer son mot de passe a la prochaine ouverture de session.',
        isFaq: false,
        authorId: reference('sophie'),
        updatedById: reference('sophie'),
      },
      {
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        categoryId: pratique,
        name: 'Comment suivre l avancement de ma demande ?',
        content:
          'Chaque ticket recoit un numero. Vous le retrouvez dans le courriel de confirmation, et dans « Mes demandes ».\n\nRepondre au courriel ajoute un suivi au ticket, sans avoir a se connecter.',
        isFaq: true,
        authorId: reference('sophie'),
        updatedById: reference('sophie'),
      },
      {
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        categoryId: pratique,
        name: 'Que faire si mon imprimante ne repond plus ?',
        content:
          'Verifier le voyant, le bac a papier et le cable reseau.\n\nSi le probleme persiste, ouvrez une demande depuis le catalogue de services.',
        isFaq: true,
        authorId: reference('thomas'),
        updatedById: reference('thomas'),
      },
    ]);

    // ---- Formulaire du catalogue de services -------------------------------
    //
    // Deux sections, une question conditionnelle et une correspondance
    // explicite vers les champs du ticket : c'est le formulaire qui montre
    // chaque mecanisme a la fois.
    const [formulaire] = await tx
      .insert(forms)
      .values({
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        name: 'Demande de materiel',
        description: 'Ecran, clavier, souris ou station d accueil.',
        category: 'Materiel',
        ranking: 10,
      })
      .returning({ id: forms.id });

    if (formulaire) {
      const [sectionBesoin] = await tx
        .insert(formSections)
        .values({ formId: formulaire.id, name: 'Votre besoin', ranking: 0 })
        .returning({ id: formSections.id });

      const [sectionContexte] = await tx
        .insert(formSections)
        .values({ formId: formulaire.id, name: 'Contexte', ranking: 1 })
        .returning({ id: formSections.id });

      const [questionType] = await tx
        .insert(formQuestions)
        .values({
          sectionId: sectionBesoin?.id as number,
          kind: 'select',
          label: 'Quel materiel demandez-vous ?',
          isRequired: true,
          ranking: 0,
          options: ['Ecran', 'Clavier', 'Souris', 'Station d accueil', 'Autre'],
        })
        .returning({ id: formQuestions.id });

      const [questionPrecision] = await tx
        .insert(formQuestions)
        .values({
          sectionId: sectionBesoin?.id as number,
          kind: 'text',
          label: 'Precisez le materiel souhaite',
          isRequired: true,
          ranking: 1,
        })
        .returning({ id: formQuestions.id });

      await tx.insert(formQuestions).values([
        {
          sectionId: sectionContexte?.id as number,
          kind: 'textarea',
          label: 'Pourquoi en avez-vous besoin ?',
          ranking: 0,
        },
        {
          sectionId: sectionContexte?.id as number,
          kind: 'urgency',
          label: 'Dans quel delai ?',
          ranking: 1,
          defaultValue: '3',
        },
      ]);

      // La precision ne s'affiche que si « Autre » a ete choisi : sans cela, le
      // formulaire demanderait deux fois la meme chose a tout le monde.
      if (questionType && questionPrecision) {
        await tx.insert(formQuestionConditions).values({
          questionId: questionPrecision.id,
          dependsOnId: questionType.id,
          operator: 'is',
          value: 'Autre',
        });
      }

      await tx.insert(formDestinations).values({
        formId: formulaire.id,
        kind: 'ticket',
        // Sans correspondance sur le titre, le ticket prend le nom du
        // formulaire : « Demande de materiel » se lit mieux dans une file que
        // la reponse a la premiere question, qui serait « Ecran ».
        mappings: [
          { field: 'type', source: 'literal', value: 'request' },
          { field: 'urgency', source: 'question', question: 3 },
          ...(sourceGuichet
            ? [{ field: 'requestSourceId', source: 'literal', value: String(sourceGuichet.id) }]
            : []),
        ],
      });
    }

    // ---- Enquetes de satisfaction ------------------------------------------
    //
    // Actives a la racine, recursives : toute l'arborescence en herite. Le taux
    // est volontairement eleve dans le jeu de demonstration — en production, un
    // ticket sur trois suffit a mesurer sans lasser.
    await tx.insert(satisfactionConfigs).values({
      entityId: racine,
      entityPath: 'temporaire',
      isRecursive: true,
      isActive: true,
      percentage: 100,
      delayDays: 0,
      durationDays: 30,
      reminderDays: 7,
    });

    // ---- Boite relevee de demonstration ------------------------------------
    //
    // Pointe sur GreenMail, le serveur de test du compose : SMTP et IMAP dans
    // un seul conteneur, authentification desactivee, boite creee a la volee.
    // C'est ce qui permet d'eprouver le collecteur sans compte reel.
    await tx.insert(mailCollectors).values({
      entityId: racine,
      entityPath: 'temporaire',
      name: 'Assistance (GreenMail)',
      host: 'localhost',
      port: 3143,
      useTls: false,
      login: 'support@exemple.fr',
      passwordEncrypted: secrets.encrypt('support'),
      folder: 'INBOX',
      afterRead: 'flag',
      profileId: reference('Self-service'),
      requestSourceId: sourceCourriel?.id ?? null,
      // Un expediteur inconnu est refuse : c'est le reglage sur : ouvrir la
      // creation de comptes a quiconque sait ecrire un courriel se decide, cela
      // ne s'herite pas d'un jeu de demonstration.
      createUnknownRequester: false,
    });

    // ---- Calendrier ouvre, defini une fois a la racine et partage ----------
    const [ouvre] = await tx
      .insert(calendars)
      .values({
        entityId: racine,
        entityPath: 'temporaire',
        isRecursive: true,
        name: 'Heures ouvrees',
        comment: 'Lundi au vendredi, 8h-12h et 13h-18h, heure de Paris.',
        timezone: 'Europe/Paris',
      })
      .returning({ id: calendars.id });

    if (ouvre) {
      await tx.insert(calendarSegments).values(
        [1, 2, 3, 4, 5].flatMap((weekday) => [
          { calendarId: ouvre.id, weekday, beginAt: '08:00:00', endAt: '12:00:00' },
          { calendarId: ouvre.id, weekday, beginAt: '13:00:00', endAt: '18:00:00' },
        ]),
      );

      // Les feries fixes sont perpetuels : les ressaisir chaque annee serait une
      // corvee, et les oublier fausserait toutes les echeances de mai.
      await tx.insert(holidays).values([
        { calendarId: ouvre.id, name: "Jour de l'an", day: '2026-01-01', isPerpetual: true },
        { calendarId: ouvre.id, name: 'Fete du Travail', day: '2026-05-01', isPerpetual: true },
        { calendarId: ouvre.id, name: 'Fete nationale', day: '2026-07-14', isPerpetual: true },
        { calendarId: ouvre.id, name: 'Noel', day: '2026-12-25', isPerpetual: true },
      ]);
    }

    // ---- Engagements -------------------------------------------------------
    const engagement = async (
      kind: 'sla' | 'ola',
      axis: 'tto' | 'ttr',
      name: string,
      duration: number,
    ): Promise<number> => {
      const [ligne] = await tx
        .insert(agreements)
        .values({
          entityId: racine,
          entityPath: 'temporaire',
          isRecursive: true,
          kind,
          axis,
          name,
          duration,
          calendarId: ouvre?.id ?? null,
        })
        .returning({ id: agreements.id });

      if (!ligne) throw new Error(`Engagement ${name} non cree.`);

      return ligne.id;
    };

    const priseEnCompte = await engagement('sla', 'tto', 'Prise en compte sous 2 h', 2 * 3600);
    const resolutionStandard = await engagement('sla', 'ttr', 'Resolution sous 8 h', 8 * 3600);
    const resolutionCritique = await engagement('sla', 'ttr', 'Resolution sous 4 h', 4 * 3600);
    await engagement('ola', 'ttr', 'Resolution interne sous 6 h', 6 * 3600);

    // Un rappel une heure avant l'echeance, une escalade une heure apres :
    // l'un previent, l'autre constate.
    const [rappel] = await tx
      .insert(agreementLevels)
      .values({
        agreementId: resolutionCritique,
        name: 'Rappel avant echeance',
        offsetSeconds: -3600,
      })
      .returning({ id: agreementLevels.id });

    const [escalade] = await tx
      .insert(agreementLevels)
      .values({
        agreementId: resolutionCritique,
        name: 'Escalade au superviseur',
        offsetSeconds: 3600,
      })
      .returning({ id: agreementLevels.id });

    if (rappel) {
      await tx
        .insert(agreementLevelActions)
        .values({ levelId: rappel.id, action: 'notify', value: null });
    }

    if (escalade) {
      await tx.insert(agreementLevelActions).values([
        { levelId: escalade.id, action: 'set_urgency', value: '5' },
        { levelId: escalade.id, action: 'notify', value: null },
      ]);
    }

    // ---- Regles ------------------------------------------------------------
    const regle = async (
      collection: RuleCollection,
      name: string,
      ranking: number,
      criteres: { field: string; operator: RuleOperator; value: string | null }[],
      effets: { field: string; action: RuleActionType; value: string | null }[],
    ): Promise<void> => {
      const [ligne] = await tx
        .insert(rules)
        .values({
          entityId: racine,
          entityPath: 'temporaire',
          isRecursive: true,
          collection,
          name,
          ranking,
        })
        .returning({ id: rules.id });

      if (!ligne) throw new Error(`Regle ${name} non creee.`);

      if (criteres.length > 0) {
        await tx
          .insert(ruleCriteria)
          .values(criteres.map((critere) => ({ ruleId: ligne.id, ...critere })));
      }

      await tx.insert(ruleActions).values(effets.map((effet) => ({ ruleId: ligne.id, ...effet })));
    };

    // Le dictionnaire normalise avant tout le reste : les regles suivantes
    // travaillent sur un titre deja debarrasse de son prefixe de messagerie.
    await regle(
      'dictionary.ticket',
      'Retirer le prefixe Re: des titres',
      10,
      [{ field: 'name', operator: 'regex', value: '^(?:re|tr|fwd)\\s*:\\s*(.+)$' }],
      [{ field: 'name', action: 'regex_result', value: '#1' }],
    );

    await regle(
      'ticket.create',
      'Tout ticket recoit les engagements standard',
      10,
      [],
      [
        { field: 'slaTtoId', action: 'assign', value: String(priseEnCompte) },
        { field: 'slaTtrId', action: 'assign', value: String(resolutionStandard) },
      ],
    );

    await regle(
      'ticket.create',
      'Une panne signalee urgente passe en resolution 4 h',
      20,
      [
        { field: 'name', operator: 'regex', value: '\\b(urgent|bloquant|panne totale)\\b' },
        { field: 'type', operator: 'is', value: 'incident' },
      ],
      [
        { field: 'urgency', action: 'assign', value: '5' },
        { field: 'slaTtrId', action: 'assign', value: String(resolutionCritique) },
        ...(supportN1
          ? [
              {
                field: 'assignedGroupId',
                action: 'assign' as RuleActionType,
                value: String(supportN1.id),
              },
            ]
          : []),
      ],
    );

    if (annuaire) {
      // Ce que faisait la table de correspondance, en plus expressif : le
      // critere porte sur l'appartenance a un groupe, mais rien n'empeche
      // desormais de decider sur le domaine du courriel ou sur le nom distingue.
      await regle(
        'authorization.assign',
        'Groupe Techniciens : technicien sur Site A',
        10,
        [
          {
            field: 'groups',
            operator: 'contains',
            value: 'cn=Techniciens,ou=groups,dc=exemple,dc=fr',
          },
        ],
        [
          { field: 'profileId', action: 'assign', value: String(reference('Technicien')) },
          { field: 'entityId', action: 'assign', value: String(siteA) },
        ],
      );

      await regle(
        'authorization.assign',
        'Groupe Superviseurs : superviseur sur la Filiale Nord',
        20,
        [
          {
            field: 'groups',
            operator: 'contains',
            value: 'cn=Superviseurs,ou=groups,dc=exemple,dc=fr',
          },
        ],
        [
          { field: 'profileId', action: 'assign', value: String(reference('Superviseur')) },
          { field: 'entityId', action: 'assign', value: String(nord) },
          { field: 'isRecursive', action: 'assign', value: 'true' },
        ],
      );
    }
  });

  logger.log('Jeu de demonstration cree. Mot de passe commun a tous les comptes : tick');
  logger.log("Comptes d'annuaire : thomas.ldap et sophie.ldap, mot de passe : annuaire");
  await app.close();
}

/**
 * L'amorcage, exporte pour pouvoir etre attendu.
 *
 * Le script s'execute au chargement du module, ce qui convient a la ligne de
 * commande. Mais un `import()` rend la main des que le corps du module est
 * evalue, pas quand `main()` a fini : sans cette promesse, le test d'amorcage
 * verifiait une base encore vide -- ou pire, deja peuplee par une execution
 * precedente, ce qui le faisait passer en verifiant des donnees d'avant.
 */
export const amorcage: Promise<void> = main();

// En ligne de commande, l'echec doit sortir en code non nul. Le test, lui,
// attend `amorcage` et recoit le rejet tel quel.
amorcage.catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
