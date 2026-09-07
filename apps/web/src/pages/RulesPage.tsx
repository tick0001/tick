import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Rule,
  RuleActionType,
  RuleCollection,
  RuleField,
  RuleOperator,
  SimulationResult,
  UpsertRule,
} from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';
import { BOUTON, BOUTON_PRIMAIRE, CARTE, CONTROLE } from '@/components/ui/primitives';

const COLLECTIONS: RuleCollection[] = [
  'ticket.create',
  'ticket.update',
  'dictionary.ticket',
  'authorization.assign',
  'entity.assign',
];

/**
 * Clé de traduction d'une collection.
 *
 * Les identifiants de collection contiennent un point, que la bibliothèque de
 * traduction lit comme un séparateur de niveau : les traduire directement
 * ferait chercher une clé imbriquée qui n'existe pas.
 */
const LIBELLE_COLLECTION: Record<RuleCollection, string> = {
  'ticket.create': 'ticketCreate',
  'ticket.update': 'ticketUpdate',
  'dictionary.ticket': 'dictionaryTicket',
  'authorization.assign': 'authorizationAssign',
  'entity.assign': 'entityAssign',
};

/** Opérateurs qui n'attendent aucune valeur : la saisir n'aurait aucun sens. */
const SANS_VALEUR: readonly RuleOperator[] = ['is_empty', 'is_not_empty'];

function regleVide(collection: RuleCollection): UpsertRule {
  return {
    collection,
    name: '',
    description: null,
    ranking: 100,
    isActive: true,
    matchAll: true,
    stopAfter: false,
    isRecursive: true,
    criteria: [],
    actions: [],
  };
}

function versFormulaire(regle: Rule): UpsertRule {
  return {
    collection: regle.collection,
    name: regle.name,
    description: regle.description,
    ranking: regle.ranking,
    isActive: regle.isActive,
    matchAll: regle.matchAll,
    stopAfter: regle.stopAfter,
    isRecursive: regle.isRecursive,
    criteria: regle.criteria.map((critere) => ({ ...critere })),
    actions: regle.actions.map((action) => ({ ...action })),
  };
}

/**
 * Édition des règles, collection par collection.
 *
 * L'ordre est éditable en place : deux règles qui décident du même champ ne se
 * distinguent que par leur rang, et le lire ailleurs que dans la liste serait
 * illisible.
 */
