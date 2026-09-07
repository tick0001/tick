import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilKind } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { ApiError, api } from '@/lib/api';

const SECTION: Record<ItilKind, 'problemes' | 'changements'> = {
  problem: 'problemes',
  change: 'changements',
};

/**
 * Liste des problèmes ou des changements.
 *
 * Une seule page pour les deux : ils partagent la colonne à la ligne près, et
 * seuls le titre et le formulaire de création changent. Deux fichiers presque
 * identiques auraient divergé dès la première correction.
 */
export function ItilObjectsPage({ kind }: { kind: ItilKind }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const section = SECTION[kind];

  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [contenu, setContenu] = useState('');

  const liste = useQuery({
    queryKey: ['itil-objects', kind, recherche],
    queryFn: () => api.itilObjects(kind, recherche ? { search: recherche } : {}),
    retry: false,
  });

  const creer = useMutation({
    mutationFn: () =>
      api.createItilObject(kind, {
        name: titre,
        content: contenu,
        urgency: 3,
        impact: 3,
        checklist: [],
      }),
    onSuccess: async () => {
      setTitre('');
      setContenu('');
      setOuvert(false);
      await queryClient.invalidateQueries({ queryKey: ['itil-objects', kind] });
    },
  });

  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short' });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (titre.trim().length > 0) creer.mutate();
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink pb-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{t(`itil.${section}.titre`)}</h2>
          <p className="text-sm text-muted">{t(`itil.${section}.description`)}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            setOuvert((valeur) => !valeur);
          }}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover"
        >
          {t(`itil.${section}.nouveau`)}
        </button>
      </header>

      {ouvert && (
        <form
          onSubmit={soumettre}
          className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card"
        >
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">
              {t('itil.formulaire.nom')}
            </span>
            <input
              value={titre}
              onChange={(event) => {
                setTitre(event.target.value);
              }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-muted">
              {t('itil.formulaire.contenu')}
            </span>
            <textarea
              value={contenu}
              rows={3}
              onChange={(event) => {
                setContenu(event.target.value);
              }}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-brand"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creer.isPending || titre.trim().length === 0}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
            >
              {t('itil.formulaire.enregistrer')}
            </button>
            <button
              type="button"
              onClick={() => {
                setOuvert(false);
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-sunken"
            >
              {t('itil.formulaire.annuler')}
            </button>
          </div>

          {creer.error && <p className="text-xs text-critical">{creer.error.message}</p>}
        </form>
      )}

      <input
        value={recherche}
        onChange={(event) => {
          setRecherche(event.target.value);
        }}
        placeholder={t('tickets.filtres.recherche')}
        className="w-56 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-brand"
      />

      {liste.error instanceof ApiError && liste.error.status === 403 && (
        <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
          {t('tickets.interdit')}
        </p>
      )}

      {liste.isPending && <p className="text-sm text-muted">{t('commun.chargement')}</p>}

      {liste.data && liste.data.length === 0 && (
        <p className="text-sm text-muted">{t(`itil.${section}.aucun`)}</p>
      )}

      {liste.data && liste.data.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sunken text-xs uppercase tracking-wide text-muted bg-surface">
              <tr>
                <th className="px-3 py-2 font-medium">{t('tickets.numero')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.statut')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.priorite')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.sujet')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.demandeurs')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.attribue')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.entite')}</th>
                <th className="px-3 py-2 font-medium">{t('tickets.ouvertLe')}</th>
              </tr>
            </thead>
            <tbody>
              {liste.data.map((objet) => (
                <tr
                  key={objet.id}
                  className="border-b border-line transition last:border-0 hover:bg-sunken"
                >
                  <td className="px-3 py-2 tabular-nums text-muted">#{objet.id}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={objet.status} />
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge value={objet.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/itil/${section === 'problemes' ? 'problems' : 'changes'}/${String(objet.id)}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {objet.name}
                    </Link>
                    {objet.categoryName && (
                      <div className="text-xs text-muted">{objet.categoryName}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{objet.requesters.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-muted">{objet.assignees.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-muted">{objet.entityName}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {dates.format(new Date(objet.dateOpened))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
