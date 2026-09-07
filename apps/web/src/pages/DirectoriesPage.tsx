import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ldapGroupSearchModeSchema, type UpsertLdapDirectory } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus } from '@/components/ui/icons';
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
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';

const VIDE: UpsertLdapDirectory = {
  name: '',
  host: '',
  port: 389,
  useTls: false,
  bindDn: '',
  baseDn: '',
  userFilter: '(objectClass=person)',
  loginAttribute: 'uid',
  emailAttribute: 'mail',
  firstNameAttribute: 'givenName',
  lastNameAttribute: 'sn',
  groupSearchMode: 'attribute',
  memberOfAttribute: 'memberOf',
  groupMemberAttribute: 'member',
  groupBaseDn: '',
  groupFilter: '(objectClass=groupOfNames)',
  isActive: true,
  isDefault: false,
  timeoutMs: 5000,
};

/**
 * Annuaires LDAP.
 *
 * Le formulaire est long parce que la configuration l'est : deux annuaires du
 * marché ne se décrivent pas avec les mêmes attributs, et masquer la moitié des
 * champs derrière un mode « avancé » enverrait chercher dans la documentation ce
 * que l'écran peut dire lui-même.
 *
 * L'essai de connexion est là pour cette raison : une configuration d'annuaire
 * se vérifie en la testant, pas en la relisant.
 */
