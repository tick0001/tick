import { z } from 'zod';
import { entitySummarySchema } from './entities.js';
import { profileInterfaceSchema, rightScopeSchema } from './common.js';

export const loginSchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(1024),
});
export type Login = z.infer<typeof loginSchema>;

export const profileSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  interface: profileInterfaceSchema,
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/**
 * Une habilitation disponible : le couple entite + profil entre lesquels
 * l'utilisateur peut basculer. Un meme utilisateur peut etre technicien sur une
 * branche et simple demandeur sur une autre.
 */
export const availableContextSchema = z.object({
  entity: entitySummarySchema,
  profile: profileSummarySchema,
  isRecursive: z.boolean(),
});
export type AvailableContext = z.infer<typeof availableContextSchema>;

export const currentUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  locale: z.string(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** Etat complet de la session : qui, ou, avec quels droits. */
export const sessionContextSchema = z.object({
  user: currentUserSchema,
  entity: entitySummarySchema,
  profile: profileSummarySchema,
  includeSubEntities: z.boolean(),
  /** Droits du profil actif, sous la forme `objet:action` vers portee. */
  rights: z.record(z.string(), rightScopeSchema),
  available: z.array(availableContextSchema),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

export const switchContextSchema = z.object({
  entityId: z.number().int().positive(),
  profileId: z.number().int().positive(),
  includeSubEntities: z.boolean().default(true),
});
export type SwitchContext = z.infer<typeof switchContextSchema>;
