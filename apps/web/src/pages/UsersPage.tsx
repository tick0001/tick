import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpsertUser, UserDetail } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconRecherche } from '@/components/ui/icons';
import {
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
  TableWrap,
  Td,
  Th,
  Tr,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';

const VIDE: UpsertUser = {
  username: '',
  firstName: '',
  lastName: '',
  email: '',
  locale: '',
  isActive: true,
};

/**
 * Comptes et habilitations.
 *
 * L'habilitation est le cœur de l'écran, pas un détail de la fiche : un compte
 * sans habilitation ne peut pas se connecter, et c'est l'erreur qu'on commet
 * une fois avant de la retenir. Elle est donc rappelée explicitement plutôt que
 * laissée à déduire d'une liste vide.
 */
export function UsersPage() {
  const { t, i18n } = useTranslation();
  const peutModifier = usePeut('user', 'update');
  const peutEcrire = usePeut('user', 'create');
  const queryClient = useQueryClient();

  const [recherche, setRecherche] = useState('');
  const [inactifs, setInactifs] = useState(false);
  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertUser } | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);

  const liste = useQuery({
    queryKey: ['admin-users', recherche, inactifs],
    queryFn: () => api.users({ search: recherche || undefined, inactive: inactifs }),
    retry: false,
  });

  const profils = useQuery({ queryKey: ['admin-profiles'], queryFn: api.profiles, retry: false });
  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities, retry: false });

  const detail = useQuery({
    queryKey: ['admin-user', ouvert],
    queryFn: () => api.user(ouvert as number),
    enabled: ouvert !== null,
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-user'] });
  };

  const enregistrer = useMutation({
    mutationFn: () => api.saveUser(edite?.valeurs as UpsertUser, edite?.id),
    onSuccess: async () => {
      setEdite(null);
      await rafraichir();
    },
  });

  const accorder = useMutation({
    mutationFn: (choix: { entityId: number; profileId: number; isRecursive: boolean }) =>
      api.grant(ouvert as number, choix),
    onSuccess: rafraichir,
  });

  const retirer = useMutation({
    mutationFn: (cible: { entityId: number; profileId: number }) =>
      api.revoke(ouvert as number, cible.entityId, cible.profileId),
    onSuccess: rafraichir,
  });

  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const interdit = liste.error instanceof ApiError && liste.error.status === 403;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.valeurs.username.trim()) enregistrer.mutate();
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.utilisateurs.titre')}
        description={t('administration.utilisateurs.description')}
        action={
          peutEcrire ? (
            <Button
              variante="primaire"
              onClick={() => {
                setEdite({ valeurs: { ...VIDE } });
              }}
            >
              <IconPlus className="size-4" />
              {t('administration.utilisateurs.nouveau')}
            </Button>
          ) : undefined
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={
              edite.id === undefined
                ? t('administration.utilisateurs.nouveau')
                : edite.valeurs.username
            }
          />
          <CardBody>
            <form onSubmit={soumettre} className="grid gap-4 sm:grid-cols-2">
              <Field label={t('administration.utilisateurs.identifiant')}>
                <Input
                  value={edite.valeurs.username}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, username: event.target.value },
                    });
                  }}
                  autoFocus
                />
              </Field>

              <Field label={t('administration.utilisateurs.courriel')}>
                <Input
                  type="email"
                  value={edite.valeurs.email ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, email: event.target.value },
                    });
                  }}
                />
              </Field>

              <Field label={t('administration.utilisateurs.prenom')}>
                <Input
                  value={edite.valeurs.firstName ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, firstName: event.target.value },
                    });
                  }}
                />
              </Field>

              <Field label={t('administration.utilisateurs.nom')}>
                <Input
                  value={edite.valeurs.lastName ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, lastName: event.target.value },
                    });
                  }}
                />
              </Field>

              <Field
                label={t('administration.utilisateurs.motDePasse')}
                hint={
                  edite.id === undefined
                    ? undefined
                    : t('administration.utilisateurs.motDePasseAide')
                }
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={edite.valeurs.password ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: {
                        ...edite.valeurs,
                        ...(event.target.value ? { password: event.target.value } : {}),
                      },
                    });
                  }}
                />
              </Field>

              <Field label={t('apparence.langue')}>
                <Select
                  value={edite.valeurs.locale ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, locale: event.target.value },
                    });
                  }}
                >
                  <option value="">—</option>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
              </Field>

              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Checkbox
                  checked={edite.valeurs.isActive}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isActive: event.target.checked },
                    });
                  }}
                  label={t('administration.utilisateurs.actif')}
                />

                <div className="ml-auto flex gap-2">
                  <Button
                    onClick={() => {
                      setEdite(null);
                    }}
                  >
                    {t('entites.annuler')}
                  </Button>
                  <Button type="submit" variante="primaire" disabled={enregistrer.isPending}>
                    {t('entites.enregistrer')}
                  </Button>
                </div>
              </div>

              <div className="sm:col-span-2">
                <FieldError>{enregistrer.error?.message}</FieldError>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <IconRecherche className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={recherche}
            onChange={(event) => {
              setRecherche(event.target.value);
            }}
            placeholder={t('administration.utilisateurs.titre')}
            className="pl-8"
          />
        </div>

        <Checkbox
          checked={inactifs}
          onChange={(event) => {
            setInactifs(event.target.checked);
          }}
          label={
            <span className="text-xs text-muted">{t('administration.utilisateurs.inactifs')}</span>
          }
        />
      </div>

      {liste.data && liste.data.length === 0 && (
        <EmptyState title={t('administration.utilisateurs.aucun')} />
      )}

      {liste.data && liste.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('administration.utilisateurs.identifiant')}</Th>
              <Th>{t('administration.utilisateurs.courriel')}</Th>
              <Th>{t('administration.utilisateurs.source')}</Th>
              <Th>{t('administration.utilisateurs.groupes')}</Th>
              <Th>{t('administration.utilisateurs.habilitations')}</Th>
              <Th>{t('administration.utilisateurs.derniereConnexion')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {liste.data.map((utilisateur) => (
              <Tr key={utilisateur.id}>
                <Td>
                  <button
                    type="button"
                    onClick={() => {
                      setOuvert(utilisateur.id === ouvert ? null : utilisateur.id);
                    }}
                    className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
                  >
                    {utilisateur.displayName}
                  </button>
                  <div className="text-xs text-faint">{utilisateur.username}</div>
                </Td>
                <Td className="text-muted">{utilisateur.email ?? '—'}</Td>
                <Td>
                  <Badge ton={utilisateur.authSource === 'ldap' ? 'info' : 'neutre'}>
                    {t(`administration.utilisateurs.sources.${utilisateur.authSource}`)}
                  </Badge>
                </Td>
                <Td className="text-muted">{utilisateur.groups.join(', ') || '—'}</Td>
                <Td>
                  {utilisateur.authorizationCount === 0 ? (
                    <Badge ton="attention">0</Badge>
                  ) : (
                    <span className="tabular-nums text-muted">
                      {utilisateur.authorizationCount}
                    </span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {utilisateur.lastLoginAt ? dates.format(new Date(utilisateur.lastLoginAt)) : '—'}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {!utilisateur.isActive && (
                      <Badge ton="neutre">{t('administration.utilisateurs.actif')} ✕</Badge>
                    )}
                    {peutModifier && (
                      <Button
                        taille="sm"
                        onClick={() => {
                          setEdite({
                            id: utilisateur.id,
                            valeurs: {
                              username: utilisateur.username,
                              email: utilisateur.email ?? '',
                              firstName: '',
                              lastName: '',
                              locale: utilisateur.locale ?? '',
                              isActive: utilisateur.isActive,
                            },
                          });
                        }}
                      >
                        {t('entites.modifier')}
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {ouvert !== null && detail.data && (
        <Habilitations
          utilisateur={detail.data}
          profils={(profils.data ?? []).map((profil) => ({ id: profil.id, name: profil.name }))}
          entites={(entites.data ?? []).map((entite) => ({
            id: entite.id,
            name: entite.completeName,
          }))}
          onAccorder={(choix) => {
            accorder.mutate(choix);
          }}
          onRetirer={(cible) => {
            retirer.mutate(cible);
          }}
          erreur={accorder.error?.message ?? retirer.error?.message ?? null}
        />
      )}
    </section>
  );
}

/** Panneau des habilitations d'un compte : entité × profil, avec récursivité. */
function Habilitations({
  utilisateur,
  profils,
  entites,
  onAccorder,
  onRetirer,
  erreur,
}: {
  utilisateur: UserDetail;
  profils: readonly { id: number; name: string }[];
  entites: readonly { id: number; name: string }[];
  onAccorder: (choix: { entityId: number; profileId: number; isRecursive: boolean }) => void;
  onRetirer: (cible: { entityId: number; profileId: number }) => void;
  erreur: string | null;
}) {
  const { t } = useTranslation();
  const [entite, setEntite] = useState('');
  const [profil, setProfil] = useState('');
  const [recursive, setRecursive] = useState(true);

  return (
    <Card>
      <CardHeader
        title={`${t('administration.utilisateurs.habilitations')} — ${utilisateur.displayName}`}
      />
      <CardBody className="space-y-4">
        {utilisateur.authorizations.length === 0 ? (
          <Notice ton="attention">{t('administration.utilisateurs.aucuneHabilitation')}</Notice>
        ) : (
          <ul className="space-y-1.5">
            {utilisateur.authorizations.map((habilitation) => (
              <li
                key={`${String(habilitation.entityId)}-${String(habilitation.profileId)}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <span className="font-medium">{habilitation.entityName}</span>
                <Badge ton="marque">{habilitation.profileName}</Badge>
                {habilitation.isRecursive && (
                  <span className="text-xs text-faint">
                    {t('administration.utilisateurs.recursive')}
                  </span>
                )}
                {habilitation.isDynamic && (
                  <Badge ton="info">{t('administration.utilisateurs.dynamique')}</Badge>
                )}
                <Button
                  taille="sm"
                  variante="discret"
                  className="ml-auto"
                  onClick={() => {
                    onRetirer({
                      entityId: habilitation.entityId,
                      profileId: habilitation.profileId,
                    });
                  }}
                >
                  {t('administration.utilisateurs.retirer')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (entite && profil) {
              onAccorder({
                entityId: Number(entite),
                profileId: Number(profil),
                isRecursive: recursive,
              });
            }
          }}
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
        >
          <Field label={t('entites.titre')} className="w-56">
            <Select
              value={entite}
              onChange={(event) => {
                setEntite(event.target.value);
              }}
            >
              <option value="">—</option>
              {entites.map((valeur) => (
                <option key={valeur.id} value={valeur.id}>
                  {valeur.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('administration.profils.titre')} className="w-48">
            <Select
              value={profil}
              onChange={(event) => {
                setProfil(event.target.value);
              }}
            >
              <option value="">—</option>
              {profils.map((valeur) => (
                <option key={valeur.id} value={valeur.id}>
                  {valeur.name}
                </option>
              ))}
            </Select>
          </Field>

          <Checkbox
            checked={recursive}
            onChange={(event) => {
              setRecursive(event.target.checked);
            }}
            label={
              <span className="text-xs text-muted">
                {t('administration.utilisateurs.recursive')}
              </span>
            }
            className="pb-2"
          />

          <Button type="submit" variante="primaire" disabled={!entite || !profil}>
            {t('administration.utilisateurs.accorder')}
          </Button>
        </form>

        <FieldError>{erreur}</FieldError>
      </CardBody>
    </Card>
  );
}
