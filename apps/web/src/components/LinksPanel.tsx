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
    <section className="space-y-3 rounded-card border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-semibold">{t('itil.liens.titre')}</h3>

      {liens.data && liens.data.length === 0 && (
        <p className="text-sm text-muted">{t('itil.liens.aucun')}</p>
      )}

      <ul className="space-y-1 text-sm">
        {(liens.data ?? []).map((lien) => (
          <li key={lien.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xs text-muted">{t(`itil.natures.${lien.linkType}`)}</span>
            <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">
              {t(`itil.objets.${lien.targetType}`)}
            </span>
            <Link
              to={cheminItil(lien.targetType, lien.targetId)}
              className="font-medium underline-offset-2 hover:underline"
            >
              #{lien.targetId} {lien.targetName}
            </Link>
            <span className="text-xs text-muted">
              {t(`tickets.statuts.${lien.targetStatus}`)}
            </span>
            <button
              type="button"
              onClick={() => {
                delier.mutate(lien.id);
              }}
              className="ml-auto text-xs text-muted underline-offset-2 hover:underline"
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
        className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
      >
        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-muted">
            {t('itil.liens.type')}
          </span>
          <select
            value={nature}
            onChange={(event) => {
              setNature(itilLinkTypeSchema.parse(event.target.value));
            }}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {itilLinkTypeSchema.options.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(`itil.natures.${valeur}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-muted">
            {t('itil.liens.cible')}
          </span>
          <select
            value={cibleType}
            onChange={(event) => {
              setCibleType(itilTypeSchema.parse(event.target.value));
            }}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          >
            {itilTypeSchema.options.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(`itil.objets.${valeur}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-0.5">
          <span className="block text-xs uppercase tracking-wide text-muted">
            {t('itil.liens.identifiant')}
          </span>
          <input
            value={cibleId}
            onChange={(event) => {
              setCibleId(event.target.value.replaceAll(/\D/g, ''));
            }}
            inputMode="numeric"
            className="w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={lier.isPending || Number(cibleId) <= 0}
          className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-sunken disabled:opacity-60"
        >
          {t('itil.liens.ajouter')}
        </button>
      </form>

      {lier.error && <p className="text-xs text-critical">{lier.error.message}</p>}
      {delier.error && (
        <p className="text-xs text-critical">{delier.error.message}</p>
      )}

      <div className="space-y-2 border-t border-line pt-3">
        <h4 className="text-xs uppercase tracking-wide text-muted">
          {t('itil.promotion.titre')}
        </h4>
        <p className="text-xs text-muted">{t('itil.promotion.explication')}</p>

        <div className="flex flex-wrap gap-2">
          {type !== 'problem' && (
            <button
              type="button"
              disabled={promouvoir.isPending}
              onClick={() => {
                promouvoir.mutate('problem');
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-sunken disabled:opacity-60"
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
              className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-sunken disabled:opacity-60"
            >
              {t('itil.promotion.versChangement')}
            </button>
          )}
        </div>

        {promouvoir.error && (
          <p className="text-xs text-critical">{promouvoir.error.message}</p>
        )}
      </div>
    </section>
  );
}
