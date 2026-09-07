import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Group,
  UserSummary,
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
import { FormPreview } from '@/components/FormPreview';
import { usePeut } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  Tabs,
  ACTION_LIGNE_DANGER,
  SectionTitle,
  PageHeader,
  ACTION_LIGNE,
  BOUTON,
  BOUTON_PRIMAIRE,
  CONTROLE,
} from '@/components/ui/primitives';

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
/**
 * Champs de ticket qu'une correspondance peut écrire, et la nature de leur
 * valeur.
 *
 * La nature décide de ce qu'on présente pour saisir une valeur fixe. Sans elle,
 * « affecter au groupe Logistique » se saisit en tapant `3` dans un champ
 * libre : personne ne connaît les identifiants, rien ne valide la frappe, et
 * l'erreur ne se découvre qu'au premier ticket créé au mauvais endroit.
 *
 * Les catégories, sources et lieux restent en saisie libre : l'API ne les
 * expose pas encore en liste. Le champ l'annonce plutôt que de faire semblant.
 */
const CHAMPS = [
  { champ: 'name', nature: 'texte' },
  { champ: 'content', nature: 'texte' },
  { champ: 'type', nature: 'type' },
  { champ: 'urgency', nature: 'severite' },
  { champ: 'impact', nature: 'severite' },
  { champ: 'categoryId', nature: 'identifiant' },
  { champ: 'requestSourceId', nature: 'identifiant' },
  { champ: 'locationId', nature: 'identifiant' },
  { champ: 'assignedGroupId', nature: 'groupe' },
  { champ: 'assignedUserId', nature: 'utilisateur' },
  { champ: 'observerUserId', nature: 'utilisateur' },
] as const;

type Nature = (typeof CHAMPS)[number]['nature'];

function natureDe(champ: string): Nature {
  return CHAMPS.find((entree) => entree.champ === champ)?.nature ?? 'texte';
}

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
/**
 * Saisie d'une valeur fixe, adaptée à ce que le champ attend.
 *
 * Un groupe et un technicien se **choisissent** dans une liste : ce sont des
 * lignes de la base, et les désigner par un identifiant tapé à la main revient
 * à demander à l'administrateur d'aller le lire en SQL. Les sévérités et le
 * type sont des énumérations fermées, donc des listes elles aussi. Ne reste en
 * saisie libre que ce dont l'API ne publie pas encore la liste — et le champ
 * l'annonce, plutôt que de laisser croire à un texte quelconque.
 */
function ValeurFixe({
  nature,
  valeur,
  groupes,
  comptes,
  onChange,
}: {
  nature: Nature;
  valeur: string;
  groupes: readonly Group[];
  comptes: readonly UserSummary[];
  onChange: (valeur: string) => void;
}) {
  const { t } = useTranslation();
  const classe = `${CONTROLE} w-56`;

  const changer = (event: { target: { value: string } }): void => {
    onChange(event.target.value);
  };

  if (nature === 'groupe' || nature === 'utilisateur') {
    const entrees =
      nature === 'groupe'
        ? groupes.map((groupe) => ({ id: groupe.id, label: groupe.completeName }))
        : comptes.map((compte) => ({ id: compte.id, label: compte.displayName }));

    return (
      <select className={classe} value={valeur} onChange={changer}>
        <option value="">—</option>
        {entrees.map((entree) => (
          <option key={entree.id} value={String(entree.id)}>
            {entree.label}
          </option>
        ))}
      </select>
    );
  }

  if (nature === 'severite') {
    return (
      <select className={classe} value={valeur} onChange={changer}>
        <option value="">—</option>
        {[1, 2, 3, 4, 5].map((niveau) => (
          <option key={niveau} value={String(niveau)}>
            {String(niveau)}
          </option>
        ))}
      </select>
    );
  }

  if (nature === 'type') {
    return (
      <select className={classe} value={valeur} onChange={changer}>
        <option value="incident">{t('tickets.types.incident')}</option>
        <option value="request">{t('tickets.types.request')}</option>
      </select>
    );
  }

  return (
    <input
      className={classe}
      value={valeur}
      onChange={changer}
      {...(nature === 'identifiant'
        ? { inputMode: 'numeric' as const, placeholder: t('formulaires.identifiantAttendu') }
        : {})}
    />
  );
}

