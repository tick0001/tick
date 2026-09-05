import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTicket, TicketTemplate } from '@tick/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';

const VIDE: CreateTicket = {
  name: '',
  content: '',
  type: 'incident',
  urgency: 3,
  impact: 3,
  actors: [],
};

/**
 * Création d'un ticket, pilotée par un gabarit.
 *
 * Les trois natures du gabarit se traduisent directement à l'écran : une valeur
 * préremplie initialise le champ sans le verrouiller, un champ obligatoire porte
 * une astérisque et bloque l'envoi, un champ masqué disparaît. Le serveur
 * revérifie de toute façon : le gabarit n'est pas une garantie côté client.
 */
export function NewTicketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const gabarits = useQuery({ queryKey: ['templates'], queryFn: api.templates, retry: false });
  const [gabaritId, setGabaritId] = useState<number | null>(null);
  const [saisie, setSaisie] = useState<CreateTicket>(VIDE);

  const gabarit: TicketTemplate | null = useMemo(
    () => gabarits.data?.find((modele) => modele.id === gabaritId) ?? null,
    [gabarits.data, gabaritId],
  );

  const masque = (champ: string): boolean => gabarit?.hidden.includes(champ) ?? false;
  const requis = (champ: string): boolean => gabarit?.mandatory.includes(champ) ?? false;

  const appliquerGabarit = (id: number | null): void => {
    setGabaritId(id);

    const modele = gabarits.data?.find((element) => element.id === id);

    if (!modele) return;

    setSaisie((precedent) => ({
      ...precedent,
      ...(typeof modele.predefined['type'] === 'string'
        ? { type: modele.predefined['type'] as CreateTicket['type'] }
        : {}),
      ...(typeof modele.predefined['urgency'] === 'number'
        ? { urgency: modele.predefined['urgency'] }
        : {}),
      ...(typeof modele.predefined['impact'] === 'number'
        ? { impact: modele.predefined['impact'] }
        : {}),
    }));
  };

  const creation = useMutation({
    mutationFn: () =>
      api.createTicket({ ...saisie, ...(gabaritId ? { templateId: gabaritId } : {}) }),
    onSuccess: async (ticket) => {
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void navigate(`/tickets/${String(ticket.id)}`);
    },
  });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    creation.mutate();
  };

  const champ =
    'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:focus:border-neutral-300';

  return (
    <form onSubmit={soumettre} className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{t('creation.titre')}</h2>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t('gabarits.titre')}</span>
        <select
          value={gabaritId ?? ''}
          onChange={(event) => {
            appliquerGabarit(event.target.value ? Number(event.target.value) : null);
          }}
          className={champ}
        >
          <option value="">{t('gabarits.aucun')}</option>
          {(gabarits.data ?? []).map((modele) => (
            <option key={modele.id} value={modele.id}>
              {modele.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          {t('creation.sujet')}
          {requis('name') && <span className="text-red-600"> *</span>}
        </span>
        <input
          value={saisie.name}
          required={requis('name')}
          onChange={(event) => {
            setSaisie((precedent) => ({ ...precedent, name: event.target.value }));
          }}
          className={champ}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          {t('creation.description')}
          {requis('content') && <span className="text-red-600"> *</span>}
        </span>
        <textarea
          value={saisie.content}
          required={requis('content')}
          rows={6}
          onChange={(event) => {
            setSaisie((precedent) => ({ ...precedent, content: event.target.value }));
          }}
          className={champ}
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        {!masque('type') && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('creation.type')}</span>
            <select
              value={saisie.type}
              onChange={(event) => {
                setSaisie((precedent) => ({
                  ...precedent,
                  type: event.target.value as CreateTicket['type'],
                }));
              }}
              className={champ}
            >
              <option value="incident">{t('tickets.types.incident')}</option>
              <option value="request">{t('tickets.types.request')}</option>
            </select>
          </label>
        )}

        {(['urgency', 'impact'] as const).map((cle) =>
          masque(cle) ? null : (
            <label key={cle} className="block space-y-1">
              <span className="text-sm font-medium">
                {cle === 'urgency' ? t('tickets.detail.urgence') : t('tickets.detail.impact')}
              </span>
              <select
                value={saisie[cle]}
                onChange={(event) => {
                  setSaisie((precedent) => ({ ...precedent, [cle]: Number(event.target.value) }));
                }}
                className={champ}
              >
                {[1, 2, 3, 4, 5].map((niveau) => (
                  <option key={niveau} value={niveau}>
                    {niveau}
                  </option>
                ))}
              </select>
            </label>
          ),
        )}
      </div>

      {creation.error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {creation.error.message}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={creation.isPending}
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {t('creation.creer')}
        </button>
        <button
          type="button"
          onClick={() => void navigate('/tickets')}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('creation.annuler')}
        </button>
      </div>
    </form>
  );
}