export function DirectoriesPage() {
  const { t, i18n } = useTranslation();
  const peutEcrire = usePeut('ldap', 'update');
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertLdapDirectory } | null>(null);

  const liste = useQuery({
    queryKey: ['admin-directories'],
    queryFn: api.directories,
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['admin-directories'] });
  };

  const enregistrer = useMutation({
    mutationFn: () => api.saveDirectory(edite?.valeurs as UpsertLdapDirectory, edite?.id),
    onSuccess: async () => {
      setEdite(null);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteDirectory(id),
    onSuccess: rafraichir,
  });

  const tester = useMutation({ mutationFn: (id: number) => api.testDirectory(id) });

  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  const interdit = liste.error instanceof ApiError && liste.error.status === 403;

  const modifier = (patch: Partial<UpsertLdapDirectory>): void => {
    if (edite) setEdite({ ...edite, valeurs: { ...edite.valeurs, ...patch } });
  };

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.valeurs.name.trim() && edite.valeurs.host.trim() && edite.valeurs.baseDn.trim()) {
      enregistrer.mutate();
    }
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.annuaires.titre')}
        description={t('administration.annuaires.description')}
        action={
          peutEcrire ? (
            <Button
              variante="primaire"
              onClick={() => {
                setEdite({ valeurs: { ...VIDE } });
              }}
            >
              <IconPlus className="size-4" />
              {t('administration.annuaires.nouveau')}
            </Button>
          ) : undefined
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={
              edite.id === undefined ? t('administration.annuaires.nouveau') : edite.valeurs.name
            }
          />
          <CardBody>
            <form onSubmit={soumettre} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={t('administration.annuaires.nom')} className="lg:col-span-2">
                  <Input
                    value={edite.valeurs.name}
                    onChange={(event) => {
                      modifier({ name: event.target.value });
                    }}
                    autoFocus
                  />
                </Field>

                <Field label={t('administration.annuaires.hote')}>
                  <Input
                    value={edite.valeurs.host}
                    onChange={(event) => {
                      modifier({ host: event.target.value });
                    }}
                  />
                </Field>

                <Field label={t('administration.annuaires.port')}>
                  <Input
                    type="number"
                    value={edite.valeurs.port}
                    onChange={(event) => {
                      modifier({ port: Number(event.target.value) });
                    }}
                  />
                </Field>

                <Field
                  label={t('administration.annuaires.compteService')}
                  className="lg:col-span-2"
                >
                  <Input
                    value={edite.valeurs.bindDn ?? ''}
                    onChange={(event) => {
                      modifier({ bindDn: event.target.value });
                    }}
                    placeholder="cn=service,dc=exemple,dc=fr"
                  />
                </Field>

                <Field
                  label={t('administration.annuaires.motDePasse')}
                  hint={
                    edite.id === undefined
                      ? undefined
                      : t('administration.annuaires.motDePasseAide')
                  }
                  className="lg:col-span-2"
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={edite.valeurs.bindPassword ?? ''}
                    onChange={(event) => {
                      modifier(
                        event.target.value
                          ? { bindPassword: event.target.value }
                          : { bindPassword: undefined },
                      );
                    }}
                  />
                </Field>

                <Field label={t('administration.annuaires.baseDn')} className="lg:col-span-2">
                  <Input
                    value={edite.valeurs.baseDn}
                    onChange={(event) => {
                      modifier({ baseDn: event.target.value });
                    }}
                    placeholder="ou=people,dc=exemple,dc=fr"
                  />
                </Field>

                <Field
                  label={t('administration.annuaires.filtreUtilisateur')}
                  className="lg:col-span-2"
                >
                  <Input
                    value={edite.valeurs.userFilter}
                    onChange={(event) => {
                      modifier({ userFilter: event.target.value });
                    }}
                  />
                </Field>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-faint uppercase">
                  {t('administration.annuaires.attributs')}
                </h4>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={t('administration.annuaires.identifiant')}>
                    <Input
                      value={edite.valeurs.loginAttribute}
                      onChange={(event) => {
                        modifier({ loginAttribute: event.target.value });
                      }}
                    />
                  </Field>
                  <Field label={t('administration.annuaires.courriel')}>
                    <Input
                      value={edite.valeurs.emailAttribute}
                      onChange={(event) => {
                        modifier({ emailAttribute: event.target.value });
                      }}
                    />
                  </Field>
                  <Field label={t('administration.annuaires.prenom')}>
                    <Input
                      value={edite.valeurs.firstNameAttribute}
                      onChange={(event) => {
                        modifier({ firstNameAttribute: event.target.value });
                      }}
                    />
                  </Field>
                  <Field label={t('administration.annuaires.nomFamille')}>
                    <Input
                      value={edite.valeurs.lastNameAttribute}
                      onChange={(event) => {
                        modifier({ lastNameAttribute: event.target.value });
                      }}
                    />
                  </Field>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold tracking-wider text-faint uppercase">
                  {t('administration.annuaires.groupes')}
                </h4>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={t('administration.annuaires.mode')} className="lg:col-span-2">
                    <Select
                      value={edite.valeurs.groupSearchMode}
                      onChange={(event) => {
                        modifier({
                          groupSearchMode: ldapGroupSearchModeSchema.parse(event.target.value),
                        });
                      }}
                    >
                      {ldapGroupSearchModeSchema.options.map((valeur) => (
                        <option key={valeur} value={valeur}>
                          {t(`administration.annuaires.modes.${valeur}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {/* Chaque mode n'utilise qu'un des deux attributs : montrer
                      l'autre inviterait a le renseigner pour rien. */}
                  {edite.valeurs.groupSearchMode === 'attribute' ? (
                    <Field label={t('administration.annuaires.memberOf')}>
                      <Input
                        value={edite.valeurs.memberOfAttribute}
                        onChange={(event) => {
                          modifier({ memberOfAttribute: event.target.value });
                        }}
                      />
                    </Field>
                  ) : (
                    <Field label={t('administration.annuaires.groupMember')}>
                      <Input
                        value={edite.valeurs.groupMemberAttribute}
                        onChange={(event) => {
                          modifier({ groupMemberAttribute: event.target.value });
                        }}
                      />
                    </Field>
                  )}

                  <Field label={t('administration.annuaires.groupBaseDn')}>
                    <Input
                      value={edite.valeurs.groupBaseDn ?? ''}
                      onChange={(event) => {
                        modifier({ groupBaseDn: event.target.value });
                      }}
                    />
                  </Field>

                  <Field
                    label={t('administration.annuaires.filtreGroupe')}
                    className="lg:col-span-2"
                  >
                    <Input
                      value={edite.valeurs.groupFilter}
                      onChange={(event) => {
                        modifier({ groupFilter: event.target.value });
                      }}
                    />
                  </Field>

                  <Field label={t('administration.annuaires.delai')}>
                    <Input
                      type="number"
                      value={edite.valeurs.timeoutMs}
                      onChange={(event) => {
                        modifier({ timeoutMs: Number(event.target.value) });
                      }}
                    />
                  </Field>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
                <Checkbox
                  checked={edite.valeurs.useTls}
                  onChange={(event) => {
                    modifier({
                      useTls: event.target.checked,
                      port: event.target.checked ? 636 : 389,
                    });
                  }}
                  label={<span className="text-sm">{t('administration.annuaires.tls')}</span>}
                />
                <Checkbox
                  checked={edite.valeurs.isActive}
                  onChange={(event) => {
                    modifier({ isActive: event.target.checked });
                  }}
                  label={<span className="text-sm">{t('administration.annuaires.actif')}</span>}
                />
                <Checkbox
                  checked={edite.valeurs.isDefault}
                  onChange={(event) => {
                    modifier({ isDefault: event.target.checked });
                  }}
                  label={<span className="text-sm">{t('administration.annuaires.parDefaut')}</span>}
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

              <FieldError>{enregistrer.error?.message}</FieldError>
            </form>
          </CardBody>
        </Card>
      )}

      {liste.data && liste.data.length === 0 && (
        <EmptyState title={t('administration.annuaires.aucun')} />
      )}

      <div className="space-y-3">
        {(liste.data ?? []).map((annuaire) => {
          const essai = tester.variables === annuaire.id ? tester.data : undefined;

          return (
            <Card key={annuaire.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{annuaire.name}</h3>
                  {annuaire.isDefault && (
                    <Badge ton="marque">{t('administration.annuaires.parDefaut')}</Badge>
                  )}
                  <Badge ton={annuaire.isActive ? 'positif' : 'neutre'}>
                    {t('administration.annuaires.actif')}
                  </Badge>
                  {annuaire.useTls && <Badge ton="info">LDAPS</Badge>}
                  <span className="ml-auto text-xs text-faint">
                    {annuaire.lastSyncAt
                      ? `${t('administration.annuaires.derniereSync')} ${dates.format(new Date(annuaire.lastSyncAt))}`
                      : '—'}
                  </span>
                </div>

                <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt className="text-faint">{t('administration.annuaires.hote')}</dt>
                    <dd className="font-mono">
                      {annuaire.host}:{annuaire.port}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">{t('administration.annuaires.baseDn')}</dt>
                    <dd className="font-mono break-all">{annuaire.baseDn}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">{t('administration.annuaires.compteService')}</dt>
                    <dd className="font-mono break-all">
                      {annuaire.bindDn ?? '—'}
                      {annuaire.hasBindPassword && (
                        <span className="ml-1 text-faint">
                          · {t('administration.annuaires.motDePasseEnregistre')}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                {essai && (
                  <Notice ton={essai.ok ? 'positif' : 'critique'}>
                    {essai.ok
                      ? `${t('administration.annuaires.testReussi')} · ${String(essai.found ?? 0)} ${t('administration.annuaires.comptesTrouves')}`
                      : `${t('administration.annuaires.testEchoue')} : ${essai.message}`}
                  </Notice>
                )}

                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  <Button
                    taille="sm"
                    disabled={tester.isPending}
                    onClick={() => {
                      tester.mutate(annuaire.id);
                    }}
                  >
                    {t('administration.annuaires.tester')}
                  </Button>
                  {peutEcrire && (
                    <Button
                      taille="sm"
                      onClick={() => {
                        setEdite({
                          id: annuaire.id,
                          valeurs: {
                            name: annuaire.name,
                            host: annuaire.host,
                            port: annuaire.port,
                            useTls: annuaire.useTls,
                            bindDn: annuaire.bindDn ?? '',
                            baseDn: annuaire.baseDn,
                            userFilter: annuaire.userFilter,
                            loginAttribute: annuaire.loginAttribute,
                            emailAttribute: annuaire.emailAttribute,
                            firstNameAttribute: annuaire.firstNameAttribute,
                            lastNameAttribute: annuaire.lastNameAttribute,
                            groupSearchMode: annuaire.groupSearchMode,
                            memberOfAttribute: annuaire.memberOfAttribute,
                            groupMemberAttribute: annuaire.groupMemberAttribute,
                            groupBaseDn: annuaire.groupBaseDn ?? '',
                            groupFilter: annuaire.groupFilter,
                            isActive: annuaire.isActive,
                            isDefault: annuaire.isDefault,
                            timeoutMs: annuaire.timeoutMs,
                          },
                        });
                      }}
                    >
                      {t('entites.modifier')}
                    </Button>
                  )}
                  {peutEcrire && (
                    <Button
                      taille="sm"
                      variante="danger"
                      className="ml-auto"
                      onClick={() => {
                        supprimer.mutate(annuaire.id);
                      }}
                    >
                      {t('entites.supprimer')}
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <FieldError>{supprimer.error?.message ?? tester.error?.message}</FieldError>
    </section>
  );
}
