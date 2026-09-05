import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SearchNode, SearchOperator } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { ApiError, api } from '@/lib/api';

interface Ligne {
  field: string;
  operator: SearchOperator;
  value: string;
}

/** Opérateurs qui n'attendent pas de valeur. */
const SANS_VALEUR: SearchOperator[] = ['isNull', 'isNotNull'];

/**
 * Texte d'une valeur de critère.
 *
 * Une recherche enregistrée peut contenir une valeur d'un type inattendu : elle
 * est rendue en JSON plutôt qu'en « [object Object] », ce qui reste corrigeable
 * à l'écran.
 */
function texte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);

  return JSON.stringify(valeur) ?? '';
}

function versArbre(lignes: Ligne[], link: 'and' | 'or'): SearchNode {
  return {
    kind: 'group',
    link,
    children: lignes
      .filter((ligne) => ligne.field)
      .map((ligne) => ({
        kind: 'criterion' as const,
        field: ligne.field,
        operator: ligne.operator,
        ...(SANS_VALEUR.includes(ligne.operator) ? {} : { value: ligne.value }),
      })),
  };
}

function versLignes(noeud: SearchNode): { lignes: Ligne[]; link: 'and' | 'or' } {
  if (noeud.kind !== 'group') {
    return {
      lignes: [
        {
          field: noeud.field ?? '',
          operator: noeud.operator ?? 'eq',
          value: texte(noeud.value),
        },
      ],
      link: 'and',
    };
  }

  return {
    link: noeud.link ?? 'and',
    lignes: (noeud.children ?? [])
      .filter((enfant) => enfant.kind === 'criterion')
      .map((enfant) => ({
        field: enfant.field ?? '',
        operator: enfant.operator ?? 'eq',
        value: texte(enfant.value),
      })),
  };
}

