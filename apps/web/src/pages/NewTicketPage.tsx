import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTicket, TicketTemplate } from '@tick/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '@/lib/api';
import { CONTROLE, PageHeader } from '@/components/ui/primitives';

const VIDE: CreateTicket = {
  name: '',
  content: '',
  type: 'incident',
  urgency: 3,
  impact: 3,
  actors: [],
};

/**
 * Création d'un ticket, pilotée par un gabarit.
 *
 * Les trois natures du gabarit se traduisent directement à l'écran : une valeur
 * préremplie initialise le champ sans le verrouiller, un champ obligatoire porte
 * une astérisque et bloque l'envoi, un champ masqué disparaît. Le serveur
 * revérifie de toute façon : le gabarit n'est pas une garantie côté client.
 */
export function NewTicketPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const gabarits = useQuery({ queryKey: ['templates'], queryFn: api.templates, retry: false });

  /**
   * Categories du perimetre, filtrees par le serveur.
   *
   * `retry: false` : sans categorie definie dans l'entite, la liste revient
   * vide et le champ disparait -- ce n'est pas une panne, et reessayer
   * n'inventerait pas de referentiel.
   */
  const categories = useQuery({
    queryKey: ['itil-categories', 'ticket'],
    queryFn: () => api.itilCategories({ type: 'ticket', selectable: true }),
    retry: false,
  });
  const [gabaritId, setGabaritId] = useState<number | null>(null);
  const [saisie, setSaisie] = useState<CreateTicket>(VIDE);

  const gabarit: TicketTemplate | null = useMemo(
    () => gabarits.data?.find((modele) => modele.id === gabaritId) ?? null,
    [gabarits.data, gabaritId],
  );

  const masque = (champ: string): boolean => gabarit?.hidden.includes(champ) ?? false;
  const requis = (champ: string): boolean => gabarit?.mandatory.includes(champ) ?? false;

  const appliquerGabarit = (id: number | null): void => {
    setGabaritId(id);

    const modele = gabarits.data?.find((element) => element.id === id);

    if (!modele) return;

    setSaisie((precedent) => ({
      ...precedent,
      ...(typeof modele.predefined['type'] === 'string'
        ? { type: modele.predefined['type'] as CreateTicket['type'] }
        : {}),
      ...(typeof modele.predefined['urgency'] === 'number'
        ? { urgency: modele.predefined['urgency'] }
        : {}),
      ...(typeof modele.predefined['impact'] === 'number'
        ? { impact: modele.predefined['impact'] }
        : {}),
    }));
  };

  const creation = useMutation({
    mutationFn: () =>
      api.createTicket({ ...saisie, ...(gabaritId ? { templateId: gabaritId } : {}) }),
    onSuccess: async (ticket) => {
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void navigate(`/tickets/${String(ticket.id)}`);
    },
  });

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    creation.mutate();
  };

  return (
    <form onSubmit={soumettre} className="mx-auto max-w-4xl space-y-5">
      <PageHeader title={t('creation.titre')} description={t('creation.intro')} />

      {/*
        Deux colonnes, et non une pile de champs pleine largeur.
        A gauche ce qu'on ecrit -- le sujet et le recit, qui prennent de la
        place ; a droite ce qu'on choisit -- gabarit, type, severites, qui
        tiennent en une ligne chacun. Empiler les huit champs sur toute la
        largeur etire le sujet sur 40 caracteres inutiles et repousse le bouton
        de creation sous la ligne de flottaison.
      */}
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          <label className="block space-y-1">
            <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
              {t('creation.sujet')}
              {requis('name') && <span className="text-brand"> *</span>}
            </span>
            <input
              value={saisie.name}
              required={requis('name')}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, name: event.target.value }));
              }}
              className={CONTROLE}
            />
          </label>

          <label className="block space-y-1">
            <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
              {t('creation.description')}
              {requis('content') && <span className="text-brand"> *</span>}
            </span>
            <textarea
              value={saisie.content}
              required={requis('content')}
              rows={6}
              onChange={(event) => {
                setSaisie((precedent) => ({ ...precedent, content: event.target.value }));
              }}
              className={CONTROLE}
            />
          </label>
        </div>

        <aside className="space-y-4">
          <label className="block space-y-1">
            <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">{t('gabarits.titre')}</span>
            <select
              value={gabaritId ?? ''}
              onChange={(event) => {
                appliquerGabarit(event.target.value ? Number(event.target.value) : null);
              }}
              className={CONTROLE}
            >
              <option value="">{t('gabarits.aucun')}</option>
              {(gabarits.data ?? []).map((modele) => (
                <option key={modele.id} value={modele.id}>
                  {modele.name}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-4">
            {/*
              La categorie precede le type et les severites : c'est elle qui
              oriente le ticket vers la bonne file, et la choisir en dernier
              revient a la choisir apres avoir cesse d'y penser.

              Le champ ne parait pas si le perimetre n'a aucune categorie : un
              selecteur vide se lit comme une panne, alors qu'il n'y a
              simplement rien a proposer.
            */}
            {!masque('categoryId') && (categories.data?.length ?? 0) > 0 && (
              <label className="block space-y-1">
                <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                  {t('tickets.categorie')}
                  {requis('categoryId') && <span className="text-brand"> *</span>}
                </span>
                <select
                  value={saisie.categoryId ?? ''}
                  required={requis('categoryId')}
                  onChange={(event) => {
                    setSaisie((precedent) => ({
                      ...precedent,
                      categoryId: event.target.value ? Number(event.target.value) : null,
                    }));
                  }}
                  className={CONTROLE}
                >
                  <option value="">—</option>
                  {(categories.data ?? []).map((categorie) => (
                    <option key={categorie.id} value={categorie.id}>
                      {categorie.completeName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!masque('type') && (
              <label className="block space-y-1">
                <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">{t('creation.type')}</span>
                <select
                  value={saisie.type}
                  onChange={(event) => {
                    setSaisie((precedent) => ({
                      ...precedent,
                      type: event.target.value as CreateTicket['type'],
                    }));
                  }}
                  className={CONTROLE}
                >
                  <option value="incident">{t('tickets.types.incident')}</option>
                  <option value="request">{t('tickets.types.request')}</option>
                </select>
              </label>
            )}

            {(['urgency', 'impact'] as const).map((cle) =>
              masque(cle) ? null : (
                <label key={cle} className="block space-y-1">
                  <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
                    {cle === 'urgency' ? t('tickets.detail.urgence') : t('tickets.detail.impact')}
                  </span>
                  <select
                    value={saisie[cle]}
                    onChange={(event) => {
                      setSaisie((precedent) => ({
                        ...precedent,
                        [cle]: Number(event.target.value),
                      }));
                    }}
                    className={CONTROLE}
                  >
                    {[1, 2, 3, 4, 5].map((niveau) => (
                      <option key={niveau} value={niveau}>
                        {niveau}
                      </option>
                    ))}
                  </select>
                </label>
              ),
            )}
          </div>
        </aside>
      </div>

      {creation.error && (
        <p className="border border-critical/30 bg-critical-soft p-3 text-sm text-critical-ink">
          {creation.error.message}
        </p>
      )}

      {/* Le pied d'action est separe par un filet : il clot la saisie, il n'en
          fait pas partie. */}
      <div className="flex items-center gap-3 border-t border-line pt-4">
        <button
          type="submit"
          disabled={creation.isPending}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand shadow-card transition hover:bg-brand-hover disabled:opacity-50"
        >
          {t('creation.creer')}
        </button>
        <button
          type="button"
          onClick={() => void navigate('/tickets')}
          className="rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-sunken"
        >
          {t('creation.annuler')}
        </button>
      </div>
    </form>
  );
}
