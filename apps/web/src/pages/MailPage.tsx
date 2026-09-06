import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailAfterRead, MailCollector, UpsertMailCollector } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { BOUTON, BOUTON_PRIMAIRE, CARTE, CONTROLE } from '@/components/ui/primitives';

const APRES_LECTURE: MailAfterRead[] = ['flag', 'move', 'delete'];

function collecteurVide(profileId: number): UpsertMailCollector {
  return {
    name: '',
    host: 'localhost',
    port: 143,
    useTls: false,
    login: '',
    password: '',
    folder: 'INBOX',
    afterRead: 'flag',
    targetFolder: null,
    isActive: true,
    profileId,
    requestSourceId: null,
    createUnknownRequester: false,
    maxPerRun: 50,
  };
}

function versFormulaire(collecteur: MailCollector): UpsertMailCollector {
  return {
    name: collecteur.name,
    host: collecteur.host,
    port: collecteur.port,
    useTls: collecteur.useTls,
    login: collecteur.login,
    // Volontairement vide : laisser le champ tel quel conserve le mot de passe
    // enregistré, plutôt que de le remplacer par du vide sur une simple
    // correction de libellé.
    password: '',
    folder: collecteur.folder,
    afterRead: collecteur.afterRead,
    targetFolder: collecteur.targetFolder,
    isActive: collecteur.isActive,
    profileId: collecteur.profileId,
    requestSourceId: collecteur.requestSourceId,
    createUnknownRequester: collecteur.createUnknownRequester,
    maxPerRun: collecteur.maxPerRun,
  };
}

/**
 * Boîtes relevées, et journal de ce qu'elles ont fait.
 *
 * Le journal compte autant que la configuration : « pourquoi ce courriel n'a-t-il
 * pas créé de ticket » est la seule question qu'on pose vraiment à cet écran.
 */