export function FormsPage() {
  const { t } = useTranslation();
  const peutEcrire = usePeut('form', 'update');
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertForm } | null>(null);

  /**
   * Onglet courant de l'éditeur.
   *
   * Trois préoccupations distinctes vivaient sur une seule page : ce qu'est le
   * formulaire, ce qu'il demande, et ce qu'il crée. Empilées, elles imposent un
   * défilement de plusieurs écrans où l'on perd de vue ce qu'on est en train de
   * régler. Elles se traitent l'une après l'autre, jamais ensemble.
   */
  const [onglet, setOnglet] = useState<'formulaire' | 'questions' | 'destination'>('formulaire');
  const [erreur, setErreur] = useState<string | null>(null);

  const formulaires = useQuery({ queryKey: ['forms'], queryFn: api.forms, retry: false });

  // Groupes et comptes servent aux correspondances qui designent un acteur.
  // `retry: false` : sans le droit de les lire, la liste reste vide et la
  // saisie retombe sur l'identifiant -- ce n'est pas une panne.
  const groupes = useQuery({ queryKey: ['groups'], queryFn: api.groups, retry: false });
  const comptes = useQuery({
    queryKey: ['users', 'actifs'],
    queryFn: () => api.users({ inactive: false }),
    retry: false,
  });

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
      <PageHeader
        title={t('formulaires.titre')}
        description={t('formulaires.intro')}
        action={
          peutEcrire && (
            <button
              type="button"
              className={BOUTON_PRIMAIRE}
              onClick={() => {
                setEdite({ valeurs: formulaireVide() });
                setOnglet('formulaire');
              }}
            >
              {t('formulaires.nouveau')}
            </button>
          )
        }
      />

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      {formulaires.data?.length === 0 && (
        <p className="text-sm text-muted">{t('formulaires.aucun')}</p>
      )}

      <div className={cn('divide-y divide-line border-y border-line', edite && 'hidden')}>
        {formulaires.data?.map((forme) => (
          <div key={forme.id} className="px-1 py-3">
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
                  className={ACTION_LIGNE}
                  onClick={() => {
                    setEdite({ id: forme.id, valeurs: versFormulaire(forme) });
                  }}
                >
                  {t('commun.modifier')}
                </button>
                <button
                  type="button"
                  className={ACTION_LIGNE}
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
          className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]"
          onSubmit={(event) => {
            event.preventDefault();
            enregistrer.mutate(edite);
          }}
        >
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-3">
              <h3 className="text-lg font-bold tracking-tight text-ink">
                {edite.id === undefined
                  ? t('formulaires.nouveau')
                  : edite.valeurs.name || t('formulaires.nom')}
              </h3>

              <Tabs
                value={onglet}
                onChange={setOnglet}
                options={[
                  { value: 'formulaire', label: t('formulaires.ongletFormulaire') },
                  {
                    value: 'questions',
                    // Le compte evite d'ouvrir l'onglet pour savoir s'il est vide.
                    label: `${t('formulaires.ongletQuestions')} · ${String(plates.length)}`,
                  },
                  { value: 'destination', label: t('formulaires.ongletDestination') },
                ]}
              />
            </div>

            {onglet === 'formulaire' && (
              <div className="grid gap-3 md:grid-cols-4">
                <label className="space-y-1 md:col-span-2">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.nom')}
                  </span>
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
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.rubrique')}
                  </span>
                  <input
                    className={CONTROLE}
                    value={edite.valeurs.category ?? ''}
                    onChange={(event) => {
                      maj({ category: event.target.value || null });
                    }}
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.rang')}
                  </span>
                  <input
                    type="number"
                    className={CONTROLE}
                    value={edite.valeurs.ranking}
                    onChange={(event) => {
                      maj({ ranking: Number(event.target.value) });
                    }}
                  />
                </label>

                <label className="space-y-1 md:col-span-3">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {t('formulaires.description')}
                  </span>
                  <input
                    className={CONTROLE}
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
            )}

            {/* ---- Sections et questions ---- */}
            {onglet === 'questions' && (
              <>
                {edite.valeurs.sections.map((section, indexSection) => (
                  /* La section n'est plus une boite : un numero, un titre et un filet.
                   Des boites dans des boites de meme poids -- section, question,
                   condition -- empechent de voir ou une question se termine. */
                  <div key={indexSection} className="space-y-3">
                    <div className="flex items-center gap-2 border-b border-line pb-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-[2px] bg-ink text-[10px] font-bold text-canvas tabular-nums">
                        {String(indexSection + 1)}
                      </span>
                      <input
                        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-ink placeholder:text-faint focus:outline-none"
                        required
                        placeholder={t('formulaires.section')}
                        value={section.name}
                        onChange={(event) => {
                          maj({
                            sections: edite.valeurs.sections.map((autre, position) =>
                              position === indexSection
                                ? { ...autre, name: event.target.value }
                                : autre,
                            ),
                          });
                        }}
                      />
                      <button
                        type="button"
                        className={ACTION_LIGNE_DANGER}
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
                        plates.find((plate) => plate.question === question && plate.rang >= 0)
                          ?.rang ?? 0;

                      return (
                        <div
                          key={indexQuestion}
                          className="space-y-2 border-l-2 border-line py-2 pl-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Le rang est technique : il sert aux conditions et aux
                              correspondances, qui designent les questions par lui.
                              Il reste donc visible, mais discret. */}
                            <span className="w-5 font-mono text-[10px] text-faint tabular-nums">
                              {String(rang)}
                            </span>

                            <input
                              className={`${CONTROLE} min-w-0 flex-1`}
                              required
                              placeholder={t('formulaires.libelle')}
                              value={question.label}
                              onChange={(event) => {
                                majQuestion(indexSection, indexQuestion, {
                                  label: event.target.value,
                                });
                              }}
                            />

                            <select
                              className={`${CONTROLE} w-40`}
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
                              className={ACTION_LIGNE_DANGER}
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
                            <label className="block space-y-1">
                              <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                                {t('formulaires.choix')}
                              </span>
                              <textarea
                                className={`${CONTROLE} h-20`}
                                placeholder={t('formulaires.choix')}
                                value={question.options.join('\n')}
                                onChange={(event) => {
                                  majQuestion(indexSection, indexQuestion, {
                                    options: event.target.value.split('\n').filter(Boolean),
                                  });
                                }}
                              />
                            </label>
                          )}

                          {question.conditions.map((condition, indexCondition) => (
                            <div key={indexCondition} className="flex flex-wrap items-center gap-2">
                              <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                                {t('formulaires.conditions')}
                              </span>

                              <select
                                className={`${CONTROLE} w-56`}
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
                                className={`${CONTROLE} w-40`}
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
                                className={`${CONTROLE} w-40`}
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
              </>
            )}

            {onglet === 'destination' && destination && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">{t('formulaires.correspondances')}</p>

                {destination.mappings.map((mapping, indexMapping) => (
                  <div key={indexMapping} className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${CONTROLE} w-48`}
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
                      {CHAMPS.map((entree) => (
                        <option key={entree.champ} value={entree.champ}>
                          {t(`formulaires.champs.${entree.champ}` as 'formulaires.champs.name')}
                        </option>
                      ))}
                    </select>

                    <select
                      className={`${CONTROLE} w-36`}
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
                        className={`${CONTROLE} w-56`}
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
                      <ValeurFixe
                        nature={natureDe(mapping.field)}
                        valeur={mapping.value ?? ''}
                        groupes={groupes.data ?? []}
                        comptes={comptes.data ?? []}
                        onChange={(valeur) => {
                          majMappings(
                            destination.mappings.map((autre, position) =>
                              position === indexMapping ? { ...autre, value: valeur } : autre,
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

            {/*
              Le pied d'action reste sous les yeux.
              L'onglet « Questions » est long par nature : laisser « Enregistrer »
              tout en bas obligerait a redescendre tout le formulaire apres chaque
              retouche, et c'est ainsi qu'on perd une saisie en changeant d'ecran.
            */}
            <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-line bg-canvas px-1 py-3">
              <button type="submit" className={BOUTON_PRIMAIRE}>
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
          </div>

          {/*
            L'apercu accompagne la construction, colle en haut de colonne.
            Composer a l'aveugle est le defaut central d'un constructeur : on
            empile des champs sans voir la page qu'ils font, et l'on decouvre a
            la premiere soumission qu'une section est vide ou qu'une question
            est incomprehensible.
          */}
          <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
            <SectionTitle>{t('formulaires.apercu')}</SectionTitle>
            <p className="text-xs text-faint">{t('formulaires.apercuAide')}</p>

            <div className="border border-line bg-surface p-4">
              <FormPreview valeurs={edite.valeurs} />
            </div>
          </aside>
        </form>
      )}
    </section>
  );
}
