import type { FormQuestion, UpsertForm } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { CONTROLE, SectionTitle } from '@/components/ui/primitives';

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

function Champ({ question }: { question: FormQuestion }) {
  const { t } = useTranslation();

  const commun = {
    className: CONTROLE,
    disabled: true,
    value: '',
    readOnly: true,
  } as const;

  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
        {question.label || t('formulaires.libelle')}
        {question.isRequired && <span className="text-brand"> *</span>}
      </span>

      {question.description && (
        <span className="block text-xs text-muted">{question.description}</span>
      )}

      {question.kind === 'textarea' && <textarea {...commun} className={`${CONTROLE} h-20`} />}

      {(question.kind === 'select' || question.kind === 'urgency') && (
        <select className={CONTROLE} disabled value="">
          <option value="">—</option>
          {(question.kind === 'urgency' ? ['1', '2', '3', '4', '5'] : question.options).map(
            (option) => (
              <option key={option} value={option}>
                {question.kind === 'urgency'
                  ? t(`tickets.priorites.p${option}` as 'tickets.priorites.p1')
                  : option}
              </option>
            ),
          )}
        </select>
      )}

      {question.kind === 'checkbox' && (
        <input type="checkbox" disabled className="size-4 rounded-[2px] border-line-strong" />
      )}

      {!['textarea', 'select', 'urgency', 'checkbox'].includes(question.kind) && (
        <input
          {...commun}
          type={question.kind === 'number' ? 'number' : question.kind === 'date' ? 'date' : 'text'}
        />
      )}
    </label>
  );
}

export function FormPreview({ valeurs }: { valeurs: UpsertForm }) {
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
                <Champ key={rang} question={question} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
