import { useMutation, useQuery } from '@tanstack/react-query';
import type { FormQuestion } from '@tick/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';

type Reponses = Record<string, string | string[] | null>;

const champ =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950';
const bouton =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
const carte = 'rounded-lg border border-neutral-200 p-4 dark:border-neutral-800';

/** Réponse sous forme de texte, une réponse multiple étant jointe. */
function enTexte(valeur: string | string[] | null | undefined): string | null {
  if (valeur === null || valeur === undefined) return null;

  return Array.isArray(valeur) ? valeur.join(', ') : valeur;
}

/**
 * Évalue une condition d'affichage.
 *
 * Les mêmes opérateurs que le serveur, et pour la même raison : une question
 * cachée ici mais exigée là-bas produirait un refus que l'utilisateur ne peut
 * pas comprendre, puisque le champ manquant est invisible.
 */
function satisfait(operateur: string, actuel: string | null, attendu: string | null): boolean {
  const gauche = (actuel ?? '').trim().toLocaleLowerCase();
  const droite = (attendu ?? '').trim().toLocaleLowerCase();

  switch (operateur) {
    case 'is':
      return gauche === droite;
    case 'is_not':
      return gauche !== droite;
    case 'contains':
      return gauche.includes(droite);
    case 'not_contains':
      return !gauche.includes(droite);
    case 'starts_with':
      return gauche.startsWith(droite);
    case 'ends_with':
      return gauche.endsWith(droite);
    case 'is_empty':
      return gauche === '';
    case 'is_not_empty':
      return gauche !== '';
    default:
      return false;
  }
}

function estVisible(
  question: FormQuestion,
  rang: number,
  questions: readonly FormQuestion[],
  reponses: Reponses,
): boolean {
  if (question.conditions.length === 0) return true;

  return question.conditions.every((condition) => {
    const source = questions[condition.dependsOn];

    if (!source || condition.dependsOn >= rang) return false;
    if (!estVisible(source, condition.dependsOn, questions, reponses)) return false;

    return satisfait(
      condition.operator,
      enTexte(reponses[String(condition.dependsOn)]),
      condition.value ?? null,
    );
  });
}

/**
 * Catalogue de services, et remplissage d'un formulaire.
 *
 * L'écran d'un demandeur : il choisit une demande dans une liste courte, la
 * remplit, et retrouve son ticket. Aucun champ ITIL n'y apparaît — c'est la
 * correspondance du formulaire qui les remplit.
 */
