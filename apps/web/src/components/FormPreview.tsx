import type { UpsertForm } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { FormField, type Referentiels } from '@/components/FormField';
import { SectionTitle } from '@/components/ui/primitives';

/**
 * Le formulaire tel que le demandeur le verra.
 *
 * Composer un formulaire à l'aveugle est le défaut central d'un constructeur :
 * on empile des champs sans jamais voir la page qu'ils font, et l'on découvre à
 * la première soumission qu'une question est incompréhensible ou qu'une section
 * est vide. L'aperçu supprime cet aller-retour.
 *
 * Il est **inerte** : rien ne s'y saisit. Un aperçu où l'on peut taper invite à
 * le prendre pour le formulaire réel, et l'on finit par croire avoir répondu.
 * Ce qu'il montre, c'est la forme — l'ordre, les intitulés, ce qui est
 * obligatoire — pas le remplissage.
 */

export function FormPreview({
  valeurs,
  referentiels,
}: {
  valeurs: UpsertForm;
  referentiels?: Referentiels;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h3 className="text-lg font-bold tracking-tight text-ink">
          {valeurs.name || t('formulaires.nom')}
        </h3>
        {valeurs.description && <p className="text-sm text-muted">{valeurs.description}</p>}
      </div>

      {valeurs.sections.map((section, index) => (
        <section key={index} className="space-y-3">
          <SectionTitle>{section.name || t('formulaires.section')}</SectionTitle>

          {section.description && <p className="text-xs text-muted">{section.description}</p>}

          {section.questions.length === 0 ? (
            // Une section vide se voit ici, et non a la premiere soumission.
            <p className="text-xs text-faint italic">{t('formulaires.sectionVide')}</p>
          ) : (
            <div className="space-y-3">
              {section.questions.map((question, rang) => (
                <FormField
                  key={rang}
                  question={question}
                  valeur={null}
                  onChange={() => undefined}
                  inerte
                  {...(referentiels ? { referentiels } : {})}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
