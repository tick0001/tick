import { z } from 'zod';
import { profileInterfaceSchema, queryBoolean, rightScopeSchema } from './common.js';

// --- Catalogue des droits ----------------------------------------------------

/**
 * Un objet de droit, tel que l'écran de profils le présente.
 *
 * Le catalogue vient du serveur et non de l'interface : les plugins déclarent
 * leurs propres objets, et une liste figée côté client rendrait leurs droits
 * inconfigurables — donc leurs écrans inaccessibles.
 */
export const rightObjectSchema = z.object({
  object: z.string(),
  /** Libellé déjà traduit, selon la langue de la session. */
  label: z.string(),
  /** Groupe d'affichage : `itil`, `connaissance`, `configuration`, `administration`. */
  group: z.string(),
  actions: z.array(z.string()),
  /**
   * Portées qui ont un sens pour cet objet.
   *
   * Un modèle de notification n'appartient à personne : lui proposer la portée
   * « les miens » n'aurait pas de sens, et l'administrateur passerait un temps
   * certain à comprendre pourquoi le choix ne change rien.
   */
  scopes: z.array(rightScopeSchema),
});
export type RightObject = z.infer<typeof rightObjectSchema>;

// --- Profils -----------------------------------------------------------------

export const profileRightSchema = z.object({
  object: z.string(),
  action: z.string(),
  scope: rightScopeSchema,
});
export type ProfileRight = z.infer<typeof profileRightSchema>;

export const profileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  interface: profileInterfaceSchema,
  isDefault: z.boolean(),
  comment: z.string().nullable(),
  rights: z.array(profileRightSchema),
  /** Nombre d'habilitations qui s'appuient sur ce profil. */
  usageCount: z.number().int().nonnegative(),
});
export type Profile = z.infer<typeof profileSchema>;

export const upsertProfileSchema = z.object({
  name: z.string().min(1).max(120),
  interface: profileInterfaceSchema.default('standard'),
  isDefault: z.boolean().default(false),
  comment: z.string().max(500).nullish(),
  rights: z.array(profileRightSchema).max(400).default([]),
});
export type UpsertProfile = z.infer<typeof upsertProfileSchema>;

// --- Utilisateurs ------------------------------------------------------------

/** Une habilitation, vue depuis l'utilisateur qui la porte. */
export const authorizationSchema = z.object({
  entityId: z.number().int(),
  entityName: z.string(),
  profileId: z.number().int(),
  profileName: z.string(),
  isRecursive: z.boolean(),
  /** Posée par une règle d'annuaire : elle se révoque toute seule. */
  isDynamic: z.boolean(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

export const userSummarySchema = z.object({
  id: z.number().int().positive(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  authSource: z.enum(['local', 'ldap']),
  isActive: z.boolean(),
  locale: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  authorizationCount: z.number().int().nonnegative(),
  groups: z.array(z.string()),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userDetailSchema = userSummarySchema.extend({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  authorizations: z.array(authorizationSchema),
});
export type UserDetail = z.infer<typeof userDetailSchema>;

export const upsertUserSchema = z.object({
  username: z.string().min(1).max(120),
  firstName: z.string().max(120).nullish(),
  lastName: z.string().max(120).nullish(),
  email: z.string().max(255).nullish(),
  locale: z.string().max(10).nullish(),
  isActive: z.boolean().default(true),
  /**
   * Mot de passe, à la création ou à la réinitialisation.
   *
   * Absent : le mot de passe existant est conservé. Une chaîne vide n'est pas
   * un effacement : elle est refusée, parce que « vider » un mot de passe est
   * toujours une erreur de saisie, jamais une intention.
   */
  password: z.string().min(8).max(200).optional(),
});
export type UpsertUser = z.infer<typeof upsertUserSchema>;

export const upsertAuthorizationSchema = z.object({
  entityId: z.number().int().positive(),
  profileId: z.number().int().positive(),
  isRecursive: z.boolean().default(true),
});
export type UpsertAuthorization = z.infer<typeof upsertAuthorizationSchema>;

export const userFilterSchema = z.object({
  search: z.string().max(200).optional(),
  /** Inclure les comptes désactivés. */
  inactive: queryBoolean.default(false),
});
export type UserFilter = z.infer<typeof userFilterSchema>;

// --- Groupes -----------------------------------------------------------------

export const groupMemberSchema = z.object({
  userId: z.number().int(),
  displayName: z.string(),
  isManager: z.boolean(),
  isDynamic: z.boolean(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  completeName: z.string(),
  comment: z.string().nullable(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  isRequester: z.boolean(),
  isAssignable: z.boolean(),
  members: z.array(groupMemberSchema),
});
export type Group = z.infer<typeof groupSchema>;

export const upsertGroupSchema = z.object({
  name: z.string().min(1).max(120),
  comment: z.string().max(500).nullish(),
  isRecursive: z.boolean().default(false),
  isRequester: z.boolean().default(true),
  isAssignable: z.boolean().default(true),
});
export type UpsertGroup = z.infer<typeof upsertGroupSchema>;

export const upsertMemberSchema = z.object({
  userId: z.number().int().positive(),
  isManager: z.boolean().default(false),
});
export type UpsertMember = z.infer<typeof upsertMemberSchema>;
