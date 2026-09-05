import type {
  AddFollowup,
  CreateTicket,
  EntitySummary,
  ItilStatus,
  Login,
  SavedSearch,
  SaveSearch,
  SearchField,
  SearchRequest,
  SessionContext,
  SwitchContext,
  TicketDetail,
  TicketPage,
  TicketTemplate,
  TimelineEntry,
} from '@tick/contracts';
import {
  entitySummarySchema,
  savedSearchSchema,
  searchFieldSchema,
  sessionContextSchema,
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
};

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
