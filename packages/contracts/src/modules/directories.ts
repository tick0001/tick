import { z } from 'zod';

/**
 * Mode de résolution des groupes d'un utilisateur.
 *
 * Les deux annuaires du marché ne répondent pas de la même façon :
 * Active Directory expose `memberOf` sur l'entrée utilisateur, OpenLDAP demande
 * de chercher les groupes dont l'utilisateur est membre. Ne proposer que le
 * premier reviendrait à ne fonctionner qu'avec Active Directory.
 */
export const ldapGroupSearchModeSchema = z.enum(['attribute', 'search']);
export type LdapGroupSearchMode = z.infer<typeof ldapGroupSearchModeSchema>;

export const ldapDirectorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  useTls: z.boolean(),
  bindDn: z.string().nullable(),
  /**
   * Le mot de passe du compte de service n'est jamais renvoyé.
   *
   * Seule sa présence l'est : l'écran doit pouvoir dire « un mot de passe est
   * enregistré » sans jamais le remettre en circulation.
   */
  hasBindPassword: z.boolean(),
  baseDn: z.string(),
  userFilter: z.string(),

  loginAttribute: z.string(),
  emailAttribute: z.string(),
  firstNameAttribute: z.string(),
  lastNameAttribute: z.string(),

  groupSearchMode: ldapGroupSearchModeSchema,
  memberOfAttribute: z.string(),
  groupMemberAttribute: z.string(),
  groupBaseDn: z.string().nullable(),
  groupFilter: z.string(),

  isActive: z.boolean(),
  isDefault: z.boolean(),
  timeoutMs: z.number().int(),
  lastSyncAt: z.string().nullable(),
});
export type LdapDirectory = z.infer<typeof ldapDirectorySchema>;

export const upsertLdapDirectorySchema = z.object({
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535).default(389),
  useTls: z.boolean().default(false),
  bindDn: z.string().max(500).nullish(),
  /** Absent : le mot de passe enregistré est conservé. */
  bindPassword: z.string().max(255).optional(),
  baseDn: z.string().min(1).max(500),
  userFilter: z.string().min(1).max(500).default('(objectClass=person)'),

  loginAttribute: z.string().min(1).max(120).default('uid'),
  emailAttribute: z.string().min(1).max(120).default('mail'),
  firstNameAttribute: z.string().min(1).max(120).default('givenName'),
  lastNameAttribute: z.string().min(1).max(120).default('sn'),

  groupSearchMode: ldapGroupSearchModeSchema.default('attribute'),
  memberOfAttribute: z.string().min(1).max(120).default('memberOf'),
  groupMemberAttribute: z.string().min(1).max(120).default('member'),
  groupBaseDn: z.string().max(500).nullish(),
  groupFilter: z.string().min(1).max(500).default('(objectClass=groupOfNames)'),

  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  timeoutMs: z.number().int().min(500).max(60_000).default(5000),
});
export type UpsertLdapDirectory = z.infer<typeof upsertLdapDirectorySchema>;

/**
 * Résultat d'un essai de connexion.
 *
 * Le message d'échec est celui de l'annuaire, repris tel quel : « invalid
 * credentials » et « no such object » désignent deux erreurs de configuration
 * différentes, et les fondre dans un « échec » générique obligerait à ouvrir
 * les journaux du serveur pour savoir laquelle.
 */
export const directoryTestSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** Comptes trouvés par le filtre, quand la liaison a réussi. */
  found: z.number().int().nonnegative().nullable(),
});
export type DirectoryTest = z.infer<typeof directoryTestSchema>;
