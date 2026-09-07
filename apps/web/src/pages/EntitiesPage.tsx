import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionContext } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PluginSlot } from '@/components/PluginSlot';
import { IconPlus } from '@/components/ui/icons';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
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

interface Saisie {
  id?: number;
  name: string;
  /**
   * Entité parente, obligatoire à la création.
   *
   * La racine n'est pas créable depuis l'interface : elle est posée à
   * l'amorçage, et une seconde racine casserait l'hypothèse d'arbre unique sur
   * laquelle repose tout le périmètre de sécurité.
   */
  parentId: number;
  comment: string;
}

/**
 * Arborescence des entités.
 *
 * L'entité est la brique du multi-organisation : tout objet lui est rattaché, et
 * la sécurité au niveau des lignes s'appuie sur son chemin matérialisé. La
 * déplacer ou la supprimer emporte donc bien plus que son nom — d'où la
 * confirmation explicite avant suppression.
 */
export function EntitiesPage({ session }: { session: SessionContext }) {
  const { t, i18n } = useTranslation();
  const peutModifier = usePeut('entity', 'update');
  const peutSupprimer = usePeut('entity', 'delete');
  const peutEcrire = usePeut('entity', 'create');
  const queryClient = useQueryClient();
  const [edite, setEdite] = useState<Saisie | null>(null);

  const entites = useQuery({ queryKey: ['entities'], queryFn: api.entities, retry: false });

  const rafraichir = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['entities'] });
    // Le sélecteur de contexte liste les entités habilitées : une création ou un
    // renommage doit s'y voir sans recharger la page.
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  };

  const enregistrer = useMutation({
    mutationFn: () => {
      const saisie = edite as Saisie;

      if (saisie.id === undefined) {
        return api.createEntity({
          name: saisie.name,
          parentId: saisie.parentId,
          comment: saisie.comment || null,
        });
      }

      return api.updateEntity(saisie.id, {
        name: saisie.name,
        comment: saisie.comment || null,
      });
    },
    onSuccess: async () => {
      setEdite(null);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteEntity(id),
    onSuccess: rafraichir,
  });

  const interdit = entites.error instanceof ApiError && entites.error.status === 403;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.name.trim()) enregistrer.mutate();
  };

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('entites.titre')}
        description={t('entites.description')}
        action={
          peutEcrire ? (
            <>
              <PluginSlot
                name="entity.list.actions"
                className="flex items-center gap-2"
                context={{
                  locale: i18n.language,
                  entity: session.entity,
                  profile: session.profile,
                }}
              />
              <Button
                variante="primaire"
                onClick={() => {
                  setEdite({ name: '', parentId: session.entity.id, comment: '' });
                }}
              >
                <IconPlus className="size-4" />
                {t('entites.nouvelle')}
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Un refus de droit n'est pas une panne : le dire clairement évite de
          faire chercher une erreur là où il n'y en a pas. */}
      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}

      {entites.error && !interdit && <Notice ton="critique">{entites.error.message}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={edite.id === undefined ? t('entites.nouvelle') : t('entites.modifier')}
          />
          <CardBody>
            <form onSubmit={soumettre} className="grid gap-4 sm:grid-cols-3">
              <Field label={t('entites.nomEntite')}>
                <Input
                  value={edite.name}
                  onChange={(event) => {
                    setEdite({ ...edite, name: event.target.value });
                  }}
                  autoFocus
                />
              </Field>

              {edite.id === undefined && (
                <Field label={t('entites.parent')}>
                  <Select
                    value={String(edite.parentId)}
                    onChange={(event) => {
                      setEdite({ ...edite, parentId: Number(event.target.value) });
                    }}
                  >
                    {(entites.data ?? []).map((entite) => (
                      <option key={entite.id} value={entite.id}>
                        {entite.completeName}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field label={t('entites.commentaire')}>
                <Input
                  value={edite.comment}
                  onChange={(event) => {
                    setEdite({ ...edite, comment: event.target.value });
                  }}
                />
              </Field>

              <div className="flex items-center gap-2 sm:col-span-3">
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

      {entites.isPending && <p className="text-sm text-muted">{t('commun.chargement')}</p>}

      {entites.data && !entites.error && entites.data.length === 0 && (
        <EmptyState title={t('entites.aucune')} />
      )}

      {entites.data && !entites.error && entites.data.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <Th>{t('entites.nom')}</Th>
              <Th>{t('entites.chemin')}</Th>
              <Th className="w-20">{t('entites.niveau')}</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {entites.data.map((entite) => (
              <Tr key={entite.id}>
                <Td>
                  {/* L'indentation rend la profondeur lisible sans construire
                      un arbre : les entités arrivent déjà triées par chemin. */}
                  <span
                    className="font-medium"
                    style={{ paddingLeft: `${String(entite.level * 16)}px` }}
                  >
                    {entite.name}
                  </span>
                </Td>
                <Td className="font-mono text-xs text-faint">{entite.path}</Td>
                <Td className="tabular-nums text-muted">{entite.level}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    {peutModifier && (
                      <Button
                        taille="sm"
                        onClick={() => {
                          setEdite({
                            id: entite.id,
                            name: entite.name,
                            parentId: entite.parentId ?? entite.id,
                            comment: '',
                          });
                        }}
                      >
                        {t('entites.modifier')}
                      </Button>
                    )}
                    {peutSupprimer && (
                      <Button
                        taille="sm"
                        variante="danger"
                        disabled={entite.level === 0}
                        onClick={() => {
                          if (globalThis.confirm(t('entites.confirmerSuppression'))) {
                            supprimer.mutate(entite.id);
                          }
                        }}
                      >
                        {t('entites.supprimer')}
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <FieldError>{supprimer.error?.message}</FieldError>
    </section>
  );
}
