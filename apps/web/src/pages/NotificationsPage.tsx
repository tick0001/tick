import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Locale,
  NotificationState,
  NotificationTarget,
  NotificationTemplate,
  UpsertNotificationTemplate,
} from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

const CIBLES: NotificationTarget[] = [
  'requester',
  'observer',
  'assigned',
  'assigned_group',
  'assigned_group_manager',
  'requester_group',
  'requester_group_manager',
  'author',
  'followup_author',
  'fixed',
];

const LANGUES: Locale[] = ['fr', 'en'];

const ETATS: NotificationState[] = ['pending', 'sent', 'failed', 'cancelled'];

const champ =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950';
const bouton =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
const carte = 'rounded-lg border border-neutral-200 p-4 dark:border-neutral-800';

function modeleVide(event: string): UpsertNotificationTemplate {
  return {
    event,
    name: '',
    isActive: true,
    isRecursive: true,
    targets: [{ target: 'requester', address: null }],
    translations: [{ locale: 'fr', subject: '', bodyText: '', bodyHtml: null }],
  };
}

function versFormulaire(modele: NotificationTemplate): UpsertNotificationTemplate {
  return {
    event: modele.event,
    name: modele.name,
    isActive: modele.isActive,
    isRecursive: modele.isRecursive,
    targets: modele.targets.map((cible) => ({ ...cible })),
    translations: modele.translations.map((traduction) => ({ ...traduction })),
  };
}