export function CataloguePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [choisi, setChoisi] = useState<number | null>(null);
  const [reponses, setReponses] = useState<Reponses>({});
  const [erreur, setErreur] = useState<string | null>(null);

  const catalogue = useQuery({
    queryKey: ['catalogue'],
    queryFn: api.catalogue,
    retry: false,
  });

  const formulaire = useQuery({
    queryKey: ['catalogue-form', choisi],
    queryFn: () => api.catalogueForm(choisi ?? 0),
    enabled: choisi !== null,
    retry: false,
  });

  const soumettre = useMutation({
    mutationFn: () => api.submitForm(choisi ?? 0, { answers: reponses }),
    onSuccess: (resultat) => {
      if (resultat.ticketId) void navigate(`/tickets/${String(resultat.ticketId)}`);
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const questions = formulaire.data?.sections.flatMap((section) => section.questions) ?? [];

  // Les valeurs par defaut ne peuvent etre posees qu'une fois le formulaire
  // charge : au clic, on ne connait encore que son identifiant.
  useEffect(() => {
    if (!formulaire.data) return;

    setReponses(
      Object.fromEntries(
        formulaire.data.sections
          .flatMap((section) => section.questions)
          .map((question, rang) => [String(rang), question.defaultValue ?? null]),
      ),
    );
  }, [formulaire.data]);

  /**
   * Rang de la premiere question de chaque section.
   *
   * Les conditions designent une question par son rang **dans le formulaire**,
   * toutes sections confondues : le calculer d'avance evite de dependre de
   * l'ordre d'evaluation du rendu.
   */
  const depart = (formulaire.data?.sections ?? []).reduce<number[]>(
    (rangs, section) => [...rangs, (rangs.at(-1) ?? 0) + section.questions.length],
    [0],
  );

  return (
    <section className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{t('catalogue.titre')}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('catalogue.description')}
        </p>
      </header>

      {erreur && <p className="text-sm text-red-600 dark:text-red-400">{erreur}</p>}

      {choisi === null && (
        <>
          {catalogue.data?.length === 0 && (
            <p className="text-sm text-neutral-500">{t('catalogue.aucun')}</p>
          )}

          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {catalogue.data?.map((service) => (
              <button
                key={service.id}
                type="button"
                className={`${carte} text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-900`}
                onClick={() => {
                  setChoisi(service.id);
                  setErreur(null);
                }}
              >
                <p className="font-medium">{service.name}</p>
                {service.description && (
                  <p className="mt-1 text-xs text-neutral-500">{service.description}</p>
                )}
                {service.category && (
                  <p className="mt-2 text-xs text-neutral-400">{service.category}</p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {choisi !== null && formulaire.data && (
        <form
          className={`${carte} space-y-5`}
          onSubmit={(event) => {
            event.preventDefault();
            soumettre.mutate();
          }}
        >
          <header className="space-y-1">
            <button
              type="button"
              className="text-xs text-neutral-500 underline-offset-2 hover:underline"
              onClick={() => {
                setChoisi(null);
              }}
            >
              ← {t('catalogue.retour')}
            </button>
            <h3 className="text-lg font-semibold tracking-tight">{formulaire.data.name}</h3>
            {formulaire.data.description && (
              <p className="text-sm text-neutral-500">{formulaire.data.description}</p>
            )}
          </header>

          {formulaire.data.sections.map((section, indexSection) => (
            <fieldset key={indexSection} className="space-y-3">
              <legend className="text-sm font-semibold">{section.name}</legend>
              {section.description && (
                <p className="text-xs text-neutral-500">{section.description}</p>
              )}

              {section.questions.map((question, indexQuestion) => {
                const rang = (depart[indexSection] ?? 0) + indexQuestion;

                if (!estVisible(question, rang, questions, reponses)) return null;

                const valeur = reponses[String(rang)];
                const poser = (nouvelle: string | string[] | null): void => {
                  setReponses({ ...reponses, [String(rang)]: nouvelle });
                };

                return (
                  <label key={rang} className="block space-y-1">
                    <span className="text-sm">
                      {question.label}
                      {question.isRequired && <span className="ml-1 text-red-600">*</span>}
                    </span>
                    {question.description && (
                      <span className="block text-xs text-neutral-500">{question.description}</span>
                    )}

                    {question.kind === 'textarea' && (
                      <textarea
                        className={`${champ} h-28`}
                        value={typeof valeur === 'string' ? valeur : ''}
                        onChange={(event) => {
                          poser(event.target.value);
                        }}
                      />
                    )}

                    {(question.kind === 'select' || question.kind === 'urgency') && (
                      <select
                        className={champ}
                        value={typeof valeur === 'string' ? valeur : ''}
                        onChange={(event) => {
                          poser(event.target.value || null);
                        }}
                      >
                        <option value="">—</option>
                        {(question.kind === 'urgency'
                          ? ['1', '2', '3', '4', '5']
                          : question.options
                        ).map((option) => (
                          <option key={option} value={option}>
                            {question.kind === 'urgency'
                              ? t(`tickets.priorites.p${option}` as 'tickets.priorites.p1')
                              : option}
                          </option>
                        ))}
                      </select>
                    )}

                    {question.kind === 'checkbox' && (
                      <input
                        type="checkbox"
                        checked={valeur === 'true'}
                        onChange={(event) => {
                          poser(event.target.checked ? 'true' : 'false');
                        }}
                      />
                    )}

                    {!['textarea', 'select', 'urgency', 'checkbox'].includes(question.kind) && (
                      <input
                        className={champ}
                        type={
                          question.kind === 'number'
                            ? 'number'
                            : question.kind === 'date'
                              ? 'date'
                              : 'text'
                        }
                        value={typeof valeur === 'string' ? valeur : ''}
                        onChange={(event) => {
                          poser(event.target.value || null);
                        }}
                      />
                    )}
                  </label>
                );
              })}
            </fieldset>
          ))}

          <button type="submit" className={bouton}>
            {t('catalogue.envoyer')}
          </button>
        </form>
      )}
    </section>
  );
}
