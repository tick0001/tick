import { useTranslation } from 'react-i18next';
import { Button, FieldError } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Le pied d'un formulaire d'édition : ce qui s'est mal passé, et quoi faire.
 *
 * Le même bloc — message d'erreur à gauche, « Annuler » et « Enregistrer »
 * poussés à droite — était recopié dans six écrans de configuration. Une
 * retouche s'y appliquait à cinq exemplaires sur six, et le sixième restait
 * en arrière sans que rien ne le signale.
 *
 * Il vit ici et non dans `primitives.tsx`, qui ne connaît volontairement pas
 * les traductions : ses briques sont de pure présentation, et y faire entrer
 * i18next les rendrait indissociables de la langue.
 */

interface ActionsProps {
  onAnnuler: () => void;
  /** Enregistrement en cours : le bouton se ferme le temps de l'aller-retour. */
  enCours?: boolean | undefined;
  /** Saisie invalide, connue du formulaire avant même de partir. */
  bloque?: boolean | undefined;
}

/** La paire de boutons seule, pour les formulaires qui la logent ailleurs. */
export function ActionsFormulaire({ onAnnuler, enCours = false, bloque = false }: ActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="ml-auto flex gap-2">
      <Button onClick={onAnnuler}>{t('entites.annuler')}</Button>
      <Button type="submit" variante="primaire" disabled={enCours || bloque}>
        {t('entites.enregistrer')}
      </Button>
    </div>
  );
}

export function PiedFormulaire({
  erreur,
  className,
  ...actions
}: ActionsProps & { erreur?: string | undefined; className?: string | undefined }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/*
        L'erreur reste sur la meme ligne que les boutons : au-dessus, elle
        s'eloignerait du geste qui l'a provoquee ; en dessous, elle passerait
        sous le pli sur un formulaire long.
      */}
      <FieldError>{erreur}</FieldError>
      <ActionsFormulaire {...actions} />
    </div>
  );
}
