import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContext, SettingKey, WriteSettings } from '@tick/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FieldError,
  Input,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Matrice par défaut, reprise du serveur quand aucune valeur n'existe. */
const MATRICE_DEFAUT: number[][] = [
  [1, 1, 2, 2, 2],
  [1, 2, 2, 3, 3],
  [2, 2, 3, 4, 4],
  [2, 3, 4, 4, 5],
  [2, 3, 4, 5, 5],
];

type Brouillon = Record<string, unknown>;

/**
 * Réglages hérités par entité.
 *
 * Chaque valeur affiche son **origine** : posée ici, ou héritée d'un ancêtre.
 * C'est le point de l'écran — « 7 jours » ne dit pas si la valeur vient de la
 * racine, et modifier une valeur héritée la détache du parent définitivement.
 * Le bouton « rétablir l'héritage » est donc l'action inverse, et elle doit
 * exister : sans elle, on ne pourrait jamais revenir en arrière.
 */
export function SettingsPage({ session }: { session: SessionContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [entite, setEntite] = useState(session.entity.id);
  const [brouillon, setBrouillon] = useState<Brouillon>({});

  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities, retry: false });
  const gabarits = useQuery({ queryKey: ['templates'], queryFn: api.templates, retry: false });

  const reglages = useQuery({
    queryKey: ['entity-settings', entite],
    queryFn: () => api.entitySettings(entite),
    retry: false,
  });

  // Changer d'entité repart de zéro : garder les modifications non enregistrées
  // les appliquerait à une entité que l'utilisateur n'a pas regardée.
  useEffect(() => {
    setBrouillon({});
  }, [entite]);

  const enregistrer = useMutation({
    mutationFn: () => api.writeEntitySettings(entite, brouillon as WriteSettings),
    onSuccess: async () => {
      setBrouillon({});
      await queryClient.invalidateQueries({ queryKey: ['entity-settings', entite] });
      // La configuration héritée alimente la matrice de priorité et les adresses
      // d'expédition : les vues qui s'en servent doivent la relire.
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const interdit = reglages.error instanceof ApiError && reglages.error.status === 403;

  /** Valeur affichée : le brouillon s'il existe, la valeur résolue sinon. */
  const valeurDe = (cle: SettingKey): unknown =>
    cle in brouillon ? brouillon[cle] : reglages.data?.settings.find((r) => r.key === cle)?.value;

  const poser = (cle: SettingKey, valeur: unknown): void => {
    setBrouillon((precedent) => ({ ...precedent, [cle]: valeur }));
  };

  const origine = (cle: SettingKey): { texte: string; propre: boolean } | null => {
    const resolu = reglages.data?.settings.find((r) => r.key === cle);

    if (!resolu?.origin) return null;

    return {
      texte: resolu.isOwn
        ? t('administration.reglages.propre')
        : `${t('administration.reglages.herite')} ${resolu.origin.completeName}`,
      propre: resolu.isOwn,
    };
  };

  /** Étiquette d'origine et bouton de retour à l'héritage. */
  const Origine = ({ cle }: { cle: SettingKey }) => {
    const info = origine(cle);

    return (
      <span className="flex items-center gap-2">
        {info ? (
          <Badge ton={info.propre ? 'marque' : 'neutre'}>{info.texte}</Badge>
        ) : (
          <span className="text-xs text-faint">{t('administration.reglages.aucune')}</span>
        )}
        {info?.propre && (
          <button
            type="button"
            onClick={() => {
              poser(cle, null);
            }}
            className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {t('administration.reglages.retablirHeritage')}
          </button>
        )}
      </span>
    );
  };

  const matrice = (valeurDe('priorityMatrix') as number[][] | null) ?? MATRICE_DEFAUT;

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.reglages.titre')}
        description={t('administration.reglages.description')}
        action={
          <Button
            variante="primaire"
            disabled={Object.keys(brouillon).length === 0 || enregistrer.isPending}
            onClick={() => {
              enregistrer.mutate();
            }}
          >
            {t('administration.reglages.enregistrer')}
          </Button>
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      <Field label={t('administration.reglages.entite')} className="max-w-md">
        <Select
          value={entite}
          onChange={(event) => {
            setEntite(Number(event.target.value));
          }}
        >
          {(entites.data ?? []).map((valeur) => (
            <option key={valeur.id} value={valeur.id}>
              {valeur.completeName}
            </option>
          ))}
        </Select>
      </Field>

      {reglages.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('courriel.titre')} />
            <CardBody className="space-y-4">
              <Field label={t('administration.reglages.cles.mailFrom')}>
                <Input
                  type="email"
                  value={(valeurDe('mailFrom') as string | null) ?? ''}
                  onChange={(event) => {
                    poser('mailFrom', event.target.value || null);
                  }}
                />
                <Origine cle="mailFrom" />
              </Field>

              <Field label={t('administration.reglages.cles.mailReplyTo')}>
                <Input
                  type="email"
                  value={(valeurDe('mailReplyTo') as string | null) ?? ''}
                  onChange={(event) => {
                    poser('mailReplyTo', event.target.value || null);
                  }}
                />
                <Origine cle="mailReplyTo" />
              </Field>

              <Field label={t('administration.reglages.cles.defaultLocale')}>
                <Select
                  value={(valeurDe('defaultLocale') as string | null) ?? ''}
                  onChange={(event) => {
                    poser('defaultLocale', event.target.value || null);
                  }}
                >
                  <option value="">—</option>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
                <Origine cle="defaultLocale" />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('tickets.titre')} />
            <CardBody className="space-y-4">
              <Field label={t('administration.reglages.cles.autoCloseDelayDays')}>
                <Input
                  type="number"
                  min={0}
                  value={(valeurDe('autoCloseDelayDays') as number | null) ?? ''}
                  onChange={(event) => {
                    poser(
                      'autoCloseDelayDays',
                      event.target.value === '' ? null : Number(event.target.value),
                    );
                  }}
                />
                <Origine cle="autoCloseDelayDays" />
              </Field>

              <Field label={t('administration.reglages.cles.autoPurgeDelayDays')}>
                <Input
                  type="number"
                  min={0}
                  value={(valeurDe('autoPurgeDelayDays') as number | null) ?? ''}
                  onChange={(event) => {
                    poser(
                      'autoPurgeDelayDays',
                      event.target.value === '' ? null : Number(event.target.value),
                    );
                  }}
                />
                <Origine cle="autoPurgeDelayDays" />
              </Field>

              <Field label={t('administration.reglages.cles.defaultTicketTemplateId')}>
                <Select
                  value={(valeurDe('defaultTicketTemplateId') as number | null) ?? ''}
                  onChange={(event) => {
                    poser(
                      'defaultTicketTemplateId',
                      event.target.value === '' ? null : Number(event.target.value),
                    );
                  }}
                >
                  <option value="">—</option>
                  {(gabarits.data ?? []).map((gabarit) => (
                    <option key={gabarit.id} value={gabarit.id}>
                      {gabarit.name}
                    </option>
                  ))}
                </Select>
                <Origine cle="defaultTicketTemplateId" />
              </Field>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title={t('administration.reglages.cles.priorityMatrix')}
              action={<Origine cle="priorityMatrix" />}
            />
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">{t('administration.reglages.matriceAide')}</p>

              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="p-1" />
                      {[1, 2, 3, 4, 5].map((impact) => (
                        <th key={impact} className="p-1 text-xs font-medium text-faint">
                          {t('tickets.detail.impact')} {impact}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrice.map((ligne, urgence) => (
                      <tr key={urgence}>
                        <th className="p-1 text-right text-xs font-medium whitespace-nowrap text-faint">
                          {t('tickets.detail.urgence')} {urgence + 1}
                        </th>
                        {ligne.map((cellule, impact) => (
                          <td key={impact} className="p-1">
                            <select
                              value={cellule}
                              onChange={(event) => {
                                const copie = matrice.map((rangee) => [...rangee]);

                                copie[urgence]![impact] = Number(event.target.value);
                                poser('priorityMatrix', copie);
                              }}
                              className={cn(
                                'h-8 w-14 rounded-lg border border-line text-center text-sm font-medium',
                                cellule >= 5
                                  ? 'bg-critical-soft text-critical-ink'
                                  : cellule === 4
                                    ? 'bg-caution-soft text-caution-ink'
                                    : 'bg-surface text-ink',
                              )}
                            >
                              {[1, 2, 3, 4, 5].map((valeur) => (
                                <option key={valeur} value={valeur}>
                                  {valeur}
                                </option>
                              ))}
                            </select>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <FieldError>{enregistrer.error?.message}</FieldError>
    </section>
  );
}
