import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Form,
  FormMapping,
  FormQuestion,
  FormQuestionKind,
  RuleOperator,
  UpsertForm,
} from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { BOUTON, BOUTON_PRIMAIRE } from '@/components/ui/primitives';

const NATURES: FormQuestionKind[] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
  'urgency',
];

/** Opérateurs proposés pour une condition d'affichage. */
const OPERATEURS: RuleOperator[] = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
];

/**
 * Champs de ticket qu'une correspondance peut alimenter.
 *
 * La même liste que celle des actions de règle : ce sont les mêmes champs, et
 * deux listes finiraient par diverger sans que rien ne le signale.
 */
const CHAMPS = [
  'name',
  'content',
  'type',
  'urgency',
  'impact',
  'categoryId',
  'requestSourceId',
  'locationId',
  'assignedGroupId',
  'assignedUserId',
];

const champ =
  'w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm';
const carte = 'rounded-card border border-line bg-surface p-4 shadow-card';

function formulaireVide(): UpsertForm {
  return {
    name: '',
    description: null,
    category: null,
    isActive: true,
    ranking: 100,
    isRecursive: true,
    sections: [{ name: 'Questions', description: null, questions: [] }],
    access: [],
    destinations: [{ kind: 'ticket', mappings: [] }],
  };
}

function versFormulaire(forme: Form): UpsertForm {
  return {
    name: forme.name,
    description: forme.description,
    category: forme.category,
    isActive: forme.isActive,
    ranking: forme.ranking,
    isRecursive: forme.isRecursive,
    sections: forme.sections.map((section) => ({
      name: section.name,
      description: section.description,
      questions: section.questions.map((question) => ({ ...question })),
    })),
    access: forme.access.map((entree) => ({ ...entree })),
    destinations:
      forme.destinations.length > 0 ? forme.destinations : [{ kind: 'ticket', mappings: [] }],
  };
}

/** Questions à plat, avec leur rang : c'est ainsi que les conditions les désignent. */
function aplatir(valeurs: UpsertForm): { rang: number; question: FormQuestion }[] {
  let rang = -1;

  return valeurs.sections.flatMap((section) =>
    section.questions.map((question) => {
      rang += 1;

      return { rang, question };
    }),
  );
}

/**
 * Constructeur de formulaires.
 *
 * Les questions sont désignées par leur **rang** dans le formulaire, pas par un
 * identifiant : un formulaire se compose avant que ses questions existent en
 * base, et une condition doit pouvoir viser une question qui vient d'être
 * ajoutée.
 */
