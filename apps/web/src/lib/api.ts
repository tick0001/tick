import type {
  ItilCategory,
  ItilCategoryDetail,
  ItilCategoryFilter,
  AddFollowup,
  Agreement,
  AnswerSolution,
  Calendar,
  CreateTicket,
  EntitySummary,
  ItilStatus,
  Authorization,
  BulkRequest,
  CreateEntity,
  DirectoryTest,
  EntitySettings,
  Group,
  LdapDirectory,
  Profile,
  RightObject,
  UpdateEntity,
  UpsertAuthorization,
  UpsertGroup,
  UpsertItilCategory,
  UpsertLdapDirectory,
  UpsertMember,
  UpsertProfile,
  UpsertUser,
  UserDetail,
  UserFilter,
  UserSummary,
  WriteSettings,
  BulkResult,
  CreateLink,
  Dashboard,
  ExportFormat,
  PlanningEntry,
  PlanningFilter,
  RecurringTicket,
  StatsFilter,
  StatsReport,
  StatsTrendPoint,
  UpsertDashboard,
  UpsertRecurringTicket,
  UpsertUnavailability,
  WidgetCatalogEntry,
  ItilKind,
  ItilLink,
  ItilObject,
  ItilObjectSummary,
  ItilType,
  Promote,
  PromotionResult,
  UpsertItilObject,
  Form,
  FormSubmissionResult,
  FormSummary,
  KbArticle,
  KbArticleSummary,
  KbCategory,
  KbRevision,
  Login,
  MailCollector,
  MailCollectorLog,
  NotificationEvent,
  NotificationPreference,
  NotificationQueueEntry,
  NotificationState,
  NotificationTemplate,
  PublicArticle,
  PublicArticleSummary,
  PublicSurvey,
  AnswerSurvey,
  Rule,
  RuleCollection,
  SatisfactionConfig,
  SatisfactionStats,
  RuleField,
  SavedSearch,
  SaveSearch,
  SearchField,
  SearchRequest,
  SessionContext,
  SimulationResult,
  SwitchContext,
  TicketAgreement,
  TicketDetail,
  TicketPage,
  TicketTemplate,
  TimelineEntry,
  SubmitForm,
  UpsertAgreement,
  UpsertCalendar,
  UpsertForm,
  UpsertKbArticle,
  UpsertMailCollector,
  UpsertNotificationTemplate,
  UpsertRule,
  UpsertSatisfactionConfig,
} from '@tick/contracts';
import {
  itilCategoryDetailSchema,
  itilCategorySchema,
  agreementSchema,
  calendarSchema,
  entitySummarySchema,
  formSchema,
  formSubmissionResultSchema,
  formSummarySchema,
  authorizationSchema,
  bulkResultSchema,
  directoryTestSchema,
  entitySettingsSchema,
  ldapDirectorySchema,
  dashboardSchema,
  groupSchema,
  profileSchema,
  rightObjectSchema,
  userDetailSchema,
  userSummarySchema,
  itilLinkSchema,
  itilObjectSchema,
  planningEntrySchema,
  recurringTicketSchema,
  statsReportSchema,
  statsTrendPointSchema,
  widgetCatalogEntrySchema,
  itilObjectSummarySchema,
  promotionResultSchema,
  kbArticleSchema,
  kbArticleSummarySchema,
  kbCategorySchema,
  kbRevisionSchema,
  mailCollectorLogSchema,
  mailCollectorSchema,
  notificationEventSchema,
  notificationPreferenceSchema,
  notificationQueueEntrySchema,
  notificationTemplateSchema,
  publicArticleSchema,
  publicArticleSummarySchema,
  publicSurveySchema,
  satisfactionConfigSchema,
  satisfactionStatsSchema,
  ruleFieldSchema,
  ruleSchema,
  savedSearchSchema,
  searchFieldSchema,
  sessionContextSchema,
  simulationResultSchema,
  ticketAgreementSchema,
  ticketDetailSchema,
  ticketPageSchema,
  ticketTemplateSchema,
  timelineEntrySchema,
} from '@tick/contracts';
import { z } from 'zod';

