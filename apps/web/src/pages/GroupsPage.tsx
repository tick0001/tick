import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpsertGroup } from '@tick/contracts';
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

const VIDE: UpsertGroup = {
  name: '',
  comment: '',
  isRecursive: false,
  isRequester: true,
  isAssignable: true,
};

/**
 * Groupes et appartenances.
 *
 * Le groupe est créé dans l'entité active : c'est ce que la barre supérieure
 * affiche, et le rappeler ici n'apporterait rien de plus qu'une occasion de
 * diverger. Le drapeau « récursif » décide seul de sa portée.
 */
export function GroupsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertGroup } | null>(null);
  const [membre, setMembre] = useState<Record<number, string>>({});

  const liste = useQuery({ queryKey: ['admin-groups'], queryFn: api.groups, retry: false });
  const utilisateurs = useQuery({
    queryKey: ['admin-users', '', false],
    queryFn: () => api.users({ inactive: false }),
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['admin-groups'] });
  };

  const enregistrer = useMutation({
    mutationFn: () => api.saveGroup(edite?.valeurs as UpsertGroup, edite?.id),
    onSuccess: async () => {
      setEdite(null);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteGroup(id),
    onSuccess: rafraichir,
  });

  const ajouter = useMutation({
    mutationFn: (cible: { groupId: number; userId: number }) =>
      api.addMember(cible.groupId, { userId: cible.userId, isManager: false }),
    onSuccess: rafraichir,
  });

  const retirer = useMutation({
    mutationFn: (cible: { groupId: number; userId: number }) =>
      api.removeMember(cible.groupId, cible.userId),
    onSuccess: rafraichir,
  });

  const interdit = liste.error instanceof ApiError && liste.error.status === 403;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.valeurs.name.trim()) enregistrer.mutate();
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('administration.groupes.titre')}
        description={t('administration.groupes.description')}
        action={
          <Button
            variante="primaire"
            onClick={() => {
              setEdite({ valeurs: { ...VIDE } });
            }}
          >
            <IconPlus className="size-4" />
            {t('administration.groupes.nouveau')}
          </Button>
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={edite.id === undefined ? t('administration.groupes.nouveau') : edite.valeurs.name}
          />
          <CardBody>
            <form onSubmit={soumettre} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('administration.groupes.nom')}>
                  <Input
                    value={edite.valeurs.name}
                    onChange={(event) => {
                      setEdite({ ...edite, valeurs: { ...edite.valeurs, name: event.target.value } });
                    }}
                    autoFocus
                  />
                </Field>

                <Field label={t('administration.groupes.commentaire')}>
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

              <div className="flex flex-wrap gap-4">
                <Checkbox
                  checked={edite.valeurs.isRecursive}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isRecursive: event.target.checked },
                    });
                  }}
                  label={<span className="text-sm">{t('administration.groupes.recursif')}</span>}
                />
                <Checkbox
                  checked={edite.valeurs.isRequester}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isRequester: event.target.checked },
                    });
                  }}
                  label={<span className="text-sm">{t('administration.groupes.demandeur')}</span>}
                />
                <Checkbox
                  checked={edite.valeurs.isAssignable}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isAssignable: event.target.checked },
                    });
                  }}
                  label={<span className="text-sm">{t('administration.groupes.attribuable')}</span>}
                />
              </div>

              <div className="flex items-center gap-2">
                <FieldError>{enregistrer.error?.message}</FieldError>
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
            </form>
          </CardBody>
        </Card>
      )}

      {liste.data && liste.data.length === 0 && (
        <EmptyState title={t('administration.groupes.aucun')} />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {(liste.data ?? []).map((groupe) => (
          <Card key={groupe.id}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{groupe.name}</h3>
                <Badge ton="neutre">{groupe.entityName}</Badge>
                {groupe.isRecursive && (
                  <Badge ton="marque">{t('administration.groupes.recursif')}</Badge>
                )}
              </div>

              {groupe.comment && <p className="text-sm text-muted">{groupe.comment}</p>}

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-faint">
                  {t('administration.groupes.membres')}
                </p>

                {groupe.members.length === 0 ? (
                  <p className="text-sm text-muted">{t('administration.groupes.aucunMembre')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {groupe.members.map((membreGroupe) => (
                      <li
                        key={membreGroupe.userId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs"
                      >
                        {membreGroupe.displayName}
                        {membreGroupe.isManager && (
                          <span className="text-brand">
                            · {t('administration.groupes.responsable')}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={t('administration.utilisateurs.retirer')}
                          onClick={() => {
                            retirer.mutate({ groupId: groupe.id, userId: membreGroupe.userId });
                          }}
                          className="text-faint transition-colors hover:text-critical"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Select
                  value={membre[groupe.id] ?? ''}
                  onChange={(event) => {
                    setMembre((precedent) => ({ ...precedent, [groupe.id]: event.target.value }));
                  }}
                  className="w-48"
                >
                  <option value="">—</option>
                  {(utilisateurs.data ?? [])
                    .filter(
                      (utilisateur) =>
                        !groupe.members.some((existant) => existant.userId === utilisateur.id),
                    )
                    .map((utilisateur) => (
                      <option key={utilisateur.id} value={utilisateur.id}>
                        {utilisateur.displayName}
                      </option>
                    ))}
                </Select>

                <Button
                  taille="sm"
                  disabled={!membre[groupe.id]}
                  onClick={() => {
                    ajouter.mutate({
                      groupId: groupe.id,
                      userId: Number(membre[groupe.id]),
                    });
                    setMembre((precedent) => ({ ...precedent, [groupe.id]: '' }));
                  }}
                >
                  {t('administration.groupes.ajouterMembre')}
                </Button>

                <Button
                  taille="sm"
                  variante="danger"
                  className="ml-auto"
                  onClick={() => {
                    supprimer.mutate(groupe.id);
                  }}
                >
                  {t('entites.supprimer')}
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <FieldError>{supprimer.error?.message ?? ajouter.error?.message}</FieldError>
    </section>
  );
}