export function RulesPage() {
  const { t } = useTranslation();
  const peutEcrire = usePeut('rule', 'update');
  const queryClient = useQueryClient();

  const [collection, setCollection] = useState<RuleCollection>('ticket.create');
  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertRule } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [entree, setEntree] = useState('{\n"name":"Incident bloquant",\n"type":"incident"\n}');
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  const regles = useQuery({
    queryKey: ['rules', collection],
    queryFn: () => api.rules(collection),
    retry: false,
  });

  const champsDisponibles = useQuery({
    queryKey: ['rule-fields', collection],
    queryFn: () => api.ruleFields(collection),
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertRule }) =>
      api.saveRule(valeurs, id),
    onSuccess: async () => {
      setEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['rules', collection] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteRule,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['rules', collection] }),
  });

  const reordonner = useMutation({
    mutationFn: api.reorderRules,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['rules', collection] }),
  });

  const simuler = useMutation({
    mutationFn: (valeurs: Record<string, unknown>) => api.simulateRules(collection, valeurs),
    onSuccess: (resultat) => {
      setSimulation(resultat);
      setErreur(null);
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  if (regles.error instanceof ApiError && regles.error.status === 403) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const criteres = (champsDisponibles.data ?? []).filter(
    (definition: RuleField) => definition.operators.length > 0,
  );
  const effets = (champsDisponibles.data ?? []).filter(
    (definition: RuleField) => definition.actions.length > 0,
  );

  const definitionDe = (cle: string): RuleField | undefined =>
    champsDisponibles.data?.find((definition) => definition.key === cle);

  /** Déplace une règle d'un cran et renvoie le nouvel ordre au serveur. */
  const deplacer = (index: number, pas: number): void => {
    const liste = [...(regles.data ?? [])];
    const cible = index + pas;
    const source = liste[index];
    const echange = liste[cible];

    if (!source || !echange) return;

    liste[index] = echange;
    liste[cible] = source;
    reordonner.mutate(liste.map((regle) => regle.id));
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{t('regles.titre')}</h2>
          <p className="max-w-2xl text-sm text-muted">{t('regles.intro')}</p>
          <select
            className={`${CONTROLE} w-auto`}
            value={collection}
            onChange={(event) => {
              setCollection(event.target.value as RuleCollection);
              setEdite(null);
              setSimulation(null);
            }}
          >
            {COLLECTIONS.map((valeur) => (
              <option key={valeur} value={valeur}>
                {t(
                  `regles.collections.${LIBELLE_COLLECTION[valeur]}` as 'regles.collections.ticketCreate',
                )}
              </option>
            ))}
          </select>
        </div>

        {peutEcrire && (
          <button
            type="button"
            className={BOUTON_PRIMAIRE}
            onClick={() => {
              setEdite({ valeurs: regleVide(collection) });
            }}
          >
            {t('regles.nouvelle')}
          </button>
        )}
      </header>

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {regles.data?.length === 0 && <p className="text-sm text-muted">{t('regles.aucune')}</p>}

      <ol className="space-y-2">
        {regles.data?.map((regle, index) => (
          <li key={regle.id} className={CARTE}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="font-medium">
                  <span className="mr-2 tabular-nums text-faint">{regle.ranking}</span>
                  {regle.name}
                  {!regle.isActive && (
                    <span className="ml-2 text-xs text-muted">({t('regles.ignoree')})</span>
                  )}
                </p>
                <p className="text-xs text-muted">
                  {regle.entityName}
                  {regle.isRecursive ? ' ↓' : ''} ·{' '}
                  {regle.matchAll ? t('regles.toutes') : t('regles.aumoins')}
                  {regle.stopAfter ? ` · ${t('regles.arreter')}` : ''}
                </p>

                <ul className="text-xs text-muted">
                  {regle.criteria.map((critere, position) => (
                    <li key={position}>
                      {definitionDe(critere.field)?.label ?? critere.field}{' '}
                      {t(`regles.operateurs.${critere.operator}`)}{' '}
                      <code>{critere.value ?? ''}</code>
                    </li>
                  ))}
                  {regle.actions.map((action, position) => (
                    <li key={`a${String(position)}`} className="text-ink">
                      → {t(`regles.typesAction.${action.action}`)}{' '}
                      {definitionDe(action.field)?.label ?? action.field}{' '}
                      <code>{action.value ?? ''}</code>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-1">
                <button
                  type="button"
                  className={BOUTON}
                  disabled={index === 0}
                  onClick={() => {
                    deplacer(index, -1);
                  }}
                >
                  {t('regles.monter')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  disabled={index === (regles.data?.length ?? 1) - 1}
                  onClick={() => {
                    deplacer(index, 1);
                  }}
                >
                  {t('regles.descendre')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    setEdite({ id: regle.id, valeurs: versFormulaire(regle) });
                  }}
                >
                  {t('commun.modifier')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    supprimer.mutate(regle.id);
                  }}
                >
                  {t('regles.supprimer')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

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
              <span className="text-xs text-muted">{t('regles.nom')}</span>
              <input
                className={CONTROLE}
                required
                value={edite.valeurs.name}
                onChange={(event) => {
                  setEdite({ ...edite, valeurs: { ...edite.valeurs, name: event.target.value } });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('regles.rang')}</span>
              <input
                type="number"
                className={CONTROLE}
                value={edite.valeurs.ranking}
                onChange={(event) => {
                  setEdite({
                    ...edite,
                    valeurs: { ...edite.valeurs, ranking: Number(event.target.value) },
                  });
                }}
              />
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
                <span>{t('regles.active')}</span>
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

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={edite.valeurs.matchAll}
                onChange={() => {
                  setEdite({ ...edite, valeurs: { ...edite.valeurs, matchAll: true } });
                }}
              />
              <span>{t('regles.toutes')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!edite.valeurs.matchAll}
                onChange={() => {
                  setEdite({ ...edite, valeurs: { ...edite.valeurs, matchAll: false } });
                }}
              />
              <span>{t('regles.aumoins')}</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={edite.valeurs.stopAfter}
                onChange={(event) => {
                  setEdite({
                    ...edite,
                    valeurs: { ...edite.valeurs, stopAfter: event.target.checked },
                  });
                }}
              />
              <span>{t('regles.arreter')}</span>
            </label>
          </div>

          {/* ---- Critères ---- */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">{t('regles.criteres')}</p>

            {edite.valeurs.criteria.map((critere, index) => {
              const definition = definitionDe(critere.field);

              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    className={`${CONTROLE} w-56`}
                    value={critere.field}
                    onChange={(event) => {
                      const suivant = definitionDe(event.target.value);

                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          criteria: edite.valeurs.criteria.map((valeur, position) =>
                            position === index
                              ? {
                                  field: event.target.value,
                                  // L'opérateur retenu peut ne pas s'appliquer
                                  // au nouveau champ : on retombe sur le premier
                                  // qu'il accepte plutôt que d'envoyer un couple
                                  // que le serveur refuserait.
                                  operator: suivant?.operators.includes(valeur.operator)
                                    ? valeur.operator
                                    : (suivant?.operators[0] ?? 'is'),
                                  value: valeur.value,
                                }
                              : valeur,
                          ),
                        },
                      });
                    }}
                  >
                    {criteres.map((definitionChamp) => (
                      <option key={definitionChamp.key} value={definitionChamp.key}>
                        {definitionChamp.label}
                      </option>
                    ))}
                  </select>

                  <select
                    className={`${CONTROLE} w-44`}
                    value={critere.operator}
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          criteria: edite.valeurs.criteria.map((valeur, position) =>
                            position === index
                              ? { ...valeur, operator: event.target.value as RuleOperator }
                              : valeur,
                          ),
                        },
                      });
                    }}
                  >
                    {(definition?.operators ?? []).map((operateur) => (
                      <option key={operateur} value={operateur}>
                        {t(`regles.operateurs.${operateur}`)}
                      </option>
                    ))}
                  </select>

                  {!SANS_VALEUR.includes(critere.operator) &&
                    (definition?.options ? (
                      <select
                        className={`${CONTROLE} w-44`}
                        value={critere.value ?? ''}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: {
                              ...edite.valeurs,
                              criteria: edite.valeurs.criteria.map((valeur, position) =>
                                position === index
                                  ? { ...valeur, value: event.target.value }
                                  : valeur,
                              ),
                            },
                          });
                        }}
                      >
                        <option value="">—</option>
                        {definition.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={`${CONTROLE} w-56`}
                        value={critere.value ?? ''}
                        onChange={(event) => {
                          setEdite({
                            ...edite,
                            valeurs: {
                              ...edite.valeurs,
                              criteria: edite.valeurs.criteria.map((valeur, position) =>
                                position === index
                                  ? { ...valeur, value: event.target.value }
                                  : valeur,
                              ),
                            },
                          });
                        }}
                      />
                    ))}

                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          criteria: edite.valeurs.criteria.filter(
                            (_, position) => position !== index,
                          ),
                        },
                      });
                    }}
                  >
                    {t('recherche.retirer')}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className={BOUTON}
              disabled={criteres.length === 0}
              onClick={() => {
                const premier = criteres[0];

                if (!premier) return;

                setEdite({
                  ...edite,
                  valeurs: {
                    ...edite.valeurs,
                    criteria: [
                      ...edite.valeurs.criteria,
                      {
                        field: premier.key,
                        operator: premier.operators[0] ?? 'is',
                        value: '',
                      },
                    ],
                  },
                });
              }}
            >
              {t('regles.ajouterCritere')}
            </button>
          </div>

          {/* ---- Actions ---- */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">{t('regles.actions')}</p>

            {edite.valeurs.actions.map((action, index) => {
              const definition = definitionDe(action.field);

              return (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    className={`${CONTROLE} w-44`}
                    value={action.action}
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          actions: edite.valeurs.actions.map((valeur, position) =>
                            position === index
                              ? { ...valeur, action: event.target.value as RuleActionType }
                              : valeur,
                          ),
                        },
                      });
                    }}
                  >
                    {(definition?.actions ?? []).map((type) => (
                      <option key={type} value={type}>
                        {t(`regles.typesAction.${type}`)}
                      </option>
                    ))}
                  </select>

                  <select
                    className={`${CONTROLE} w-56`}
                    value={action.field}
                    onChange={(event) => {
                      const suivant = definitionDe(event.target.value);

                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          actions: edite.valeurs.actions.map((valeur, position) =>
                            position === index
                              ? {
                                  field: event.target.value,
                                  action: suivant?.actions.includes(valeur.action)
                                    ? valeur.action
                                    : (suivant?.actions[0] ?? 'assign'),
                                  value: valeur.value,
                                }
                              : valeur,
                          ),
                        },
                      });
                    }}
                  >
                    {effets.map((definitionChamp) => (
                      <option key={definitionChamp.key} value={definitionChamp.key}>
                        {definitionChamp.label}
                      </option>
                    ))}
                  </select>

                  {action.action !== 'clear' && (
                    <input
                      className={`${CONTROLE} w-56`}
                      value={action.value ?? ''}
                      onChange={(event) => {
                        setEdite({
                          ...edite,
                          valeurs: {
                            ...edite.valeurs,
                            actions: edite.valeurs.actions.map((valeur, position) =>
                              position === index
                                ? { ...valeur, value: event.target.value }
                                : valeur,
                            ),
                          },
                        });
                      }}
                    />
                  )}

                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          actions: edite.valeurs.actions.filter(
                            (_, position) => position !== index,
                          ),
                        },
                      });
                    }}
                  >
                    {t('recherche.retirer')}
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className={BOUTON}
              disabled={effets.length === 0}
              onClick={() => {
                const premier = effets[0];

                if (!premier) return;

                setEdite({
                  ...edite,
                  valeurs: {
                    ...edite.valeurs,
                    actions: [
                      ...edite.valeurs.actions,
                      {
                        field: premier.key,
                        action: premier.actions[0] ?? 'assign',
                        value: '',
                      },
                    ],
                  },
                });
              }}
            >
              {t('regles.ajouterAction')}
            </button>
          </div>

          <div className="flex gap-2">
            <button type="submit" className={BOUTON}>
              {t('regles.enregistrer')}
            </button>
            <button
              type="button"
              className={BOUTON}
              onClick={() => {
                setEdite(null);
              }}
            >
              {t('creation.annuler')}
            </button>
          </div>
        </form>
      )}

      {/* ---- Simulateur ---- */}
      <div className={`${CARTE} space-y-3`}>
        <h3 className="font-medium">{t('regles.simulation')}</h3>

        <label className="space-y-1 block">
          <span className="text-xs text-muted">{t('regles.donneesEntree')}</span>
          <textarea
            className={`${CONTROLE} h-32 font-mono`}
            value={entree}
            onChange={(event) => {
              setEntree(event.target.value);
            }}
          />
        </label>

        <button
          type="button"
          className={BOUTON}
          onClick={() => {
            try {
              simuler.mutate(JSON.parse(entree) as Record<string, unknown>);
            } catch {
              setErreur('JSON invalide.');
            }
          }}
        >
          {t('regles.simuler')}
        </button>

        {simulation && (
          <div className="space-y-2 text-sm">
            <p className="text-xs font-medium text-muted">{t('regles.resultat')}</p>
            <pre className="overflow-x-auto rounded-md bg-sunken p-3 text-xs bg-surface">
              {JSON.stringify(simulation.output, null, 2)}
            </pre>

            <ul className="space-y-2">
              {simulation.traces.map((trace) => (
                <li
                  key={trace.ruleId}
                  className={`rounded-md border p-2 text-xs ${
                    trace.matched ? 'border-positive/40' : 'border-line'
                  }`}
                >
                  <p className="font-medium">
                    {trace.name} — {trace.matched ? t('regles.appliquee') : t('regles.ignoree')}
                    {trace.stopped ? ` · ${t('regles.arretee')}` : ''}
                  </p>

                  {trace.criteria.map((critere, position) => (
                    <p key={position} className={critere.matched ? 'text-positive' : 'text-muted'}>
                      {definitionDe(critere.field)?.label ?? critere.field}{' '}
                      {t(`regles.operateurs.${critere.operator}`)}{' '}
                      <code>{critere.value ?? ''}</code> — {t('regles.valeurObtenue')}{' '}
                      <code>{critere.actual ?? '∅'}</code>
                    </p>
                  ))}

                  {trace.applied.map((applique, position) => (
                    <p key={`x${String(position)}`}>
                      → {definitionDe(applique.field)?.label ?? applique.field} ={' '}
                      <code>{applique.value ?? '∅'}</code>
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