/**
 * Recherche multi-critères.
 *
 * Volontairement plate à ce stade : une liste de conditions reliées par « et »
 * ou « ou ». Le moteur accepte des groupes imbriqués, et l'interface saura les
 * construire — mais un constructeur d'arbre est un objet d'interface à part
 * entière, et l'immense majorité des recherches enregistrées tiennent en une
 * liste.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const champs = useQuery({ queryKey: ['searchFields'], queryFn: api.searchFields, retry: false });
  const enregistrees = useQuery({
    queryKey: ['savedSearches'],
    queryFn: api.savedSearches,
    retry: false,
  });

  const [link, setLink] = useState<'and' | 'or'>('and');
  const [lignes, setLignes] = useState<Ligne[]>([{ field: '', operator: 'eq', value: '' }]);
  const [nom, setNom] = useState('');
  const [publique, setPublique] = useState(false);

  const recherche = useMutation({
    mutationFn: () =>
      api.searchTickets({
        criteria: versArbre(lignes, link),
        sort: 'dateOpened',
        direction: 'desc',
        limit: 50,
        deleted: false,
      }),
  });

  const enregistrer = useMutation({
    mutationFn: () =>
      api.saveSearch({
        name: nom,
        target: 'ticket',
        isPublic: publique,
        isPinned: false,
        criteria: versArbre(lignes, link),
      }),
    onSuccess: async () => {
      setNom('');
      await queryClient.invalidateQueries({ queryKey: ['savedSearches'] });
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteSearch(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['savedSearches'] }),
  });

  const champDe = (cle: string) => champs.data?.find((element) => element.key === cle);
  const controle =
    'rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">{t('recherche.titre')}</h2>

        <div className="space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
            {(['and', 'or'] as const).map((valeur) => (
              <button
                key={valeur}
                type="button"
                onClick={() => {
                  setLink(valeur);
                }}
                className={`px-3 py-1 transition ${
                  link === valeur
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                {valeur === 'and' ? t('recherche.toutes') : t('recherche.aumoins')}
              </button>
            ))}
          </div>

          {lignes.map((ligne, index) => {
            const descripteur = champDe(ligne.field);

            return (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={ligne.field}
                  onChange={(event) => {
                    const suivant = champDe(event.target.value);

                    setLignes((precedent) =>
                      precedent.map((element, position) =>
                        position === index
                          ? {
                              field: event.target.value,
                              operator: suivant?.operators[0] ?? 'eq',
                              value: '',
                            }
                          : element,
                      ),
                    );
                  }}
                  className={`${controle} min-w-44`}
                >
                  <option value="">—</option>
                  {(champs.data ?? []).map((element) => (
                    <option key={element.key} value={element.key}>
                      {element.label}
                      {element.pluginId ? ` (${element.pluginId})` : ''}
                    </option>
                  ))}
                </select>

                <select
                  value={ligne.operator}
                  disabled={!descripteur}
                  onChange={(event) => {
                    setLignes((precedent) =>
                      precedent.map((element, position) =>
                        position === index
                          ? { ...element, operator: event.target.value as SearchOperator }
                          : element,
                      ),
                    );
                  }}
                  className={controle}
                >
                  {(descripteur?.operators ?? []).map((operateur) => (
                    <option key={operateur} value={operateur}>
                      {t(`recherche.operateurs.${operateur}`)}
                    </option>
                  ))}
                </select>

                {!SANS_VALEUR.includes(ligne.operator) &&
                  (descripteur?.options ? (
                    <select
                      value={ligne.value}
                      onChange={(event) => {
                        setLignes((precedent) =>
                          precedent.map((element, position) =>
                            position === index
                              ? { ...element, value: event.target.value }
                              : element,
                          ),
                        );
                      }}
                      className={controle}
                    >
                      <option value="">—</option>
                      {descripteur.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={ligne.value}
                      type={descripteur?.type === 'date' ? 'date' : 'text'}
                      onChange={(event) => {
                        setLignes((precedent) =>
                          precedent.map((element, position) =>
                            position === index
                              ? { ...element, value: event.target.value }
                              : element,
                          ),
                        );
                      }}
                      className={controle}
                    />
                  ))}

                <button
                  type="button"
                  onClick={() => {
                    setLignes((precedent) => precedent.filter((_, position) => position !== index));
                  }}
                  className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                >
                  {t('recherche.retirer')}
                </button>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setLignes((precedent) => [...precedent, { field: '', operator: 'eq', value: '' }]);
              }}
              className="text-xs underline-offset-2 hover:underline"
            >
              + {t('recherche.ajouterCritere')}
            </button>

            <button
              type="button"
              onClick={() => {
                recherche.mutate();
              }}
              disabled={recherche.isPending}
              className="ml-auto rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {t('recherche.executer')}
            </button>
          </div>
        </div>

        {recherche.error && (
          <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {recherche.error instanceof ApiError
              ? recherche.error.message
              : String(recherche.error)}
          </p>
        )}

        {recherche.data && (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('tickets.numero')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.statut')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.priorite')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.sujet')}</th>
                </tr>
              </thead>
              <tbody>
                {recherche.data.items.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                  >
                    <td className="px-3 py-2 tabular-nums text-neutral-500">#{ticket.id}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-3 py-2">
                      <PriorityBadge value={ticket.priority} />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/tickets/${String(ticket.id)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {ticket.name}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recherche.data.items.length === 0 && (
              <p className="p-3 text-sm text-neutral-500">{t('tickets.aucun')}</p>
            )}
          </div>
        )}
      </section>

      <aside className="space-y-3">
        <h3 className="text-sm font-semibold">{t('recherche.mesRecherches')}</h3>

        <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <input
            value={nom}
            onChange={(event) => {
              setNom(event.target.value);
            }}
            placeholder={t('recherche.nomRecherche')}
            className={`${controle} w-full`}
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={publique}
              onChange={(event) => {
                setPublique(event.target.checked);
              }}
            />
            {t('recherche.publique')}
          </label>
          <button
            type="button"
            disabled={nom.trim().length === 0 || enregistrer.isPending}
            onClick={() => {
              enregistrer.mutate();
            }}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs transition hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t('recherche.enregistrer')}
          </button>
        </div>

        {enregistrees.data && enregistrees.data.length === 0 && (
          <p className="text-xs text-neutral-500">{t('recherche.aucuneEnregistree')}</p>
        )}

        <ul className="space-y-1">
          {(enregistrees.data ?? []).map((element) => (
            <li
              key={element.id}
              className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-800"
            >
              <button
                type="button"
                onClick={() => {
                  const { lignes: chargees, link: liaison } = versLignes(element.criteria);

                  setLignes(chargees.length > 0 ? chargees : lignes);
                  setLink(liaison);
                }}
                className="flex-1 text-left underline-offset-2 hover:underline"
              >
                {element.name}
                {element.isPublic && (
                  <span className="ml-1 text-xs text-neutral-400">· {element.owner}</span>
                )}
              </button>
              {element.isMine && (
                <button
                  type="button"
                  onClick={() => {
                    supprimer.mutate(element.id);
                  }}
                  className="text-xs text-neutral-400 hover:text-red-600"
                  title={t('recherche.supprimer')}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
