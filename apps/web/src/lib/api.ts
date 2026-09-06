import type {
  AddFollowup,
  Agreement,
  Calendar,
  CreateTicket,
  EntitySummary,
  ItilStatus,
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
  agreementSchema,
  calendarSchema,
  entitySummarySchema,
  formSchema,
  formSubmissionResultSchema,
  formSummarySchema,
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
export const attachmentSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
  uploadedBy: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
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

  tickets: (filtre: TicketQuery): Promise<TicketPage> =>
    request(`/tickets${toQuery(filtre)}`, ticketPageSchema),

  ticket: (id: number): Promise<TicketDetail> =>
    request(`/tickets/${String(id)}`, ticketDetailSchema),

  timeline: (id: number): Promise<TimelineEntry[]> =>
    request(`/tickets/${String(id)}/timeline`, timelineEntrySchema.array()),

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

export interface KbFilter {
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

export interface TicketQuery {
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