/**
 * Modèles, file d'envoi et préférences.
 *
 * Les trois sur une page parce qu'ils répondent à la même question posée sous
 * trois angles : qui reçoit quoi, est-ce parti, et qu'ai-je choisi de recevoir.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertNotificationTemplate } | null>(
    null,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [filtre, setFiltre] = useState<NotificationState | ''>('');

  const evenements = useQuery({
    queryKey: ['notification-events'],
    queryFn: api.notificationEvents,
    retry: false,
  });
  const variables = useQuery({
    queryKey: ['notification-variables'],
    queryFn: api.notificationVariables,
    retry: false,
  });
  const modeles = useQuery({
    queryKey: ['notification-templates'],
    queryFn: api.notificationTemplates,
    retry: false,
  });
  const file = useQuery({
    queryKey: ['notification-queue', filtre],
    queryFn: () => api.notificationQueue(filtre === '' ? undefined : filtre),
    retry: false,
  });
  const preferences = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: api.notificationPreferences,
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertNotificationTemplate }) =>
      api.saveNotificationTemplate(valeurs, id),
    onSuccess: async () => {
      setEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteNotificationTemplate,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['notification-templates'] }),
  });

  const rejouer = useMutation({
    mutationFn: api.replayNotification,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['notification-queue'] }),
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const purger = useMutation({
    mutationFn: api.purgeNotifications,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['notification-queue'] }),
  });

  const basculer = useMutation({
    mutationFn: ({ event, enabled }: { event: string; enabled: boolean }) =>
      api.setNotificationPreference(event, enabled),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  const administrateur = !(modeles.error instanceof ApiError && modeles.error.status === 403);

  const libelleEvenement = (nom: string): string =>
    evenements.data?.find((evenement) => evenement.name === nom)?.label ?? nom;

  const majTraduction = (
    valeurs: UpsertNotificationTemplate,
    index: number,
    patch: Partial<UpsertNotificationTemplate['translations'][number]>,
  ): UpsertNotificationTemplate => ({
    ...valeurs,
    translations: valeurs.translations.map((traduction, position) =>
      position === index ? { ...traduction, ...patch } : traduction,
    ),
  });

  return (
    <section className="space-y-8">
      {erreur && <p className="text-sm text-red-600 dark:text-red-400">{erreur}</p>}

      {/* ---- Préférences, accessibles à tous ---- */}
      <div className="space-y-3">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            {t('notifications.preferences.titre')}
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t('notifications.preferences.description')}
          </p>
        </header>

        <ul className="grid gap-1 md:grid-cols-2">
          {preferences.data?.map((preference) => (
            <li key={preference.event}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={preference.enabled}
                  onChange={(event) => {
                    basculer.mutate({
                      event: preference.event,
                      enabled: event.target.checked,
                    });
                  }}
                />
                <span>{preference.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      {administrateur && (
        <>
          {/* ---- Modèles ---- */}
          <div className="space-y-3">
            <header className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight">{t('notifications.modeles')}</h2>
              <button
                type="button"
                className={bouton}
                onClick={() => {
                  setEdite({
                    valeurs: modeleVide(evenements.data?.[0]?.name ?? 'ticket.created'),
                  });
                }}
              >
                {t('notifications.nouveau')}
              </button>
            </header>

            {modeles.data?.length === 0 && (
              <p className="text-sm text-neutral-500">{t('notifications.aucun')}</p>
            )}

            <div className="grid gap-2 md:grid-cols-2">
              {modeles.data?.map((modele) => (
                <div key={modele.id} className={carte}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {modele.name}
                        {!modele.isActive && (
                          <span className="ml-2 text-xs text-neutral-500">
                            ({t('notifications.etats.cancelled')})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {libelleEvenement(modele.event)} · {modele.entityName}
                        {modele.isRecursive ? ' ↓' : ''}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {modele.targets
                          .map((cible) =>
                            cible.target === 'fixed'
                              ? (cible.address ?? t('notifications.cibles.fixed'))
                              : t(`notifications.cibles.${cible.target}`),
                          )
                          .join(', ')}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {modele.translations.map((traduction) => traduction.locale).join(' · ')}
                      </p>
                    </div>

                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={bouton}
                        onClick={() => {
                          setEdite({ id: modele.id, valeurs: versFormulaire(modele) });
                        }}
                      >
                        {t('commun.modifier')}
                      </button>
                      <button
                        type="button"
                        className={bouton}
                        onClick={() => {
                          supprimer.mutate(modele.id);
                        }}
                      >
                        {t('calendriers.supprimer')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {edite && (
              <form
                className={`${carte} space-y-3`}
                onSubmit={(event) => {
                  event.preventDefault();
                  enregistrer.mutate(edite);
                }}
              >
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs text-neutral-500">{t('notifications.nom')}</span>
                    <input
                      className={champ}
                      required
                      value={edite.valeurs.name}
                      onChange={(event) => {
                        setEdite({
                          ...edite,
                          valeurs: { ...edite.valeurs, name: event.target.value },
                        });
                      }}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-neutral-500">{t('notifications.evenement')}</span>
                    <select
                      className={champ}
                      value={edite.valeurs.event}
                      onChange={(event) => {
                        setEdite({
                          ...edite,
                          valeurs: { ...edite.valeurs, event: event.target.value },
                        });
                      }}
                    >
                      {evenements.data?.map((evenement) => (
                        <option key={evenement.name} value={evenement.name}>
                          {evenement.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-col justify-end gap-1 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={edite.valeurs.isActive}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: { ...edite.valeurs, isActive: event.target.checked },
                          });
                        }}
                      />
                      <span>{t('notifications.actif')}</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={edite.valeurs.isRecursive}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: { ...edite.valeurs, isRecursive: event.target.checked },
                          });
                        }}
                      />
                      <span>{t('commun.recursif')}</span>
                    </label>
                  </div>
                </div>

                {/* ---- Destinataires ---- */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-neutral-500">
                    {t('notifications.destinataires')}
                  </p>

                  {edite.valeurs.targets.map((cible, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <select
                        className={`${champ} w-72`}
                        value={cible.target}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: {
                              ...edite.valeurs,
                              targets: edite.valeurs.targets.map((valeur, position) =>
                                position === index
                                  ? { ...valeur, target: event.target.value as NotificationTarget }
                                  : valeur,
                              ),
                            },
                          });
                        }}
                      >
                        {CIBLES.map((valeur) => (
                          <option key={valeur} value={valeur}>
                            {t(`notifications.cibles.${valeur}`)}
                          </option>
                        ))}
                      </select>

                      {cible.target === 'fixed' && (
                        <input
                          type="email"
                          required
                          className={`${champ} w-72`}
                          placeholder={t('notifications.adresse')}
                          value={cible.address ?? ''}
                          onChange={(event) => {
                            setEdite({
                              ...edite,
                              valeurs: {
                                ...edite.valeurs,
                                targets: edite.valeurs.targets.map((valeur, position) =>
                                  position === index
                                    ? { ...valeur, address: event.target.value }
                                    : valeur,
                                ),
                              },
                            });
                          }}
                        />
                      )}

                      <button
                        type="button"
                        className={bouton}
                        onClick={() => {
                          setEdite({
                            ...edite,
                            valeurs: {
                              ...edite.valeurs,
                              targets: edite.valeurs.targets.filter(
                                (_, position) => position !== index,
                              ),
                            },
                          });
                        }}
                      >
                        {t('recherche.retirer')}
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className={bouton}
                    onClick={() => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          targets: [
                            ...edite.valeurs.targets,
                            { target: 'assigned', address: null },
                          ],
                        },
                      });
                    }}
                  >
                    {t('notifications.ajouterDestinataire')}
                  </button>
                </div>

                {/* ---- Traductions ---- */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-neutral-500">
                    {t('notifications.traductions')}
                  </p>

                  {edite.valeurs.translations.map((traduction, index) => (
                    <div
                      key={index}
                      className="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          className={`${champ} w-28`}
                          value={traduction.locale}
                          onChange={(event) => {
                            setEdite({
                              ...edite,
                              valeurs: majTraduction(edite.valeurs, index, {
                                locale: event.target.value as Locale,
                              }),
                            });
                          }}
                        >
                          {LANGUES.map((langue) => (
                            <option key={langue} value={langue}>
                              {langue}
                            </option>
                          ))}
                        </select>

                        <input
                          className={`${champ} flex-1`}
                          required
                          placeholder={t('notifications.sujet')}
                          value={traduction.subject}
                          onChange={(event) => {
                            setEdite({
                              ...edite,
                              valeurs: majTraduction(edite.valeurs, index, {
                                subject: event.target.value,
                              }),
                            });
                          }}
                        />

                        <button
                          type="button"
                          className={bouton}
                          onClick={() => {
                            setEdite({
                              ...edite,
                              valeurs: {
                                ...edite.valeurs,
                                translations: edite.valeurs.translations.filter(
                                  (_, position) => position !== index,
                                ),
                              },
                            });
                          }}
                        >
                          {t('recherche.retirer')}
                        </button>
                      </div>

                      <textarea
                        className={`${champ} h-28 font-mono`}
                        required
                        placeholder={t('notifications.corpsTexte')}
                        value={traduction.bodyText}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: majTraduction(edite.valeurs, index, {
                              bodyText: event.target.value,
                            }),
                          });
                        }}
                      />
                    </div>
                  ))}

                  <button
                    type="button"
                    className={bouton}
                    onClick={() => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          translations: [
                            ...edite.valeurs.translations,
                            { locale: 'en', subject: '', bodyText: '', bodyHtml: null },
                          ],
                        },
                      });
                    }}
                  >
                    {t('notifications.ajouterTraduction')}
                  </button>
                </div>

                <p className="text-xs text-neutral-500">
                  {t('notifications.variables')} : <code>{variables.data?.join('  ') ?? ''}</code>
                </p>

                <div className="flex gap-2">
                  <button type="submit" className={bouton}>
                    {t('commun.enregistrer')}
                  </button>
                  <button
                    type="button"
                    className={bouton}
                    onClick={() => {
                      setEdite(null);
                    }}
                  >
                    {t('commun.annuler')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* ---- File d'envoi ---- */}
          <div className="space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold tracking-tight">{t('notifications.file')}</h2>
                <select
                  className={`${champ} w-auto`}
                  value={filtre}
                  onChange={(event) => {
                    setFiltre(event.target.value as NotificationState | '');
                  }}
                >
                  <option value="">{t('notifications.tous')}</option>
                  {ETATS.map((etat) => (
                    <option key={etat} value={etat}>
                      {t(`notifications.etats.${etat}`)}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className={bouton}
                onClick={() => {
                  purger.mutate();
                }}
              >
                {t('notifications.purger')}
                {purger.data ? ` — ${String(purger.data.removed)}` : ''}
              </button>
            </header>

            {file.data?.length === 0 && (
              <p className="text-sm text-neutral-500">{t('notifications.fileVide')}</p>
            )}

            {file.data && file.data.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('notifications.etat')}</th>
                      <th className="px-3 py-2 font-medium">{t('notifications.destinataire')}</th>
                      <th className="px-3 py-2 font-medium">{t('notifications.sujet')}</th>
                      <th className="px-3 py-2 font-medium">{t('notifications.tentatives')}</th>
                      <th className="px-3 py-2 font-medium">{t('notifications.creeLe')}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {file.data.map((message) => (
                      <tr
                        key={message.id}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                      >
                        <td className="px-3 py-2">
                          <span
                            className={
                              message.state === 'failed'
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-neutral-500'
                            }
                          >
                            {t(`notifications.etats.${message.state}`)}
                          </span>
                        </td>
                        <td className="px-3 py-2">{message.recipientEmail}</td>
                        <td className="px-3 py-2">
                          {message.subject}
                          {message.lastError && (
                            <span className="block text-xs text-red-600 dark:text-red-400">
                              {message.lastError}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{message.attempts}</td>
                        <td className="px-3 py-2 text-xs text-neutral-500">
                          {new Date(message.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {message.state !== 'sent' && (
                            <button
                              type="button"
                              className={bouton}
                              onClick={() => {
                                rejouer.mutate(message.id);
                              }}
                            >
                              {t('notifications.rejouer')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
