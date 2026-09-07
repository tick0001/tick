import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BulkAction, SearchNode, SearchOperator, SearchRequest } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { ApiError, api } from '@/lib/api';
import { SectionTitle, CONTROLE } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

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
 * Compose l'opération à partir du choix et de sa valeur.
 *
 * Le discriminant est reconstruit ici plutôt que porté par l'état : le contrat
 * associe à chaque action le type de sa valeur, et un état générique aurait
 * perdu cette garantie au premier `as`.
 */
function operation(action: BulkAction['action'], valeur: string): BulkAction {
  switch (action) {
    case 'setStatus':
      return { action, value: valeur };

    case 'setUrgency':
      return { action, value: Number(valeur) };

    case 'setCategory':
      return { action, value: valeur ? Number(valeur) : null };

    case 'assignGroup':
    case 'assignUser':
      return { action, value: Number(valeur) };

    case 'delete':
      return { action };
  }
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

  const [selection, setSelection] = useState<number[]>([]);
  const [action, setAction] = useState<BulkAction['action']>('setStatus');
  const [valeur, setValeur] = useState('');
  const [bilan, setBilan] = useState('');

  const requete = (): SearchRequest => ({
    criteria: versArbre(lignes, link),
    sort: 'dateOpened',
    direction: 'desc',
    limit: 50,
    deleted: false,
  });

  const recherche = useMutation({
    mutationFn: () => api.searchTickets(requete()),
    onSuccess: () => {
      // La sélection ne survit pas à une nouvelle recherche : garder des
      // identifiants qui ne sont plus à l'écran ferait agir sur des tickets
      // que l'on ne voit pas. Le bilan, lui, reste : l'action massive relance
      // la recherche, et l'effacer ici ferait disparaître son compte rendu au
      // moment même où il vient de s'afficher.
      setSelection([]);
    },
  });

  const exporter = useMutation({
    mutationFn: (format: 'csv' | 'pdf') => api.exportSearch(format, requete()),
  });

  const massive = useMutation({
    mutationFn: () => api.bulk({ ids: selection, operation: operation(action, valeur) }),
    onMutate: () => {
      setBilan('');
    },
    onSuccess: async (resultat) => {
      setBilan(
        `${String(resultat.applied)} ${t('actionsMassives.applique')}` +
          (resultat.failures.length > 0
            ? ` ${String(resultat.failures.length)} ${t('actionsMassives.echecs')} : ${resultat.failures
                .map((echec) => `#${String(echec.id)}`)
                .join(', ')}`
            : ''),
      );
      setSelection([]);
      recherche.mutate();
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">{t('recherche.titre')}</h2>
        <p className="max-w-2xl text-sm text-muted">{t('recherche.intro')}</p>

        <div className="space-y-2 rounded-card border border-line bg-surface p-4 shadow-card">
          <div className="flex overflow-hidden rounded-lg border border-line text-xs">
            {(['and', 'or'] as const).map((valeur) => (
              <button
                key={valeur}
                type="button"
                onClick={() => {
                  setLink(valeur);
                }}
                className={`px-3 py-1 transition ${
                  link === valeur ? 'bg-brand text-on-brand' : 'hover:bg-sunken'
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
                  className={cn(CONTROLE, 'min-w-44')}
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
                  className={CONTROLE}
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
                      className={CONTROLE}
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
                      className={CONTROLE}
                    />
                  ))}

                <button
                  type="button"
                  onClick={() => {
                    setLignes((precedent) => precedent.filter((_, position) => position !== index));
                  }}
                  className="text-xs text-muted underline-offset-2 hover:underline"
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
              className="ml-auto rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
            >
              {t('recherche.executer')}
            </button>
          </div>
        </div>

        {recherche.error && (
          <p className="rounded-md border border-critical/30 bg-critical-soft p-3 text-sm text-critical-ink">
            {recherche.error instanceof ApiError
              ? recherche.error.message
              : String(recherche.error)}
          </p>
        )}

        {recherche.data && (
          <div className="flex flex-wrap items-end gap-2">
            <span className="text-xs text-muted">
              {selection.length} {t('actionsMassives.selection')}
            </span>

            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value as BulkAction['action']);
                setValeur('');
              }}
              className={CONTROLE}
            >
              {(
                [
                  'setStatus',
                  'setUrgency',
                  'setCategory',
                  'assignGroup',
                  'assignUser',
                  'delete',
                ] as const
              ).map((valeurAction) => (
                <option key={valeurAction} value={valeurAction}>
                  {t(`actionsMassives.actions.${valeurAction}`)}
                </option>
              ))}
            </select>

            {action !== 'delete' && (
              <input
                value={valeur}
                onChange={(event) => {
                  setValeur(event.target.value);
                }}
                placeholder={action === 'setStatus' ? 'assigned' : '1'}
                className={cn(CONTROLE, 'w-28')}
              />
            )}

            <button
              type="button"
              disabled={selection.length === 0 || massive.isPending}
              onClick={() => {
                massive.mutate();
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:bg-sunken disabled:opacity-50"
            >
              {t('actionsMassives.appliquer')}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted">
                {t('exports.titre')}
              </span>
              {(['csv', 'pdf'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={exporter.isPending}
                  onClick={() => {
                    exporter.mutate(format);
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs transition hover:bg-sunken disabled:opacity-60"
                >
                  {t(`exports.${format}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {bilan && <p className="text-xs text-muted">{bilan}</p>}

        {massive.error && <p className="text-xs text-critical">{massive.error.message}</p>}

        {exporter.error && <p className="text-xs text-critical">{exporter.error.message}</p>}

        {recherche.data && (
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sunken text-xs uppercase text-muted bg-surface">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={t('actionsMassives.toutSelectionner')}
                      checked={
                        recherche.data.items.length > 0 &&
                        selection.length === recherche.data.items.length
                      }
                      onChange={(event) => {
                        setSelection(
                          event.target.checked
                            ? (recherche.data?.items.map((ticket) => ticket.id) ?? [])
                            : [],
                        );
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">{t('tickets.numero')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.statut')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.priorite')}</th>
                  <th className="px-3 py-2 font-medium">{t('tickets.sujet')}</th>
                </tr>
              </thead>
              <tbody>
                {recherche.data.items.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`#${String(ticket.id)}`}
                        checked={selection.includes(ticket.id)}
                        onChange={(event) => {
                          setSelection((precedent) =>
                            event.target.checked
                              ? [...precedent, ticket.id]
                              : precedent.filter((valeur) => valeur !== ticket.id),
                          );
                        }}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted">#{ticket.id}</td>
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
              <p className="p-3 text-sm text-muted">{t('tickets.aucun')}</p>
            )}
          </div>
        )}
      </section>

      <aside className="space-y-3">
        <SectionTitle>{t('recherche.mesRecherches')}</SectionTitle>

        {/* Le formulaire d'enregistrement n'est plus une carte dans la colonne :
            une boite bordee dans une colonne deja bordee ajoute un cadre pour
            rien, et fait paraitre la colonne vide plus vide encore. */}
        <div className="space-y-2">
          <input
            value={nom}
            onChange={(event) => {
              setNom(event.target.value);
            }}
            placeholder={t('recherche.nomRecherche')}
            className={cn(CONTROLE, 'w-full')}
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
            className="w-full rounded-lg border border-line px-2 py-1.5 text-xs transition hover:bg-sunken disabled:opacity-60"
          >
            {t('recherche.enregistrer')}
          </button>
        </div>

        {enregistrees.data && enregistrees.data.length === 0 && (
          <p className="text-xs text-muted">{t('recherche.aucuneEnregistree')}</p>
        )}

        <ul className="divide-y divide-line border-y border-line">
          {(enregistrees.data ?? []).map((element) => (
            <li key={element.id} className="flex items-center gap-2 py-1.5 text-sm">
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
                  <span className="ml-1 text-xs text-faint">· {element.owner}</span>
                )}
              </button>
              {element.isMine && (
                <button
                  type="button"
                  onClick={() => {
                    supprimer.mutate(element.id);
                  }}
                  className="text-xs text-faint hover:text-critical"
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
