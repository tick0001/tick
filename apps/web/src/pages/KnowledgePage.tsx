import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KbArticle, SessionContext, UpsertKbArticle } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';

const champ =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950';
const bouton =
  'rounded-md border border-neutral-300 px-2.5 py-1 text-sm transition hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800';
const carte = 'rounded-lg border border-neutral-200 p-4 dark:border-neutral-800';

function articleVide(): UpsertKbArticle {
  return {
    name: '',
    content: '',
    categoryId: null,
    isFaq: false,
    isPublished: true,
    isRecursive: true,
    targets: [],
  };
}

function versFormulaire(article: KbArticle): UpsertKbArticle {
  return {
    name: article.name,
    content: article.content,
    categoryId: article.categoryId,
    isFaq: article.isFaq,
    isPublished: article.isPublished,
    isRecursive: article.isRecursive,
    targets: article.targets.map((cible) => ({ ...cible })),
  };
}

/**
 * Base de connaissances.
 *
 * Liste, lecture et rédaction sur un même écran : un article se corrige le plus
 * souvent juste après avoir été relu, et faire naviguer entre trois pages pour
 * cela décourage la correction — donc laisse vivre les articles faux.
 */
export function KnowledgePage({ session }: { session: SessionContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [recherche, setRecherche] = useState('');
  const [categorie, setCategorie] = useState<number | ''>('');
  const [favoris, setFavoris] = useState(false);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertKbArticle } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['kb-categories'],
    queryFn: api.kbCategories,
    retry: false,
  });

  const articles = useQuery({
    queryKey: ['kb-articles', recherche, categorie, favoris],
    queryFn: () =>
      api.kbArticles({
        search: recherche || undefined,
        categoryId: categorie === '' ? undefined : categorie,
        favoritesOnly: favoris,
      }),
    retry: false,
  });

  const article = useQuery({
    queryKey: ['kb-article', ouvert],
    queryFn: () => api.kbArticle(ouvert ?? 0),
    enabled: ouvert !== null,
    retry: false,
  });

  const revisions = useQuery({
    queryKey: ['kb-revisions', ouvert],
    queryFn: () => api.kbRevisions(ouvert ?? 0),
    enabled: ouvert !== null,
    retry: false,
  });

  const basculerFavori = useMutation({
    mutationFn: api.toggleKbFavorite,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      await queryClient.invalidateQueries({ queryKey: ['kb-article'] });
    },
  });

  const enregistrer = useMutation({
    mutationFn: ({ id, valeurs }: { id?: number; valeurs: UpsertKbArticle }) =>
      api.saveKbArticle(valeurs, id),
    onSuccess: async (enregistre) => {
      setEdite(null);
      setErreur(null);
      setOuvert(enregistre.id);
      await queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
      await queryClient.invalidateQueries({ queryKey: ['kb-article'] });
    },
    onError: (error: unknown) => {
      setErreur(error instanceof Error ? error.message : String(error));
    },
  });

  const supprimer = useMutation({
    mutationFn: api.deleteKbArticle,
    onSuccess: async () => {
      setOuvert(null);
      await queryClient.invalidateQueries({ queryKey: ['kb-articles'] });
    },
  });

  if (articles.error instanceof ApiError && articles.error.status === 403) {
    return (
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {t('entites.interdit')}
      </p>
    );
  }

  /**
   * Droit de rediger.
   *
   * Un bouton qui ne peut qu'echouer est pire qu'un bouton absent : il promet
   * une action, la refuse, et laisse croire a une panne.
   */
  const peutEcrire = 'kb:update' in session.rights;

  const maj = (patch: Partial<UpsertKbArticle>): void => {
    if (!edite) return;

    setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t('connaissance.titre')}</h2>
        {peutEcrire && (
          <button
            type="button"
            className={bouton}
            onClick={() => {
              setEdite({ valeurs: articleVide() });
              setOuvert(null);
            }}
          >
            {t('connaissance.nouveau')}
          </button>
        )}
      </header>

      {erreur && <p className="text-sm text-red-600 dark:text-red-400">{erreur}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${champ} w-64`}
          placeholder={t('connaissance.rechercher')}
          value={recherche}
          onChange={(event) => {
            setRecherche(event.target.value);
          }}
        />

        <select
          className={`${champ} w-auto`}
          value={categorie}
          onChange={(event) => {
            setCategorie(event.target.value === '' ? '' : Number(event.target.value));
          }}
        >
          <option value="">{t('connaissance.toutesCategories')}</option>
          {categories.data?.map((categorieOption) => (
            <option key={categorieOption.id} value={categorieOption.id}>
              {categorieOption.completeName}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={favoris}
            onChange={(event) => {
              setFavoris(event.target.checked);
            }}
          />
          <span>{t('connaissance.mesFavoris')}</span>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className="space-y-2">
          {articles.data?.length === 0 && (
            <li className="text-sm text-neutral-500">{t('connaissance.aucun')}</li>
          )}

          {articles.data?.map((resume) => (
            <li key={resume.id}>
              <button
                type="button"
                onClick={() => {
                  setOuvert(resume.id);
                  setEdite(null);
                }}
                className={`${carte} w-full text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
                  ouvert === resume.id ? 'border-neutral-900 dark:border-neutral-100' : ''
                }`}
              >
                <p className="font-medium">
                  {resume.isFavorite && <span className="mr-1">★</span>}
                  {resume.name}
                </p>
                <p className="mt-1 text-xs text-neutral-500">{resume.excerpt}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {resume.categoryName ?? '—'}
                  {resume.isFaq ? ` · ${t('connaissance.faq')}` : ''}
                  {!resume.isPublished ? ` · ${t('connaissance.brouillon')}` : ''} ·{' '}
                  {String(resume.viewCount)} {t('connaissance.vues')}
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="space-y-4">
          {edite && (
            <form
              className={`${carte} space-y-3`}
              onSubmit={(event) => {
                event.preventDefault();
                enregistrer.mutate(edite);
              }}
            >
              <input
                className={champ}
                required
                placeholder={t('connaissance.titreArticle')}
                value={edite.valeurs.name}
                onChange={(event) => {
                  maj({ name: event.target.value });
                }}
              />

              <textarea
                className={`${champ} h-64`}
                required
                placeholder={t('connaissance.contenu')}
                value={edite.valeurs.content}
                onChange={(event) => {
                  maj({ content: event.target.value });
                }}
              />

              <div className="flex flex-wrap items-center gap-4 text-sm">
                <select
                  className={`${champ} w-auto`}
                  value={edite.valeurs.categoryId ?? ''}
                  onChange={(event) => {
                    maj({
                      categoryId: event.target.value === '' ? null : Number(event.target.value),
                    });
                  }}
                >
                  <option value="">{t('connaissance.sansCategorie')}</option>
                  {categories.data?.map((categorieOption) => (
                    <option key={categorieOption.id} value={categorieOption.id}>
                      {categorieOption.completeName}
                    </option>
                  ))}
                </select>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={edite.valeurs.isPublished}
                    onChange={(event) => {
                      maj({ isPublished: event.target.checked });
                    }}
                  />
                  <span>{t('connaissance.publie')}</span>
                </label>

                <label className="flex items-center gap-2" title={t('connaissance.faqAide')}>
                  <input
                    type="checkbox"
                    checked={edite.valeurs.isFaq}
                    onChange={(event) => {
                      maj({ isFaq: event.target.checked });
                    }}
                  />
                  <span>{t('connaissance.faqPublique')}</span>
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

              {edite.valeurs.isFaq && (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {t('connaissance.faqAide')}
                </p>
              )}

              <div className="flex gap-2">
                <button type="submit" className={bouton}>
                  {t('commun.enregistrer')}
                </button>
                <button
                  type="button"
                  className={bouton}
                  onClick={() => {
                    setEdite(null);
                  }}
                >
                  {t('commun.annuler')}
                </button>
              </div>
            </form>
          )}

          {!edite && article.data && (
            <article className={`${carte} space-y-3`}>
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{article.data.name}</h3>
                  <p className="text-xs text-neutral-500">
                    {article.data.categoryName ?? '—'} · {t('connaissance.version')}{' '}
                    {String(article.data.version)} · {article.data.author ?? '—'} ·{' '}
                    {String(article.data.viewCount)} {t('connaissance.vues')}
                  </p>
                </div>

                <div className="flex gap-1">
                  <button
                    type="button"
                    className={bouton}
                    onClick={() => {
                      basculerFavori.mutate(article.data.id);
                    }}
                  >
                    {article.data.isFavorite
                      ? `★ ${t('connaissance.retirerFavori')}`
                      : `☆ ${t('connaissance.ajouterFavori')}`}
                  </button>
                  {peutEcrire && (
                    <>
                      <button
                        type="button"
                        className={bouton}
                        onClick={() => {
                          setEdite({ id: article.data.id, valeurs: versFormulaire(article.data) });
                        }}
                      >
                        {t('commun.modifier')}
                      </button>
                      <button
                        type="button"
                        className={bouton}
                        onClick={() => {
                          supprimer.mutate(article.data.id);
                        }}
                      >
                        {t('calendriers.supprimer')}
                      </button>
                    </>
                  )}
                </div>
              </header>

              <div className="whitespace-pre-wrap text-sm">{article.data.content}</div>

              {revisions.data && revisions.data.length > 0 && (
                <details className="text-xs text-neutral-500">
                  <summary className="cursor-pointer">
                    {t('connaissance.historique')} ({String(revisions.data.length)})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {revisions.data.map((revision) => (
                      <li key={revision.version}>
                        v{String(revision.version)} — {revision.author ?? '—'} ·{' '}
                        {new Date(revision.createdAt).toLocaleString()} — {revision.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          )}

          {!edite && !article.data && (
            <p className="text-sm text-neutral-500">{t('connaissance.choisir')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