export function FormsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertForm } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const formulaires = useQuery({ queryKey: ['forms'], queryFn: api.forms, retry: false });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertForm }) =>
      api.saveForm(valeurs, id),
    onSuccess: async () => {
      setEdite(null);
      setErreur(null);
      await queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteForm,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['forms'] }),
  });

  if (formulaires.error instanceof ApiError && formulaires.error.status === 403) {
    return (
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
        {t('entites.interdit')}
      </p>
    );
  }

  const maj = (patch: Partial<UpsertForm>): void => {
    if (!edite) return;

    setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  const majQuestion = (
    indexSection: number,
    indexQuestion: number,
    patch: Partial<FormQuestion>,
  ): void => {
    if (!edite) return;

    maj({
      sections: edite.valeurs.sections.map((section, position) =>
        position !== indexSection
          ? section
          : {
              ...section,
              questions: section.questions.map((question, rang) =>
                rang === indexQuestion ? { ...question, ...patch } : question,
              ),
            },
      ),
    });
  };

  const plates = edite ? aplatir(edite.valeurs) : [];
  const destination = edite?.valeurs.destinations[0];

  const majMappings = (mappings: FormMapping[]): void => {
    if (!edite || !destination) return;

    maj({ destinations: [{ ...destination, mappings }] });
  };

  return (
    <section className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('formulaires.titre')}</h2>
        <button
          type="button"
          className={BOUTON_PRIMAIRE}
          onClick={() => {
            setEdite({ valeurs: formulaireVide() });
          }}
        >
          {t('formulaires.nouveau')}
        </button>
      </header>

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {formulaires.data?.length === 0 && (
        <p className="text-sm text-muted">{t('formulaires.aucun')}</p>
      )}

      <div className="grid gap-2 md:grid-cols-2">
        {formulaires.data?.map((forme) => (
          <div key={forme.id} className={carte}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{forme.name}</p>
                <p className="text-xs text-muted">
                  {forme.category ?? '—'} · {forme.entityName}
                  {forme.isRecursive ? ' ↓' : ''} ·{' '}
                  {String(forme.sections.reduce((total, s) => total + s.questions.length, 0))}{' '}
                  {t('formulaires.questions').toLowerCase()}
                  {!forme.isActive ? ` · ${t('notifications.etats.cancelled')}` : ''}
                </p>
              </div>

              <div className="flex gap-1">
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    setEdite({ id: forme.id, valeurs: versFormulaire(forme) });
                  }}
                >
                  {t('commun.modifier')}
                </button>
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    supprimer.mutate(forme.id);
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
          className={`${carte} space-y-4`}
          onSubmit={(event) => {
            event.preventDefault();
            enregistrer.mutate(edite);
          }}
        >
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-muted">{t('formulaires.nom')}</span>
              <input
                className={champ}
                required
                value={edite.valeurs.name}
                onChange={(event) => {
                  maj({ name: event.target.value });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('formulaires.rubrique')}</span>
              <input
                className={champ}
                value={edite.valeurs.category ?? ''}
                onChange={(event) => {
                  maj({ category: event.target.value || null });
                }}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs text-muted">{t('formulaires.rang')}</span>
              <input
                type="number"
                className={champ}
                value={edite.valeurs.ranking}
                onChange={(event) => {
                  maj({ ranking: Number(event.target.value) });
                }}
              />
            </label>

            <label className="space-y-1 md:col-span-3">
              <span className="text-xs text-muted">{t('formulaires.description')}</span>
              <input
                className={champ}
                value={edite.valeurs.description ?? ''}
                onChange={(event) => {
                  maj({ description: event.target.value || null });
                }}
              />
            </label>

            <div className="flex flex-col justify-end gap-1 text-sm">
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
                  checked={edite.valeurs.isRecursive}
                  onChange={(event) => {
                    maj({ isRecursive: event.target.checked });
                  }}
                />
                <span>{t('commun.recursif')}</span>
              </label>
            </div>
          </div>

          {/* ---- Sections et questions ---- */}
          {edite.valeurs.sections.map((section, indexSection) => (
            <div
              key={indexSection}
              className="space-y-3 rounded-lg border border-line p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  className={`${champ} flex-1`}
                  required
                  value={section.name}
                  onChange={(event) => {
                    maj({
                      sections: edite.valeurs.sections.map((autre, position) =>
                        position === indexSection ? { ...autre, name: event.target.value } : autre,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => {
                    maj({
                      sections: edite.valeurs.sections.filter(
                        (_, position) => position !== indexSection,
                      ),
                    });
                  }}
                >
                  {t('recherche.retirer')}
                </button>
              </div>

              {section.questions.map((question, indexQuestion) => {
                const rang =
                  plates.find((plate) => plate.question === question && plate.rang >= 0)?.rang ?? 0;

                return (
                  <div
                    key={indexQuestion}
                    className="space-y-2 rounded-md bg-sunken p-2 bg-surface"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-6 text-xs tabular-nums text-faint">
                        {String(rang)}
                      </span>

                      <input
                        className={`${champ} w-64`}
                        required
                        placeholder={t('formulaires.libelle')}
                        value={question.label}
                        onChange={(event) => {
                          majQuestion(indexSection, indexQuestion, { label: event.target.value });
                        }}
                      />

                      <select
                        className={`${champ} w-40`}
                        value={question.kind}
                        onChange={(event) => {
                          majQuestion(indexSection, indexQuestion, {
                            kind: event.target.value as FormQuestionKind,
                          });
                        }}
                      >
                        {NATURES.map((nature) => (
                          <option key={nature} value={nature}>
                            {t(`formulaires.natures.${nature}`)}
                          </option>
                        ))}
                      </select>

                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={question.isRequired}
                          onChange={(event) => {
                            majQuestion(indexSection, indexQuestion, {
                              isRequired: event.target.checked,
                            });
                          }}
                        />
                        {t('formulaires.obligatoire')}
                      </label>

                      <button
                        type="button"
                        className={BOUTON}
                        onClick={() => {
                          maj({
                            sections: edite.valeurs.sections.map((autre, position) =>
                              position !== indexSection
                                ? autre
                                : {
                                    ...autre,
                                    questions: autre.questions.filter(
                                      (_, rangQuestion) => rangQuestion !== indexQuestion,
                                    ),
                                  },
                            ),
                          });
                        }}
                      >
                        {t('recherche.retirer')}
                      </button>
                    </div>

                    {question.kind === 'select' && (
                      <textarea
                        className={`${champ} h-20`}
                        placeholder={t('formulaires.choix')}
                        value={question.options.join('\n')}
                        onChange={(event) => {
                          majQuestion(indexSection, indexQuestion, {
                            options: event.target.value.split('\n').filter(Boolean),
                          });
                        }}
                      />
                    )}

                    {question.conditions.map((condition, indexCondition) => (
                      <div key={indexCondition} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted">
                          {t('formulaires.conditions')}
                        </span>

                        <select
                          className={`${champ} w-56`}
                          value={condition.dependsOn}
                          onChange={(event) => {
                            majQuestion(indexSection, indexQuestion, {
                              conditions: question.conditions.map((autre, position) =>
                                position === indexCondition
                                  ? { ...autre, dependsOn: Number(event.target.value) }
                                  : autre,
                              ),
                            });
                          }}
                        >
                          {plates
                            .filter((plate) => plate.rang < rang)
                            .map((plate) => (
                              <option key={plate.rang} value={plate.rang}>
                                {String(plate.rang)} — {plate.question.label}
                              </option>
                            ))}
                        </select>

                        <select
                          className={`${champ} w-40`}
                          value={condition.operator}
                          onChange={(event) => {
                            majQuestion(indexSection, indexQuestion, {
                              conditions: question.conditions.map((autre, position) =>
                                position === indexCondition
                                  ? { ...autre, operator: event.target.value as RuleOperator }
                                  : autre,
                              ),
                            });
                          }}
                        >
                          {OPERATEURS.map((operateur) => (
                            <option key={operateur} value={operateur}>
                              {t(`regles.operateurs.${operateur}`)}
                            </option>
                          ))}
                        </select>

                        <input
                          className={`${champ} w-40`}
                          value={condition.value ?? ''}
                          onChange={(event) => {
                            majQuestion(indexSection, indexQuestion, {
                              conditions: question.conditions.map((autre, position) =>
                                position === indexCondition
                                  ? { ...autre, value: event.target.value }
                                  : autre,
                              ),
                            });
                          }}
                        />

                        <button
                          type="button"
                          className={BOUTON}
                          onClick={() => {
                            majQuestion(indexSection, indexQuestion, {
                              conditions: question.conditions.filter(
                                (_, position) => position !== indexCondition,
                              ),
                            });
                          }}
                        >
                          {t('recherche.retirer')}
                        </button>
                      </div>
                    ))}

                    {rang > 0 && (
                      <button
                        type="button"
                        className={BOUTON}
                        onClick={() => {
                          majQuestion(indexSection, indexQuestion, {
                            conditions: [
                              ...question.conditions,
                              { dependsOn: 0, operator: 'is', value: '' },
                            ],
                          });
                        }}
                      >
                        {t('formulaires.ajouterCondition')}
                      </button>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  maj({
                    sections: edite.valeurs.sections.map((autre, position) =>
                      position !== indexSection
                        ? autre
                        : {
                            ...autre,
                            questions: [
                              ...autre.questions,
                              {
                                kind: 'text' as const,
                                label: '',
                                description: null,
                                isRequired: false,
                                options: [],
                                defaultValue: null,
                                conditions: [],
                              },
                            ],
                          },
                    ),
                  });
                }}
              >
                {t('formulaires.ajouterQuestion')}
              </button>
            </div>
          ))}

          <button
            type="button"
            className={BOUTON}
            onClick={() => {
              maj({
                sections: [
                  ...edite.valeurs.sections,
                  { name: '', description: null, questions: [] },
                ],
              });
            }}
          >
            {t('formulaires.ajouterSection')}
          </button>

          {/* ---- Correspondances ---- */}
          {destination && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted">
                {t('formulaires.correspondances')}
              </p>

              {destination.mappings.map((mapping, indexMapping) => (
                <div key={indexMapping} className="flex flex-wrap items-center gap-2">
                  <select
                    className={`${champ} w-48`}
                    value={mapping.field}
                    onChange={(event) => {
                      majMappings(
                        destination.mappings.map((autre, position) =>
                          position === indexMapping
                            ? { ...autre, field: event.target.value }
                            : autre,
                        ),
                      );
                    }}
                  >
                    {CHAMPS.map((nom) => (
                      <option key={nom} value={nom}>
                        {nom}
                      </option>
                    ))}
                  </select>

                  <select
                    className={`${champ} w-36`}
                    value={mapping.source}
                    onChange={(event) => {
                      majMappings(
                        destination.mappings.map((autre, position) =>
                          position === indexMapping
                            ? { ...autre, source: event.target.value as 'question' | 'literal' }
                            : autre,
                        ),
                      );
                    }}
                  >
                    <option value="question">{t('formulaires.question')}</option>
                    <option value="literal">{t('formulaires.valeurFixe')}</option>
                  </select>

                  {mapping.source === 'question' ? (
                    <select
                      className={`${champ} w-56`}
                      value={mapping.question ?? 0}
                      onChange={(event) => {
                        majMappings(
                          destination.mappings.map((autre, position) =>
                            position === indexMapping
                              ? { ...autre, question: Number(event.target.value) }
                              : autre,
                          ),
                        );
                      }}
                    >
                      {plates.map((plate) => (
                        <option key={plate.rang} value={plate.rang}>
                          {String(plate.rang)} — {plate.question.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={`${champ} w-56`}
                      value={mapping.value ?? ''}
                      onChange={(event) => {
                        majMappings(
                          destination.mappings.map((autre, position) =>
                            position === indexMapping
                              ? { ...autre, value: event.target.value }
                              : autre,
                          ),
                        );
                      }}
                    />
                  )}

                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => {
                      majMappings(
                        destination.mappings.filter((_, position) => position !== indexMapping),
                      );
                    }}
                  >
                    {t('recherche.retirer')}
                  </button>
                </div>
              ))}

              <button
                type="button"
                className={BOUTON}
                onClick={() => {
                  majMappings([
                    ...destination.mappings,
                    { field: 'name', source: 'question', question: 0, value: null },
                  ]);
                }}
              >
                {t('formulaires.ajouterCorrespondance')}
              </button>
            </div>
          )}

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
    </section>
  );
}
