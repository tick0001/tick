import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { profileInterfaceSchema, type ProfileRight, type UpsertProfile } from '@tick/contracts';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PiedFormulaire } from '@/components/PiedFormulaire';
import { IconPlus } from '@/components/ui/icons';
import {
  ACTION_LIGNE,
  ACTION_LIGNE_DANGER,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  FieldError,
  Input,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';
import { cn } from '@/lib/utils';

const VIDE: UpsertProfile = {
  name: '',
  interface: 'standard',
  isDefault: false,
  comment: '',
  rights: [],
};

/** Ordre d'affichage des groupes du catalogue. */
const GROUPES = ['itil', 'connaissance', 'configuration', 'administration'] as const;

/**
 * Profils et matrice de droits.
 *
 * La matrice se lit comme une grille objet × action, avec la portée en valeur.
 * « Refusé » y est une valeur explicite plutôt qu'une case décochée : l'absence
 * de droit est une décision, et la rendre visible évite de croire qu'on a oublié
 * de la prendre.
 */
export function ProfilesPage() {
  const { t } = useTranslation();
  const peutEcrire = usePeut('profile', 'update');
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertProfile } | null>(null);

  const liste = useQuery({ queryKey: ['admin-profiles'], queryFn: api.profiles, retry: false });
  const catalogue = useQuery({
    queryKey: ['admin-rights'],
    queryFn: api.rightCatalogue,
    retry: false,
  });

  const enregistrer = useMutation({
    mutationFn: () => api.saveProfile(edite?.valeurs as UpsertProfile, edite?.id),
    onSuccess: async () => {
      setEdite(null);
      await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] });
      // Le profil actif peut être celui qu'on vient de modifier : la session
      // porte ses droits, et l'interface les utilise pour décider quoi montrer.
      await queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteProfile(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] });
    },
  });

  const parGroupe = useMemo(() => {
    const groupes = new Map<string, typeof catalogue.data>();

    for (const objet of catalogue.data ?? []) {
      const liste = groupes.get(objet.group) ?? [];

      liste.push(objet);
      groupes.set(objet.group, liste);
    }

    return groupes;
  }, [catalogue.data]);

  const interdit = liste.error instanceof ApiError && liste.error.status === 403;

  /** Portée accordée pour un couple objet/action, ou `null` si refusé. */
  const porteeDe = (object: string, action: string): ProfileRight['scope'] | null =>
    edite?.valeurs.rights.find((droit) => droit.object === object && droit.action === action)
      ?.scope ?? null;

  const poser = (object: string, action: string, scope: string): void => {
    if (!edite) return;

    const autres = edite.valeurs.rights.filter(
      (droit) => !(droit.object === object && droit.action === action),
    );

    setEdite({
      ...edite,
      valeurs: {
        ...edite.valeurs,
        rights: scope
          ? [...autres, { object, action, scope: scope as ProfileRight['scope'] }]
          : autres,
      },
    });
  };

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.valeurs.name.trim()) enregistrer.mutate();
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.profils.titre')}
        description={t('administration.profils.description')}
        action={
          peutEcrire ? (
            <Button
              variante="primaire"
              onClick={() => {
                setEdite({ valeurs: { ...VIDE, rights: [] } });
              }}
            >
              <IconPlus className="size-4" />
              {t('administration.profils.nouveau')}
            </Button>
          ) : undefined
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={
              edite.id === undefined ? t('administration.profils.nouveau') : edite.valeurs.name
            }
          />
          <CardBody>
            <form onSubmit={soumettre} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('administration.profils.nom')}>
                  <Input
                    value={edite.valeurs.name}
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: { ...edite.valeurs, name: event.target.value },
                      });
                    }}
                    autoFocus
                  />
                </Field>

                <Field label={t('administration.profils.interface')}>
                  <Select
                    value={edite.valeurs.interface}
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          interface: profileInterfaceSchema.parse(event.target.value),
                        },
                      });
                    }}
                  >
                    {profileInterfaceSchema.options.map((valeur) => (
                      <option key={valeur} value={valeur}>
                        {t(`administration.profils.interfaces.${valeur}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('administration.profils.commentaire')}>
                  <Input
                    value={edite.valeurs.comment ?? ''}
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: { ...edite.valeurs, comment: event.target.value },
                      });
                    }}
                  />
                </Field>
              </div>

              <Checkbox
                checked={edite.valeurs.isDefault}
                onChange={(event) => {
                  setEdite({
                    ...edite,
                    valeurs: { ...edite.valeurs, isDefault: event.target.checked },
                  });
                }}
                label={<span className="text-sm">{t('administration.profils.parDefaut')}</span>}
              />

              <div className="space-y-4">
                <h4 className="text-sm font-semibold">{t('administration.profils.matrice')}</h4>

                {GROUPES.map((groupe) => {
                  const objets = parGroupe.get(groupe) ?? [];

                  if (objets.length === 0) return null;

                  return (
                    <div key={groupe} className="space-y-2">
                      <p className="text-xs font-semibold tracking-wider text-faint uppercase">
                        {t(`administration.profils.groupes.${groupe}`)}
                      </p>

                      <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full text-left text-sm">
                          <tbody>
                            {objets.map((objet) => (
                              <tr
                                key={objet.object}
                                className="border-b border-line/70 last:border-0"
                              >
                                <td className="w-52 px-3 py-2 font-medium">{objet.label}</td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-2">
                                    {objet.actions.map((action) => {
                                      const portee = porteeDe(objet.object, action);

                                      return (
                                        <label
                                          key={action}
                                          className={cn(
                                            'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors',
                                            portee
                                              ? 'border-brand/40 bg-brand-soft'
                                              : 'border-line bg-surface',
                                          )}
                                        >
                                          <span
                                            className={cn(
                                              'font-medium',
                                              portee ? 'text-brand-ink' : 'text-muted',
                                            )}
                                          >
                                            {t(
                                              `administration.actions.${action}` as 'administration.actions.read',
                                            )}
                                          </span>
                                          <select
                                            value={portee ?? ''}
                                            onChange={(event) => {
                                              poser(objet.object, action, event.target.value);
                                            }}
                                            className="rounded-md border-0 bg-transparent py-0 text-xs text-ink focus:outline-none"
                                          >
                                            <option value="">
                                              {t('administration.profils.refuse')}
                                            </option>
                                            {objet.scopes.map((scope) => (
                                              <option key={scope} value={scope}>
                                                {t(
                                                  `administration.portees.${scope}` as 'administration.portees.own',
                                                )}
                                              </option>
                                            ))}
                                          </select>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              <PiedFormulaire
                erreur={enregistrer.error?.message}
                enCours={enregistrer.isPending}
                onAnnuler={() => {
                  setEdite(null);
                }}
              />
            </form>
          </CardBody>
        </Card>
      )}

      {liste.data && liste.data.length === 0 && (
        <EmptyState title={t('administration.profils.aucun')} />
      )}

      {/*
        Une liste a filets, pas une grille de cartes.
        Un profil est une liste de droits : sur deux colonnes, la ligne de droits
        se coupe au bout de huit et perd ce qu'elle avait a montrer. Pleine
        largeur, elle se lit -- et deux profils se comparent en balayant la
        colonne, ce qu'une grille interdit.
      */}
      <div className="border-y border-line">
        {(liste.data ?? []).map((profil) => (
          <div key={profil.id} className="border-b border-line/70 last:border-0">
            <div className="space-y-2 px-1 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{profil.name}</h3>
                <Badge ton={profil.interface === 'self_service' ? 'info' : 'marque'}>
                  {t(`administration.profils.interfaces.${profil.interface}`)}
                </Badge>
                {profil.isDefault && (
                  <Badge ton="positif">{t('administration.profils.parDefaut')}</Badge>
                )}
                <span className="ml-auto text-xs text-faint">
                  {profil.usageCount} {t('administration.profils.utilisations')}
                </span>
              </div>

              {profil.comment && <p className="text-sm text-muted">{profil.comment}</p>}

              {/* Les droits en chasse fixe : ce sont des identifiants, pas de
                  la prose, et l'alignement rend la comparaison possible. */}
              <p className="font-mono text-[11px] leading-relaxed text-faint">
                {profil.rights.length === 0
                  ? t('administration.profils.aucunDroit')
                  : profil.rights.map((droit) => `${droit.object}:${droit.action}`).join('  ')}
              </p>

              <div className="flex gap-2 pt-1">
                {peutEcrire && (
                  <button
                    type="button"
                    className={ACTION_LIGNE}
                    onClick={() => {
                      setEdite({
                        id: profil.id,
                        valeurs: {
                          name: profil.name,
                          interface: profil.interface,
                          isDefault: profil.isDefault,
                          comment: profil.comment ?? '',
                          rights: profil.rights,
                        },
                      });
                    }}
                  >
                    {t('entites.modifier')}
                  </button>
                )}
                {peutEcrire && (
                  <button
                    type="button"
                    className={ACTION_LIGNE_DANGER}
                    disabled={profil.usageCount > 0}
                    onClick={() => {
                      supprimer.mutate(profil.id);
                    }}
                  >
                    {t('entites.supprimer')}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <FieldError>{supprimer.error?.message}</FieldError>
    </section>
  );
}
