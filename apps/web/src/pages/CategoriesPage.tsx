import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItilCategoryDetail, UpsertItilCategory } from '@tick/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  Textarea,
} from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { usePeut } from '@/lib/session';

const VIDE: UpsertItilCategory = {
  name: '',
  parentId: null,
  comment: '',
  isHelpdeskVisible: true,
  forIncident: true,
  forRequest: true,
  forProblem: true,
  forChange: true,
  isRecursive: true,
};

/** Les quatre applicabilites, dans l'ordre ou GLPI les presente. */
const TYPES = [
  { champ: 'forIncident', cle: 'categories.types.incident' },
  { champ: 'forRequest', cle: 'categories.types.request' },
  { champ: 'forProblem', cle: 'categories.types.problem' },
  { champ: 'forChange', cle: 'categories.types.change' },
] as const;

/**
 * Le référentiel de classement.
 *
 * L'arbre est rendu à plat, indenté par la profondeur que le serveur calcule.
 * Un arbre repliable aurait paru plus riche, mais on vient ici pour retrouver
 * une catégorie parmi cent, et rien ne se retrouve dans des branches fermées.
 *
 * Le rattachement se choisit dans une liste déroulante qui exclut la catégorie
 * elle-même et sa descendance : proposer un rattachement que le serveur
 * refusera revient à tendre un piège.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  const peutCreer = usePeut('category', 'create');
  const peutSupprimer = usePeut('category', 'delete');
  const queryClient = useQueryClient();

  const [edite, setEdite] = useState<{ id?: number; valeurs: UpsertItilCategory } | null>(null);

  const liste = useQuery({
    queryKey: ['itil-categories-all'],
    queryFn: api.allItilCategories,
    retry: false,
  });

  const rafraichir = async (): Promise<void> => {
    // Les listes deroulantes de saisie lisent l'autre route : les rafraichir
    // aussi, sinon la categorie qu'on vient de creer manque a l'appel jusqu'au
    // prochain rechargement.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['itil-categories-all'] }),
      queryClient.invalidateQueries({ queryKey: ['itil-categories'] }),
    ]);
  };

  const enregistrer = useMutation({
    mutationFn: () => api.saveItilCategory(edite?.valeurs as UpsertItilCategory, edite?.id),
    onSuccess: async () => {
      setEdite(null);
      await rafraichir();
    },
  });

  const supprimer = useMutation({
    mutationFn: (id: number) => api.deleteItilCategory(id),
    onSuccess: rafraichir,
  });

  const interdit = liste.error instanceof ApiError && liste.error.status === 403;
  const categories = liste.data ?? [];

  /**
   * Parents possibles.
   *
   * Sa propre descendance est retirée : s'y rattacher fermerait l'arbre sur
   * lui-même, et le déclencheur qui recalcule les chemins tournerait sans fin.
   * Le test se fait sur le nom complet, seul marqueur de filiation dont
   * dispose le client.
   */
  const parentsPossibles = (courante?: ItilCategoryDetail): ItilCategoryDetail[] =>
    categories.filter(
      (autre) =>
        !courante ||
        (autre.id !== courante.id && !autre.completeName.startsWith(`${courante.completeName} > `)),
    );

  const aucunType = edite
    ? !edite.valeurs.forIncident &&
      !edite.valeurs.forRequest &&
      !edite.valeurs.forProblem &&
      !edite.valeurs.forChange
    : false;

  const soumettre = (event: FormEvent): void => {
    event.preventDefault();
    if (edite?.valeurs.name.trim() && !aucunType) enregistrer.mutate();
  };

  const modifier = (categorie: ItilCategoryDetail): void => {
    setEdite({
      id: categorie.id,
      valeurs: {
        name: categorie.name,
        parentId: categorie.parentId,
        comment: categorie.comment,
        isHelpdeskVisible: categorie.isHelpdeskVisible,
        forIncident: categorie.forIncident,
        forRequest: categorie.forRequest,
        forProblem: categorie.forProblem,
        forChange: categorie.forChange,
        isRecursive: categorie.isRecursive,
      },
    });
  };

  const courante =
    edite?.id === undefined ? undefined : categories.find((autre) => autre.id === edite.id);

  return (
    <section className="space-y-5">
      <PageHeader
        title={t('categories.titre')}
        description={t('categories.intro')}
        action={
          peutCreer ? (
            <Button
              variante="primaire"
              onClick={() => {
                setEdite({ valeurs: { ...VIDE } });
              }}
            >
              <IconPlus className="size-4" />
              {t('categories.nouvelle')}
            </Button>
          ) : undefined
        }
      />

      {interdit && <Notice ton="attention">{t('entites.interdit')}</Notice>}
      {supprimer.error && <Notice ton="critique">{supprimer.error.message}</Notice>}

      {edite && (
        <Card>
          <CardHeader
            title={edite.id === undefined ? t('categories.nouvelle') : edite.valeurs.name}
          />
          <CardBody>
            <form onSubmit={soumettre} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('categories.nom')}>
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

                <Field label={t('categories.parent')}>
                  <Select
                    value={
                      edite.valeurs.parentId === null || edite.valeurs.parentId === undefined
                        ? ''
                        : String(edite.valeurs.parentId)
                    }
                    onChange={(event) => {
                      setEdite({
                        ...edite,
                        valeurs: {
                          ...edite.valeurs,
                          parentId: event.target.value ? Number(event.target.value) : null,
                        },
                      });
                    }}
                  >
                    <option value="">{t('categories.aucunParent')}</option>
                    {parentsPossibles(courante).map((autre) => (
                      <option key={autre.id} value={autre.id}>
                        {autre.completeName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field label={t('categories.commentaire')}>
                <Textarea
                  rows={2}
                  value={edite.valeurs.comment ?? ''}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, comment: event.target.value },
                    });
                  }}
                />
              </Field>

              <Field label={t('categories.applicable')} groupe>
                <div className="flex flex-wrap gap-4 pt-1">
                  {TYPES.map(({ champ, cle }) => (
                    <Checkbox
                      key={champ}
                      checked={edite.valeurs[champ]}
                      onChange={(event) => {
                        setEdite({
                          ...edite,
                          valeurs: { ...edite.valeurs, [champ]: event.target.checked },
                        });
                      }}
                      label={<span className="text-sm">{t(cle)}</span>}
                    />
                  ))}
                </div>
              </Field>

              {aucunType && <FieldError>{t('categories.auMoinsUnType')}</FieldError>}

              <div className="flex flex-wrap gap-4 border-t border-line pt-3">
                <Checkbox
                  checked={edite.valeurs.isHelpdeskVisible}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isHelpdeskVisible: event.target.checked },
                    });
                  }}
                  label={
                    <span className="block space-y-0.5">
                      <span className="block text-sm">{t('categories.guichet')}</span>
                      <span className="block text-xs text-muted">
                        {t('categories.guichetAide')}
                      </span>
                    </span>
                  }
                />
                <Checkbox
                  checked={edite.valeurs.isRecursive}
                  onChange={(event) => {
                    setEdite({
                      ...edite,
                      valeurs: { ...edite.valeurs, isRecursive: event.target.checked },
                    });
                  }}
                  label={<span className="text-sm">{t('categories.recursif')}</span>}
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
                  <Button
                    type="submit"
                    variante="primaire"
                    disabled={enregistrer.isPending || aucunType}
                  >
                    {t('entites.enregistrer')}
                  </Button>
                </div>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {liste.data && categories.length === 0 && <EmptyState title={t('categories.aucune')} />}

      <div className="divide-y divide-line border-y border-line">
        {categories.map((categorie) => (
          <div
            key={categorie.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 pr-1"
            // L'indentation dit la filiation sans qu'aucune ligne ne repete le
            // chemin complet, qui deviendrait vite plus long que le nom.
            style={{ paddingLeft: `${String(categorie.level * 1.25 + 0.25)}rem` }}
          >
            {categorie.level > 0 && <span className="text-faint">└</span>}

            <span className="text-sm font-semibold text-ink">{categorie.name}</span>

            <Badge ton="neutre">{categorie.entityName}</Badge>

            {!categorie.isHelpdeskVisible && (
              <Badge ton="attention">{t('categories.interne')}</Badge>
            )}

            {categorie.childCount > 0 && (
              <span className="text-xs text-faint">
                {t('categories.sousCategories', { count: categorie.childCount })}
              </span>
            )}

            {/*
              L'applicabilite ne se montre que lorsqu'elle est restreinte.
              Repeter « Incidents · Demandes · Problemes · Changements » sur
              chaque ligne remplirait l'ecran d'une information toujours vraie,
              et la seule qui compte -- la restriction -- s'y perdrait.
            */}
            {!(
              categorie.forIncident &&
              categorie.forRequest &&
              categorie.forProblem &&
              categorie.forChange
            ) && (
              <span className="text-xs text-muted">
                {TYPES.filter(({ champ }) => categorie[champ])
                  .map(({ cle }) => t(cle))
                  .join(' · ')}
              </span>
            )}

            <div className="ml-auto flex gap-1">
              <button
                type="button"
                className={ACTION_LIGNE}
                onClick={() => {
                  modifier(categorie);
                }}
              >
                {t('categories.modifier')}
              </button>

              {peutSupprimer && (
                <button
                  type="button"
                  className={ACTION_LIGNE_DANGER}
                  onClick={() => {
                    if (globalThis.confirm(t('categories.confirmerSuppression'))) {
                      supprimer.mutate(categorie.id);
                    }
                  }}
                >
                  {t('categories.supprimer')}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
