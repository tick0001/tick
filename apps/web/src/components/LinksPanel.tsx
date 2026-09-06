import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilKind, ItilLinkType, ItilType } from '@tick/contracts';
import { itilLinkTypeSchema, itilTypeSchema } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '@/lib/api';

/** Chemin de consultation d'un objet, quel que soit son type. */
export function cheminItil(type: ItilType, id: number): string {
  if (type === 'ticket') return `/tickets/${String(id)}`;

  return `/itil/${type === 'problem' ? 'problems' : 'changes'}/${String(id)}`;
}

/**
 * Liens et promotion d'un objet ITIL.
 *
 * Le même panneau sur les trois objets : un lien n'appartient à aucun de ses
 * deux bouts, et le présenter différemment selon celui d'où on le regarde
 * ferait croire à deux relations là où il n'y en a qu'une.
 */
export function LinksPanel({ type, id }: { type: ItilType; id: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [cibleType, setCibleType] = useState<ItilType>('ticket');
  const [cibleId, setCibleId] = useState('');
  const [nature, setNature] = useState<ItilLinkType>('linked');

  const liens = useQuery({
    queryKey: ['itil-links', type, id],
    queryFn: () => api.links(type, id),
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['itil-links'] });
  };

  const lier = useMutation({
    mutationFn: () =>
      api.link(type, id, { targetType: cibleType, targetId: Number(cibleId), linkType: nature }),
    onSuccess: async () => {
      setCibleId('');
      await rafraichir();
    },
  });

  const delier = useMutation({
    mutationFn: (linkId: number) => api.unlink(type, id, linkId),
    onSuccess: rafraichir,
  });

  const promouvoir = useMutation({
    mutationFn: (vers: ItilKind) => api.promote(type, id, { to: vers }),
    onSuccess: async (resultat) => {
      await rafraichir();
      await navigate(cheminItil(resultat.kind, resultat.id));
    },
  });

  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h3 className="text-sm font-semibold">{t('itil.liens.titre')}</h3>

      {liens.data && liens.data.length === 0 && (
        <p className="text-sm text-neutral-500">{t('itil.liens.aucun')}</p>
      )}

      <ul className="space-y-1 text-sm">
        {(liens.data ?? []).map((lien) => (
          <li key={lien.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-neutral-500">{t(`itil.natures.${lien.linkType}`)}</span>
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">
              {t(`itil.objets.${lien.targetType}`)}
            </span>
            <Link
              to={cheminItil(lien.targetType, lien.targetId)}
              className="font-medium underline-offset-2 hover:underline"
            >
              #{lien.targetId} {lien.targetName}
            </Link>
            <span className="text-xs text-neutral-500">
              {t(`tickets.statuts.${lien.targetStatus}`)}
            </span>
            <button
              type="button"
              onClick={() => {
                delier.mutate(lien.id);
              }}
              className="ml-auto text-xs text-neutral-500 underline-offset-2 hover:underline"
            >
              {t('itil.liens.retirer')}
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (Number(cibleId) > 0) lier.mutate();
        }}
        className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-900"
      >
        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">
            {t('itil.liens.type')}
          </span>
          <select
            value={nature}
            onChange={(event) => {
              setNature(itilLinkTypeSchema.parse(event.target.value));
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {itilLinkTypeSchema.options.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(`itil.natures.${valeur}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">
            {t('itil.liens.cible')}
          </span>
          <select
            value={cibleType}
            onChange={(event) => {
              setCibleType(itilTypeSchema.parse(event.target.value));
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          >
            {itilTypeSchema.options.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(`itil.objets.${valeur}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-neutral-500">
            {t('itil.liens.identifiant')}
          </span>
          <input
            value={cibleId}
            onChange={(event) => {
              setCibleId(event.target.value.replaceAll(/\D/g, ''));
            }}
            inputMode="numeric"
            className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>

        <button
          type="submit"
          disabled={lier.isPending || Number(cibleId) <= 0}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {t('itil.liens.ajouter')}
        </button>
      </form>

      {lier.error && <p className="text-xs text-red-600 dark:text-red-400">{lier.error.message}</p>}
      {delier.error && (
        <p className="text-xs text-red-600 dark:text-red-400">{delier.error.message}</p>
      )}

      <div className="space-y-2 border-t border-neutral-100 pt-3 dark:border-neutral-900">
        <h4 className="text-xs uppercase tracking-wide text-neutral-500">
          {t('itil.promotion.titre')}
        </h4>
        <p className="text-xs text-neutral-500">{t('itil.promotion.explication')}</p>

        <div className="flex flex-wrap gap-2">
          {type !== 'problem' && (
            <button
              type="button"
              disabled={promouvoir.isPending}
              onClick={() => {
                promouvoir.mutate('problem');
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('itil.promotion.versProbleme')}
            </button>
          )}
          {type !== 'change' && (
            <button
              type="button"
              disabled={promouvoir.isPending}
              onClick={() => {
                promouvoir.mutate('change');
              }}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t('itil.promotion.versChangement')}
            </button>
          )}
        </div>

        {promouvoir.error && (
          <p className="text-xs text-red-600 dark:text-red-400">{promouvoir.error.message}</p>
        )}
      </div>
    </section>
  );
}
