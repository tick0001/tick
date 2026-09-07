import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KbArticle, UpsertKbArticle } from '@tick/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePeut } from '@/lib/session';
import {
  PageHeader,
  FilterBar,
  BOUTON,
  BOUTON_PRIMAIRE,
  CARTE,
  CONTROLE,
} from '@/components/ui/primitives';

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
export function KnowledgePage() {
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
      <p className="rounded-md border border-caution/30 bg-caution-soft p-3 text-sm text-caution-ink">
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
  const peutEcrire = usePeut('kb', 'update');

  const maj = (patch: Partial<UpsertKbArticle>): void => {
    if (!edite) return;

    setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('connaissance.titre')}
        description={t('connaissance.intro')}
        action={
          peutEcrire && (
            <button
              type="button"
              className={BOUTON_PRIMAIRE}
              onClick={() => {
                setEdite({ valeurs: articleVide() });
                setOuvert(null);
              }}
            >
              {t('connaissance.nouveau')}
            </button>
          )
        }
      />

      {erreur && <p className="text-sm text-critical">{erreur}</p>}

      <FilterBar>
        <input
          className={cn(CONTROLE, 'w-64')}
          placeholder={t('connaissance.rechercher')}
          value={recherche}
          onChange={(event) => {
            setRecherche(event.target.value);
          }}
        />

        <select
          className={cn(CONTROLE, 'w-auto')}
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
      </FilterBar>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className="divide-y divide-line border-y border-line">
          {articles.data?.length === 0 && (
            <li className="text-sm text-muted">{t('connaissance.aucun')}</li>
          )}

          {articles.data?.map((resume) => (
            <li key={resume.id}>
              <button
                type="button"
                onClick={() => {
                  setOuvert(resume.id);
                  setEdite(null);
                }}
                className={cn(
                  // Une entree de liste, pas une carte : empilees dans une
                  // colonne etroite, les cartes ajoutent trois bordures et deux
                  // fonds la ou un filet suffit -- et l'oeil ne descend plus.
                  'w-full border-l-2 px-3 py-3 text-left transition-colors',
                  ouvert === resume.id
                    ? 'border-l-brand bg-sunken'
                    : 'border-l-transparent hover:bg-sunken',
                )}
              >
                <p className="text-sm font-semibold text-ink">
                  {resume.isFavorite && <span className="mr-1 text-caution">★</span>}
                  {resume.name}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{resume.excerpt}</p>
                <p className="mt-1.5 text-[11px] tracking-wide text-faint uppercase">
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
              className={`${CARTE} space-y-3`}
              onSubmit={(event) => {
                event.preventDefault();
                enregistrer.mutate(edite);
              }}
            >
              <input
                className={CONTROLE}
                required
                placeholder={t('connaissance.titreArticle')}
                value={edite.valeurs.name}
                onChange={(event) => {
                  maj({ name: event.target.value });
                }}
              />

              <textarea
                className={cn(CONTROLE, 'h-64')}
                required
                placeholder={t('connaissance.contenu')}
                value={edite.valeurs.content}
                onChange={(event) => {
                  maj({ content: event.target.value });
                }}
              />

              <div className="flex flex-wrap items-center gap-4 text-sm">
                <select
                  className={cn(CONTROLE, 'w-auto')}
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
                <p className="rounded-md border border-caution/30 bg-caution-soft p-2 text-xs text-caution-ink">
                  {t('connaissance.faqAide')}
                </p>
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

          {!edite && article.data && (
            <article className={`${CARTE} space-y-3`}>
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{article.data.name}</h3>
                  <p className="text-xs text-muted">
                    {article.data.categoryName ?? '—'} · {t('connaissance.version')}{' '}
                    {String(article.data.version)} · {article.data.author ?? '—'} ·{' '}
                    {String(article.data.viewCount)} {t('connaissance.vues')}
                  </p>
                </div>

                <div className="flex gap-1">
                  <button
                    type="button"
                    className={BOUTON}
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
                        className={BOUTON}
                        onClick={() => {
                          setEdite({ id: article.data.id, valeurs: versFormulaire(article.data) });
                        }}
                      >
                        {t('commun.modifier')}
                      </button>
                      <button
                        type="button"
                        className={BOUTON}
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
                <details className="text-xs text-muted">
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
            <p className="text-sm text-muted">{t('connaissance.choisir')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
