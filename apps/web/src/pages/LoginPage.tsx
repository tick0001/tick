import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Field, Input, Marque } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

/**
 * Découpe le message d'accueil en segments, et fait des adresses des liens.
 *
 * Le message reste du texte : c'est du contenu de configuration affiché sur une
 * page que tout le monde atteint, et l'interpréter comme du balisage ouvrirait
 * une injection. Les seuls éléments promus en lien sont ceux qui commencent par
 * `http://` ou `https://`, et l'adresse est reconstruite depuis ce qui a été
 * reconnu — jamais depuis une chaîne fournie telle quelle. Un `javascript:` ne
 * peut donc pas devenir cliquable.
 *
 * Sans cela, un exploitant qui renvoie vers une page d'aide oblige le lecteur à
 * recopier l'adresse à la main, au moment précis où il cherche à entrer.
 */
const ADRESSE = /(https?:\/\/\S+)/g;

/** Ponctuation finale : elle appartient à la phrase, pas à l'adresse. */
const FIN_DE_PHRASE = /[.,;:!?)]+$/;

function segmenter(message: string): ReactNode[] {
  return message.split(ADRESSE).map((morceau, index) => {
    if (!/^https?:\/\//.test(morceau)) return morceau;

    const suffixe = FIN_DE_PHRASE.exec(morceau)?.[0] ?? '';
    const adresse = suffixe ? morceau.slice(0, -suffixe.length) : morceau;

    return (
      <Fragment key={index}>
        <a
          href={adresse}
          target="_blank"
          rel="noreferrer noopener"
          className="text-brand-ink underline underline-offset-2"
        >
          {adresse}
        </a>
        {suffixe}
      </Fragment>
    );
  });
}

/**
 * Écran de connexion.
 *
 * Deux colonnes sur grand écran : le formulaire à gauche, un aplat de marque à
 * droite. La colonne de droite ne porte aucune information indispensable, et
 * disparaît en dessous de `lg` — c'est ce qui permet de la rendre ample sans
 * rien devoir réorganiser sur téléphone.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  /**
   * Message d'accueil de l'exploitant, s'il en a posé un.
   *
   * `retry: false` et aucune gestion d'erreur : c'est une information de
   * confort, et l'écran de connexion doit rester utilisable si l'API ne répond
   * pas — c'est même le moment où elle a le plus de chances de ne pas répondre.
   */
  const instance = useQuery({
    queryKey: ['instance'],
    queryFn: () => api.instance(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const connexion = useMutation({
    mutationFn: () => api.login({ username, password }),
    onSuccess: (session) => {
      queryClient.setQueryData(['session'], session);
    },
  });

  const message =
    connexion.error instanceof ApiError && connexion.error.status === 401
      ? t('connexion.echec')
      : connexion.error
        ? t('connexion.indisponible')
        : null;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    connexion.mutate();
  };

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center p-6">
        <form onSubmit={soumettre} className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <Marque taille="lg" />
            <h1 className="text-3xl font-bold tracking-tight">Tick&amp;</h1>
            <p className="text-sm text-muted">{t('connexion.sousTitre')}</p>
          </div>

          {/*
            Rendu comme du texte, jamais comme du HTML : c'est du contenu de
            configuration affiché sur une page que tout le monde atteint. Le
            traitement est neutre — filet et fond creusé, sans couleur de
            signal, qui reste réservée à ce sur quoi on agit.

            `whitespace-pre-line` conserve les retours à la ligne du message :
            sans lui le HTML les avale, et un exploitant qui écrit une liste
            obtient un paragraphe compact. Les espaces multiples, eux, restent
            réduits — c'est la mise en page qui est respectée, pas l'alignement.
          */}
          {instance.data?.banner ? (
            <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-sm whitespace-pre-line text-muted">
              {segmenter(instance.data.banner)}
            </p>
          ) : null}

          <div className="space-y-4">
            <Field label={t('connexion.identifiant')}>
              <Input
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label={t('connexion.motDePasse')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                autoComplete="current-password"
                required
              />
            </Field>
          </div>

          {message && (
            <p
              role="alert"
              className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical-ink"
            >
              {message}
            </p>
          )}

          <Button
            type="submit"
            variante="primaire"
            disabled={connexion.isPending}
            className="w-full"
          >
            {connexion.isPending ? t('connexion.enCours') : t('connexion.valider')}
          </Button>
        </form>
      </div>

      {/*
        Le panneau de droite est en encre, pas en vermillon.
        Le vermillon est la couleur de signal : il designe ce sur quoi on agit.
        L'etaler sur une demi-page le banaliserait, et le bouton « Se connecter »
        ne se distinguerait plus de son fond. L'encre chaude tient l'aplat,
        laisse la couleur au seul bouton, et fait de l'esperluette la marque.
      */}
      <aside className="relative hidden overflow-hidden bg-ink lg:block">
        {/* L'esperluette en filigrane, debordant volontairement du cadre : c'est
            le signe du nom, employe ici comme motif plutot que comme logo. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-16 -bottom-24 leading-none font-bold text-canvas/[0.06] select-none"
          style={{ fontSize: '32rem' }}
        >
          &amp;
        </span>

        <div className="relative flex h-full flex-col justify-end gap-4 p-12">
          <span aria-hidden className="h-0.5 w-12 bg-brand" />
          <p className="max-w-md text-2xl leading-snug font-bold text-balance text-canvas">
            {t('connexion.accroche')}
          </p>
          <p className="max-w-md text-sm text-canvas/60">{t('connexion.accrocheDetail')}</p>
        </div>
      </aside>
    </main>
  );
}