/** Piece jointe telle que l'API la renvoie. */
const attachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
  uploadedBy: z.string().nullable(),
});
type Attachment = z.infer<typeof attachmentSchema>;
import type { ZodType } from 'zod';

/**
 * Erreur portant le statut HTTP.
 *
 * Le statut compte autant que le message : un 403 sur une liste veut dire
 * « votre profil actif ne le permet pas », pas « une erreur est survenue ».
 * Confondre les deux produit des messages qui n'aident personne.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit & { parse?: boolean },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // La session est un cookie httpOnly : le navigateur doit le joindre.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;

    throw new ApiError(response.status, detail?.message ?? `HTTP ${String(response.status)}`);
  }

  return schema.parse(await response.json());
}

/** Segment d'URL de chaque objet ITIL. */
const SEGMENTS: Record<ItilType, string> = {
  ticket: 'tickets',
  problem: 'problems',
  change: 'changes',
};

/**
 * Appel sans corps de reponse.
 *
 * `request` exige un schema, ce qui n'a pas de sens pour un 204. Le refus reste
 * explicite : silencier l'echec ferait croire a l'interface que l'ecriture a eu
 * lieu, et elle reafficherait l'etat d'avant sans le dire.
 */
async function send(path: string, method: string, body?: unknown): Promise<void> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;

    throw new ApiError(response.status, detail?.message ?? `HTTP ${String(response.status)}`);
  }
}

