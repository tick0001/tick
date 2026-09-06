import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

/**
 * FAQ publique, sans session.
 *
 * Un article n'y figure que si quelqu'un a coché « FAQ publique » : la page ne
 * décide de rien, elle affiche ce qui a été publié.
 */
export function FaqPage() {
  const { t } = useTranslation();
  const [recherche, setRecherche] = useState('');
  const [ouvert, setOuvert] = useState<number | null>(null);

  const articles = useQuery({
    queryKey: ['faq', recherche],
    queryFn: () => api.faq(recherche || undefined),
    retry: false,
  });

  const article = useQuery({
    queryKey: ['faq-article', ouvert],
    queryFn: () => api.faqArticle(ouvert ?? 0),
    enabled: ouvert !== null,
    retry: false,
  });

  return (
    <main className="mx-auto min-h-dvh max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('faq.titre')}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('faq.description')}</p>
      </header>

      <input
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        placeholder={t('faq.rechercher')}
        value={recherche}
        onChange={(event) => {
          setRecherche(event.target.value);
          setOuvert(null);
        }}
      />

      {articles.data?.length === 0 && <p className="text-sm text-neutral-500">{t('faq.aucun')}</p>}

      <ul className="space-y-2">
        {articles.data?.map((resume) => (
          <li
            key={resume.id}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800"
          >
            <button
              type="button"
              className="w-full px-4 py-3 text-left"
              onClick={() => {
                setOuvert(ouvert === resume.id ? null : resume.id);
              }}
            >
              <p className="font-medium">{resume.name}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {resume.categoryName ?? ''}
                {resume.categoryName ? ' · ' : ''}
                {ouvert === resume.id ? '' : resume.excerpt}
              </p>
            </button>

            {ouvert === resume.id && article.data && (
              <div className="whitespace-pre-wrap border-t border-neutral-200 px-4 py-3 text-sm dark:border-neutral-800">
                {article.data.content}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