export function MailPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertMailCollector } | null>(null);
  const [journal, setJournal] = useState<number | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const collecteurs = useQuery({
    queryKey: ['mail-collectors'],
    queryFn: api.mailCollectors,
    retry: false,
  });

  const logs = useQuery({
    queryKey: ['mail-logs', journal],
    queryFn: () => api.mailCollectorLogs(journal ?? 0),
    enabled: journal !== null,
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertMailCollector }) =>
      api.saveMailCollector(
        // Un mot de passe vide n'est pas envoyé : le serveur conserve le sien.
        valeurs.password ? valeurs : { ...valeurs, password: undefined },
        id,
      ),
    onSuccess: async () => {
      setEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['mail-collectors'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteMailCollector,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['mail-collectors'] }),
  });

  const relever = useMutation({
    mutationFn: api.collectMail,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['mail-collectors'] });
      await queryClient.invalidateQueries({ queryKey: ['mail-logs'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  if (collecteurs.error instanceof ApiError && collecteurs.error.status === 403) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const maj = (patch: Partial<UpsertMailCollector>): void => {
    if (!edite) return;

    setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('courriel.titre')}</h2>
          <p className="max-w-2xl text-sm text-muted">{t('courriel.intro')}</p>
        <button
          type="button"
          className={BOUTON_PRIMAIRE}
          onClick={() => {
            setEdite({ valeurs: collecteurVide(collecteurs.data?.[0]?.profileId ?? 1) });
          }}
        >
          {t('courriel.nouveau')}
        </button>
      </header>

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {collecteurs.data?.length === 0 && (
        <p className="text-sm text-muted">{t('courriel.aucun')}</p>
      )}

      <div className="grid gap-2 md:grid-cols-2">
        {collecteurs.data?.map((collecteur) => (
          <div key={collecteur.id} className={CARTE}>
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium">
                  {collecteur.name}
                  {!collecteur.isActive && (
                    <span className="ml-2 text-xs text-muted">
                      ({t('notifications.etats.cancelled')})
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {collecteur.login} · {collecteur.host}:{String(collecteur.port)} ·{' '}
                  {collecteur.folder} · {collecteur.entityName}
                </p>
                {collecteur.lastRunAt && (
                  <p className="text-xs text-muted">
                    {t('courriel.derniereReleve')} :{' '}
                    {new Date(collecteur.lastRunAt).toLocaleString()}
                  </p>
                )}
                {collecteur.lastError && (
                  <p className="text-xs text-critical">{collecteur.lastError}</p>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-1">
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    relever.mutate(collecteur.id);
                  }}
                >
                  {t('courriel.relever')}
                  {relever.data && relever.variables === collecteur.id
                    ? ` — ${String(relever.data.processed)}`
                    : ''}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    setJournal(journal === collecteur.id ? null : collecteur.id);
                  }}
                >
                  {t('courriel.journal')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    setEdite({ id: collecteur.id, valeurs: versFormulaire(collecteur) });
                  }}
                >
                  {t('commun.modifier')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    supprimer.mutate(collecteur.id);
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
          className={`${CARTE} space-y-3`}
          onSubmit={(event) => {
            event.preventDefault();
            enregistrer.mutate(edite);
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted">{t('courriel.nom')}</span>
              <input
                className={CONTROLE}
                required
                value={edite.valeurs.name}
                onChange={(event) => {
                  maj({ name: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('courriel.hote')}</span>
              <input
                className={CONTROLE}
                required
                value={edite.valeurs.host}
                onChange={(event) => {
                  maj({ host: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('courriel.port')}</span>
              <input
                type="number"
                className={CONTROLE}
                value={edite.valeurs.port}
                onChange={(event) => {
                  maj({ port: Number(event.target.value) });
                }}
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted">{t('courriel.identifiant')}</span>
              <input
                className={CONTROLE}
                required
                value={edite.valeurs.login}
                onChange={(event) => {
                  maj({ login: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted">{t('courriel.motDePasse')}</span>
              <input
                type="password"
                className={CONTROLE}
                placeholder={edite.id ? t('courriel.motDePasseInchange') : ''}
                value={edite.valeurs.password ?? ''}
                onChange={(event) => {
                  maj({ password: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('courriel.dossier')}</span>
              <input
                className={CONTROLE}
                required
                value={edite.valeurs.folder}
                onChange={(event) => {
                  maj({ folder: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('courriel.apresLecture')}</span>
              <select
                className={CONTROLE}
                value={edite.valeurs.afterRead}
                onChange={(event) => {
                  maj({ afterRead: event.target.value as MailAfterRead });
                }}
              >
                {APRES_LECTURE.map((valeur) => (
                  <option key={valeur} value={valeur}>
                    {t(`courriel.actions.${valeur}`)}
                  </option>
                ))}
              </select>
            </label>

            {edite.valeurs.afterRead === 'move' && (
              <label className="space-y-1">
                <span className="text-xs text-muted">{t('courriel.dossierCible')}</span>
                <input
                  className={CONTROLE}
                  required
                  value={edite.valeurs.targetFolder ?? ''}
                  onChange={(event) => {
                    maj({ targetFolder: event.target.value });
                  }}
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('courriel.profil')}</span>
              <input
                type="number"
                className={CONTROLE}
                required
                value={edite.valeurs.profileId}
                onChange={(event) => {
                  maj({ profileId: Number(event.target.value) });
                }}
              />
            </label>

            <div className="flex flex-col justify-end gap-1 text-sm md:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edite.valeurs.useTls}
                  onChange={(event) => {
                    maj({ useTls: event.target.checked });
                  }}
                />
                <span>{t('courriel.tls')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edite.valeurs.isActive}
                  onChange={(event) => {
                    maj({ isActive: event.target.checked });
                  }}
                />
                <span>{t('notifications.actif')}</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edite.valeurs.createUnknownRequester}
                  onChange={(event) => {
                    maj({ createUnknownRequester: event.target.checked });
                  }}
                />
                <span>{t('courriel.creerInconnu')}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button type="submit" className={BOUTON}>
              {t('commun.enregistrer')}
            </button>
            <button
              type="button"
              className={BOUTON}
              onClick={() => {
                setEdite(null);
              }}
            >
              {t('commun.annuler')}
            </button>
          </div>
        </form>
      )}

      {journal !== null && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('courriel.journal')}</h3>

          {logs.data?.length === 0 && (
            <p className="text-sm text-muted">{t('courriel.journalVide')}</p>
          )}

          {logs.data && logs.data.length > 0 && (
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-sunken">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('courriel.action')}</th>
                    <th className="px-3 py-2 font-medium">{t('courriel.expediteur')}</th>
                    <th className="px-3 py-2 font-medium">{t('notifications.sujet')}</th>
                    <th className="px-3 py-2 font-medium">{t('tickets.numero')}</th>
                    <th className="px-3 py-2 font-medium">{t('notifications.creeLe')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.data.map((ligne) => (
                    <tr
                      key={ligne.id}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-3 py-2">{t(`courriel.resultats.${ligne.action}`)}</td>
                      <td className="px-3 py-2">{ligne.sender ?? '—'}</td>
                      <td className="px-3 py-2">
                        {ligne.subject ?? '—'}
                        {ligne.detail && (
                          <span className="block text-xs text-muted">{ligne.detail}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {ligne.ticketId ? `#${String(ligne.ticketId)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {new Date(ligne.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