export const api = {
  login: (credentials: Login): Promise<SessionContext> =>
    request('/auth/login', sessionContextSchema, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  session: (): Promise<SessionContext> => request('/auth/session', sessionContextSchema),

  switchContext: (target: SwitchContext): Promise<SessionContext> =>
    request('/auth/context', sessionContextSchema, {
      method: 'POST',
      body: JSON.stringify(target),
    }),

  logout: async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },

  entities: (): Promise<EntitySummary[]> => request('/entities', entitySummarySchema.array()),

  createEntity: (body: CreateEntity): Promise<EntitySummary> =>
    request('/entities', entitySummarySchema, { method: 'POST', body: JSON.stringify(body) }),

  updateEntity: (id: number, body: UpdateEntity): Promise<EntitySummary> =>
    request(`/entities/${String(id)}`, entitySummarySchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteEntity: async (id: number): Promise<void> => {
    await send(`/entities/${String(id)}`, 'DELETE');
  },

  // --- Administration -------------------------------------------------------

  rightCatalogue: (): Promise<RightObject[]> =>
    request('/admin/rights', rightObjectSchema.array()),

  users: (filtre: UserFilter): Promise<UserSummary[]> =>
    request(`/admin/users${toUserQuery(filtre)}`, userSummarySchema.array()),

  user: (id: number): Promise<UserDetail> =>
    request(`/admin/users/${String(id)}`, userDetailSchema),

  saveUser: (body: UpsertUser, id?: number): Promise<UserDetail> =>
    request(id === undefined ? '/admin/users' : `/admin/users/${String(id)}`, userDetailSchema, {
      method: id === undefined ? 'POST' : 'PUT',
      body: JSON.stringify(body),
    }),

  grant: (userId: number, body: UpsertAuthorization): Promise<Authorization[]> =>
    request(`/admin/users/${String(userId)}/authorizations`, authorizationSchema.array(), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revoke: (userId: number, entityId: number, profileId: number): Promise<Authorization[]> =>
    request(
      `/admin/users/${String(userId)}/authorizations/${String(entityId)}/${String(profileId)}`,
      authorizationSchema.array(),
      { method: 'DELETE' },
    ),

  groups: (): Promise<Group[]> => request('/admin/groups', groupSchema.array()),

  saveGroup: (body: UpsertGroup, id?: number): Promise<Group> =>
    request(id === undefined ? '/admin/groups' : `/admin/groups/${String(id)}`, groupSchema, {
      method: id === undefined ? 'POST' : 'PUT',
      body: JSON.stringify(body),
    }),

  deleteGroup: async (id: number): Promise<void> => {
    await send(`/admin/groups/${String(id)}`, 'DELETE');
  },

  addMember: (groupId: number, body: UpsertMember): Promise<Group> =>
    request(`/admin/groups/${String(groupId)}/members`, groupSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  removeMember: (groupId: number, userId: number): Promise<Group> =>
    request(`/admin/groups/${String(groupId)}/members/${String(userId)}`, groupSchema, {
      method: 'DELETE',
    }),

  profiles: (): Promise<Profile[]> => request('/admin/profiles', profileSchema.array()),

  saveProfile: (body: UpsertProfile, id?: number): Promise<Profile> =>
    request(id === undefined ? '/admin/profiles' : `/admin/profiles/${String(id)}`, profileSchema, {
      method: id === undefined ? 'POST' : 'PUT',
      body: JSON.stringify(body),
    }),

  deleteProfile: async (id: number): Promise<void> => {
    await send(`/admin/profiles/${String(id)}`, 'DELETE');
  },

  directories: (): Promise<LdapDirectory[]> =>
    request('/admin/directories', ldapDirectorySchema.array()),

  saveDirectory: (body: UpsertLdapDirectory, id?: number): Promise<LdapDirectory> =>
    request(
      id === undefined ? '/admin/directories' : `/admin/directories/${String(id)}`,
      ldapDirectorySchema,
      { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(body) },
    ),

  deleteDirectory: async (id: number): Promise<void> => {
    await send(`/admin/directories/${String(id)}`, 'DELETE');
  },

  testDirectory: (id: number): Promise<DirectoryTest> =>
    request(`/admin/directories/${String(id)}/test`, directoryTestSchema, { method: 'POST' }),

  entitySettings: (entityId: number): Promise<EntitySettings> =>
    request(`/admin/settings/${String(entityId)}`, entitySettingsSchema),

  writeEntitySettings: (entityId: number, body: WriteSettings): Promise<EntitySettings> =>
    request(`/admin/settings/${String(entityId)}`, entitySettingsSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  tickets: (filtre: TicketQuery): Promise<TicketPage> =>
    request(`/tickets${toQuery(filtre)}`, ticketPageSchema),

  ticket: (id: number): Promise<TicketDetail> =>
    request(`/tickets/${String(id)}`, ticketDetailSchema),

  timeline: (id: number): Promise<TimelineEntry[]> =>
    request(`/tickets/${String(id)}/timeline`, timelineEntrySchema.array()),

  // --- Problemes et changements -------------------------------------------
  //
  // Le segment d'URL est au pluriel, le modele au singulier : `SEGMENTS` fait
  // la conversion une seule fois, ici, plutot qu'a chaque appel.

  itilObjects: (kind: ItilKind, filtre: ItilQuery = {}): Promise<ItilObjectSummary[]> =>
    request(`/itil/${SEGMENTS[kind]}${toItilQuery(filtre)}`, itilObjectSummarySchema.array()),

  itilObject: (kind: ItilKind, id: number): Promise<ItilObject> =>
    request(`/itil/${SEGMENTS[kind]}/${String(id)}`, itilObjectSchema),

  createItilObject: (kind: ItilKind, body: UpsertItilObject): Promise<ItilObject> =>
    request(`/itil/${SEGMENTS[kind]}`, itilObjectSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateItilObject: (kind: ItilKind, id: number, body: UpsertItilObject): Promise<ItilObject> =>
    request(`/itil/${SEGMENTS[kind]}/${String(id)}`, itilObjectSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  itilTimeline: (kind: ItilKind, id: number): Promise<TimelineEntry[]> =>
    request(`/itil/${SEGMENTS[kind]}/${String(id)}/timeline`, timelineEntrySchema.array()),

  addItilFollowup: async (kind: ItilKind, id: number, body: AddFollowup): Promise<void> => {
    await send(`/itil/${SEGMENTS[kind]}/${String(id)}/followups`, 'POST', body);
  },

  links: (type: ItilType, id: number): Promise<ItilLink[]> =>
    request(`/itil/${SEGMENTS[type]}/${String(id)}/links`, itilLinkSchema.array()),

  link: (type: ItilType, id: number, body: CreateLink): Promise<ItilLink[]> =>
    request(`/itil/${SEGMENTS[type]}/${String(id)}/links`, itilLinkSchema.array(), {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  unlink: async (type: ItilType, id: number, linkId: number): Promise<void> => {
    await send(`/itil/${SEGMENTS[type]}/${String(id)}/links/${String(linkId)}`, 'DELETE');
  },

  promote: (type: ItilType, id: number, body: Promote): Promise<PromotionResult> =>
    request(`/itil/${SEGMENTS[type]}/${String(id)}/promote`, promotionResultSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // --- Pilotage -------------------------------------------------------------

  planning: (filtre: PlanningFilter): Promise<PlanningEntry[]> =>
    request(`/planning${toPlanningQuery(filtre)}`, planningEntrySchema.array()),

  /** URL de l'export iCal, ouverte par le navigateur pour qu'il gère le fichier. */
  planningIcalUrl: (filtre: PlanningFilter): string =>
    `/api/planning/ical${toPlanningQuery(filtre)}`,

  createUnavailability: async (body: UpsertUnavailability): Promise<void> => {
    await send('/planning/unavailabilities', 'POST', body);
  },

  deleteUnavailability: async (id: number): Promise<void> => {
    await send(`/planning/unavailabilities/${String(id)}`, 'DELETE');
  },

  recurring: (): Promise<RecurringTicket[]> =>
    request('/planning/recurring', recurringTicketSchema.array()),

  saveRecurring: (body: UpsertRecurringTicket, id?: number): Promise<RecurringTicket> =>
    request(
      id === undefined ? '/planning/recurring' : `/planning/recurring/${String(id)}`,
      recurringTicketSchema,
      { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(body) },
    ),

  deleteRecurring: async (id: number): Promise<void> => {
    await send(`/planning/recurring/${String(id)}`, 'DELETE');
  },

  runRecurring: (): Promise<{ created: number }> =>
    request('/planning/recurring/run', z.object({ created: z.number() }), { method: 'POST' }),

  stats: (filtre: StatsFilter): Promise<StatsReport> =>
    request(`/stats${toStatsQuery(filtre)}`, statsReportSchema),

  statsTrend: (filtre: StatsFilter): Promise<StatsTrendPoint[]> =>
    request(`/stats/trend${toStatsQuery(filtre)}`, statsTrendPointSchema.array()),

  widgetCatalog: (): Promise<WidgetCatalogEntry[]> =>
    request('/stats/widgets', widgetCatalogEntrySchema.array()),

  dashboards: (): Promise<Dashboard[]> => request('/stats/dashboards', dashboardSchema.array()),

  saveDashboard: (body: UpsertDashboard, id?: number): Promise<Dashboard> =>
    request(
      id === undefined ? '/stats/dashboards' : `/stats/dashboards/${String(id)}`,
      dashboardSchema,
      { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(body) },
    ),

  deleteDashboard: async (id: number): Promise<void> => {
    await send(`/stats/dashboards/${String(id)}`, 'DELETE');
  },

  bulk: (body: BulkRequest): Promise<BulkResult> =>
    request('/tickets/bulk', bulkResultSchema, { method: 'POST', body: JSON.stringify(body) }),

  /**
   * Export de la recherche courante.
   *
   * Le fichier passe par un objet de type `Blob` et une ancre temporaire : le
   * point d'entrée est en `POST`, parce qu'il porte l'arbre de critères, et un
   * `POST` ne se déclenche pas par un simple lien.
   */
  exportSearch: async (format: ExportFormat, body: SearchRequest): Promise<void> => {
    const response = await fetch(`/api/stats/export?format=${format}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string } | null;

      throw new ApiError(response.status, detail?.message ?? `HTTP ${String(response.status)}`);
    }

    const lien = document.createElement('a');
    const url = URL.createObjectURL(await response.blob());

    lien.href = url;
    lien.download = `tickets.${format}`;
    lien.click();
    URL.revokeObjectURL(url);
  },

  addFollowup: async (id: number, body: AddFollowup): Promise<void> => {
    const response = await fetch(`/api/tickets/${String(id)}/followups`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string } | null;

      throw new ApiError(response.status, detail?.message ?? `HTTP ${String(response.status)}`);
    }
  },

  createTicket: (body: CreateTicket): Promise<TicketDetail> =>
    request('/tickets', ticketDetailSchema, { method: 'POST', body: JSON.stringify(body) }),

  /**
   * Categories ITIL du perimetre.
   *
   * Le filtre par type est envoye au serveur plutot qu'applique ici : une
   * categorie declare a quels objets elle s'applique, et trier cote client
   * obligerait a transporter tout l'arbre pour en jeter la moitie.
   */
  itilCategories: (filtre: ItilCategoryFilter = { selectable: true }): Promise<ItilCategory[]> => {
    const params = new URLSearchParams();

    if (filtre.type) params.set('type', filtre.type);

    const chaine = params.toString();

    return request(
      `/referentials/itil-categories${chaine ? `?${chaine}` : ''}`,
      itilCategorySchema.array(),
    );
  },

  /**
   * Categories telles que la configuration les voit.
   *
   * Route distincte de `itilCategories` : celle-ci ne filtre ni sur le guichet
   * ni sur l'applicabilite, parce qu'on configure aussi ce qu'on ne propose
   * pas, et elle demande le droit correspondant.
   */
  allItilCategories: (): Promise<ItilCategoryDetail[]> =>
    request('/referentials/itil-categories/all', itilCategoryDetailSchema.array()),

  saveItilCategory: (body: UpsertItilCategory, id?: number): Promise<ItilCategoryDetail> =>
    request(
      id === undefined
        ? '/referentials/itil-categories'
        : `/referentials/itil-categories/${String(id)}`,
      itilCategoryDetailSchema,
      { method: id === undefined ? 'POST' : 'PUT', body: JSON.stringify(body) },
    ),

  deleteItilCategory: async (id: number): Promise<void> => {
    await send(`/referentials/itil-categories/${String(id)}`, 'DELETE');
  },

  templates: (): Promise<TicketTemplate[]> =>
    request('/ticket-templates', ticketTemplateSchema.array()),

  searchFields: (): Promise<SearchField[]> => request('/search/fields', searchFieldSchema.array()),

  searchTickets: (body: SearchRequest): Promise<TicketPage> =>
    request('/search/tickets', ticketPageSchema, { method: 'POST', body: JSON.stringify(body) }),

  savedSearches: (): Promise<SavedSearch[]> => request('/search/saved', savedSearchSchema.array()),

  saveSearch: (body: SaveSearch): Promise<SavedSearch> =>
    request('/search/saved', savedSearchSchema, { method: 'POST', body: JSON.stringify(body) }),

  deleteSearch: async (id: number): Promise<void> => {
    await fetch(`/api/search/saved/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  attachments: (itemType: string, itemId: number): Promise<Attachment[]> =>
    request(`/documents/items/${itemType}/${String(itemId)}`, attachmentSchema.array()),

  /**
   * Envoi d'une piece jointe.
   *
   * Pas de `Content-Type` explicite : le navigateur doit poser lui-meme la
   * frontiere multipart, et la fixer a la main casse l'envoi.
   */
  upload: async (itemType: string, itemId: number, fichier: File): Promise<Attachment> => {
    const corps = new FormData();

    corps.append('file', fichier);

    const response = await fetch(`/api/documents/items/${itemType}/${String(itemId)}`, {
      method: 'POST',
      credentials: 'include',
      body: corps,
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { message?: string } | null;

      throw new ApiError(response.status, detail?.message ?? `HTTP ${String(response.status)}`);
    }

    return attachmentSchema.parse(await response.json());
  },

  deleteAttachment: async (id: number): Promise<void> => {
    await fetch(`/api/documents/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  /**
   * Reponse du demandeur a la solution proposee.
   *
   * N'exige que la lecture du ticket : c'est **son** avis qu'on demande, et
   * l'exiger sous un droit de modification le priverait du seul geste qui lui
   * revient en propre.
   */
  answerSolution: async (id: number, body: AnswerSolution): Promise<void> => {
    await send(`/tickets/${String(id)}/solutions/answer`, 'POST', body);
  },

  setStatus: (id: number, status: ItilStatus): Promise<TicketDetail> =>
    request(`/tickets/${String(id)}`, ticketDetailSchema, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // --- Niveaux de service ----------------------------------------------------

  ticketAgreements: (id: number): Promise<TicketAgreement[]> =>
    request(`/tickets/${String(id)}/agreements`, ticketAgreementSchema.array()),

  calendars: (): Promise<Calendar[]> => request('/calendars', calendarSchema.array()),

  saveCalendar: (body: UpsertCalendar, id?: number): Promise<Calendar> =>
    request(id ? `/calendars/${String(id)}` : '/calendars', calendarSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteCalendar: async (id: number): Promise<void> => {
    await fetch(`/api/calendars/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  agreements: (): Promise<Agreement[]> => request('/agreements', agreementSchema.array()),

  saveAgreement: (body: UpsertAgreement, id?: number): Promise<Agreement> =>
    request(id ? `/agreements/${String(id)}` : '/agreements', agreementSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteAgreement: async (id: number): Promise<void> => {
    await fetch(`/api/agreements/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  // --- Regles ----------------------------------------------------------------

  rules: (collection: RuleCollection): Promise<Rule[]> =>
    request(`/rules?collection=${encodeURIComponent(collection)}`, ruleSchema.array()),

  ruleFields: (collection: RuleCollection): Promise<RuleField[]> =>
    request(`/rules/fields?collection=${encodeURIComponent(collection)}`, ruleFieldSchema.array()),

  saveRule: (body: UpsertRule, id?: number): Promise<Rule> =>
    request(id ? `/rules/${String(id)}` : '/rules', ruleSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteRule: async (id: number): Promise<void> => {
    await fetch(`/api/rules/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  reorderRules: async (ids: number[]): Promise<void> => {
    await fetch('/api/rules/reorder', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  },

  simulateRules: (
    collection: RuleCollection,
    input: Record<string, unknown>,
  ): Promise<SimulationResult> =>
    request('/rules/simulate', simulationResultSchema, {
      method: 'POST',
      body: JSON.stringify({ collection, input }),
    }),

  // --- Notifications ---------------------------------------------------------

  notificationEvents: (): Promise<NotificationEvent[]> =>
    request('/notifications/events', notificationEventSchema.array()),

  notificationVariables: (): Promise<string[]> =>
    request('/notifications/variables', z.string().array()),

  notificationTemplates: (): Promise<NotificationTemplate[]> =>
    request('/notifications/templates', notificationTemplateSchema.array()),

  saveNotificationTemplate: (
    body: UpsertNotificationTemplate,
    id?: number,
  ): Promise<NotificationTemplate> =>
    request(
      id ? `/notifications/templates/${String(id)}` : '/notifications/templates',
      notificationTemplateSchema,
      { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) },
    ),

  deleteNotificationTemplate: async (id: number): Promise<void> => {
    await fetch(`/api/notifications/templates/${String(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  },

  notificationQueue: (state?: NotificationState): Promise<NotificationQueueEntry[]> =>
    request(
      `/notifications/queue${state ? `?state=${state}` : ''}`,
      notificationQueueEntrySchema.array(),
    ),

  replayNotification: async (id: number): Promise<void> => {
    const response = await fetch(`/api/notifications/queue/${String(id)}/replay`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) throw new ApiError(response.status, `HTTP ${String(response.status)}`);
  },

  purgeNotifications: (): Promise<{ removed: number }> =>
    request('/notifications/queue/purge?days=30', z.object({ removed: z.number() }), {
      method: 'POST',
    }),

  notificationPreferences: (): Promise<NotificationPreference[]> =>
    request('/notifications/preferences', notificationPreferenceSchema.array()),

  // --- Collecteurs de courriel ----------------------------------------------

  mailCollectors: (): Promise<MailCollector[]> =>
    request('/mail-collectors', mailCollectorSchema.array()),

  mailCollectorLogs: (id: number): Promise<MailCollectorLog[]> =>
    request(`/mail-collectors/${String(id)}/logs`, mailCollectorLogSchema.array()),

  saveMailCollector: (body: UpsertMailCollector, id?: number): Promise<MailCollector> =>
    request(id ? `/mail-collectors/${String(id)}` : '/mail-collectors', mailCollectorSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteMailCollector: async (id: number): Promise<void> => {
    await fetch(`/api/mail-collectors/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  collectMail: (id: number): Promise<{ processed: number }> =>
    request(`/mail-collectors/${String(id)}/collect`, z.object({ processed: z.number() }), {
      method: 'POST',
    }),

  // --- Enquetes de satisfaction ---------------------------------------------

  satisfactionConfigs: (): Promise<SatisfactionConfig[]> =>
    request('/satisfaction/configs', satisfactionConfigSchema.array()),

  saveSatisfactionConfig: (body: UpsertSatisfactionConfig): Promise<SatisfactionConfig> =>
    request('/satisfaction/configs', satisfactionConfigSchema, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  satisfactionStats: (): Promise<SatisfactionStats> =>
    request('/satisfaction/stats', satisfactionStatsSchema),

  // --- Base de connaissances -------------------------------------------------

  kbCategories: (): Promise<KbCategory[]> => request('/kb/categories', kbCategorySchema.array()),

  kbArticles: (filtre: KbFilter = {}): Promise<KbArticleSummary[]> =>
    request(`/kb${toKbQuery(filtre)}`, kbArticleSummarySchema.array()),

  kbArticle: (id: number): Promise<KbArticle> => request(`/kb/${String(id)}`, kbArticleSchema),

  kbRevisions: (id: number): Promise<KbRevision[]> =>
    request(`/kb/${String(id)}/revisions`, kbRevisionSchema.array()),

  toggleKbFavorite: (id: number): Promise<{ isFavorite: boolean }> =>
    request(`/kb/${String(id)}/favorite`, z.object({ isFavorite: z.boolean() }), {
      method: 'POST',
    }),

  saveKbArticle: (body: UpsertKbArticle, id?: number): Promise<KbArticle> =>
    request(id ? `/kb/${String(id)}` : '/kb', kbArticleSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteKbArticle: async (id: number): Promise<void> => {
    await fetch(`/api/kb/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  // --- FAQ publique, sans session --------------------------------------------

  faq: (search?: string): Promise<PublicArticleSummary[]> =>
    request(
      `/public/faq${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      publicArticleSummarySchema.array(),
    ),

  faqArticle: (id: number): Promise<PublicArticle> =>
    request(`/public/faq/${String(id)}`, publicArticleSchema),

  // --- Catalogue de services --------------------------------------------------

  catalogue: (): Promise<FormSummary[]> => request('/catalogue', formSummarySchema.array()),

  catalogueForm: (id: number): Promise<Form> => request(`/catalogue/${String(id)}`, formSchema),

  submitForm: (id: number, body: SubmitForm): Promise<FormSubmissionResult> =>
    request(`/catalogue/${String(id)}`, formSubmissionResultSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  forms: (): Promise<Form[]> => request('/forms', formSchema.array()),

  saveForm: (body: UpsertForm, id?: number): Promise<Form> =>
    request(id ? `/forms/${String(id)}` : '/forms', formSchema, {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(body),
    }),

  deleteForm: async (id: number): Promise<void> => {
    await fetch(`/api/forms/${String(id)}`, { method: 'DELETE', credentials: 'include' });
  },

  // --- Enquete de satisfaction, sans session --------------------------------

  survey: (token: string): Promise<PublicSurvey> =>
    request(`/public/satisfaction/${encodeURIComponent(token)}`, publicSurveySchema),

  answerSurvey: async (token: string, body: AnswerSurvey): Promise<void> => {
    const response = await fetch(`/api/public/satisfaction/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new ApiError(response.status, `HTTP ${String(response.status)}`);
  },

  setNotificationPreference: async (event: string, enabled: boolean): Promise<void> => {
    await fetch('/api/notifications/preferences', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, enabled }),
    });
  },
};

function toUserQuery(filtre: UserFilter): string {
  const params = new URLSearchParams();

  if (filtre.search) params.set('search', filtre.search);
  if (filtre.inactive) params.set('inactive', 'true');

  const chaine = params.toString();

  return chaine ? `?${chaine}` : '';
}

function toPlanningQuery(filtre: PlanningFilter): string {
  const params = new URLSearchParams({ from: filtre.from, to: filtre.to });

  if (filtre.technicianId) params.set('technicianId', String(filtre.technicianId));
  if (filtre.groupId) params.set('groupId', String(filtre.groupId));

  return `?${params.toString()}`;
}

function toStatsQuery(filtre: StatsFilter): string {
  const params = new URLSearchParams({ dimension: filtre.dimension });

  if (filtre.from) params.set('from', filtre.from);
  if (filtre.to) params.set('to', filtre.to);

  return `?${params.toString()}`;
}

interface ItilQuery {
  status?: string | undefined;
  search?: string | undefined;
  deleted?: boolean | undefined;
}

function toItilQuery(filtre: ItilQuery): string {
  const params = new URLSearchParams();

  if (filtre.status) params.set('status', filtre.status);
  if (filtre.search) params.set('search', filtre.search);
  if (filtre.deleted) params.set('deleted', 'true');

  const chaine = params.toString();

  return chaine ? `?${chaine}` : '';
}

interface KbFilter {
  search?: string | undefined;
  categoryId?: number | undefined;
  faqOnly?: boolean | undefined;
  favoritesOnly?: boolean | undefined;
}

/** Meme forme que `toQuery` : listes jointes, booleens en toutes lettres. */
function toKbQuery(filtre: KbFilter): string {
  const params = new URLSearchParams();

  if (filtre.search) params.set('search', filtre.search);
  if (filtre.categoryId) params.set('categoryId', String(filtre.categoryId));
  if (filtre.faqOnly) params.set('faqOnly', 'true');
  if (filtre.favoritesOnly) params.set('favoritesOnly', 'true');

  const chaine = params.toString();

  return chaine ? `?${chaine}` : '';
}

interface TicketQuery {
  status?: ItilStatus[];
  search?: string;
  mine?: boolean;
  deleted?: boolean;
  cursor?: string;
  limit?: number;
}

/**
 * Assemble la chaîne de requête.
 *
 * Les listes sont jointes par des virgules et les booléens écrits en toutes
 * lettres : le schéma côté serveur attend cette forme, parce que `"false"` doit
 * valoir faux et non « chaîne non vide ».
 */
function toQuery(filtre: TicketQuery): string {
  const params = new URLSearchParams();

  if (filtre.status?.length) params.set('status', filtre.status.join(','));
  if (filtre.search) params.set('search', filtre.search);
  if (filtre.mine) params.set('mine', 'true');
  if (filtre.deleted) params.set('deleted', 'true');
  if (filtre.cursor) params.set('cursor', filtre.cursor);
  if (filtre.limit) params.set('limit', String(filtre.limit));

  const chaine = params.toString();

  return chaine ? `?${chaine}` : '';
}
