import type { FormQuestion, Group, UserSummary } from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { CONTROLE } from '@/components/ui/primitives';

/**
 * Le rendu d'une question, partagé par le catalogue et l'aperçu.
 *
 * Deux rendus séparés finiraient par diverger : on ajoute une nature dans le
 * formulaire réel, l'aperçu continue de la montrer en champ texte, et l'auteur
 * compose sur une image fausse. C'est précisément ce que l'aperçu doit éviter.
 *
 * Le composant est **piloté** : il ne connaît ni la source des valeurs ni ce
 * qu'on en fait. L'aperçu le monte inerte, le catalogue le monte vivant, et le
 * dessin est le même.
 */

export interface Referentiels {
  utilisateurs: readonly UserSummary[];
  groupes: readonly Group[];
}

interface Props {
  question: FormQuestion;
  valeur: string | string[] | null | undefined;
  onChange: (valeur: string | string[] | null) => void;
  /** Aperçu : les contrôles se voient mais ne se remplissent pas. */
  inerte?: boolean;
  referentiels?: Referentiels;
}

/** Options d'une nature qui puise dans un référentiel plutôt que dans l'auteur. */
function optionsDe(
  question: FormQuestion,
  referentiels?: Referentiels,
): { valeur: string; label: string }[] | null {
  if (question.kind === 'urgency') {
    return ['1', '2', '3', '4', '5'].map((niveau) => ({ valeur: niveau, label: niveau }));
  }

  if (question.kind === 'user') {
    return (referentiels?.utilisateurs ?? []).map((compte) => ({
      valeur: String(compte.id),
      label: compte.displayName,
    }));
  }

  if (question.kind === 'group') {
    return (referentiels?.groupes ?? []).map((groupe) => ({
      valeur: String(groupe.id),
      label: groupe.completeName,
    }));
  }

  return null;
}

export function FormField({ question, valeur, onChange, inerte = false, referentiels }: Props) {
  const { t } = useTranslation();

  /**
   * Un bloc d'explication n'est pas une question.
   *
   * Il ne porte ni étiquette, ni astérisque, ni contrôle : le rendre comme les
   * autres produirait un champ vide que le demandeur chercherait à remplir.
   */
  if (question.kind === 'description') {
    return (
      <p className="border-l-2 border-line-strong py-1 pl-3 text-sm leading-relaxed text-muted">
        {question.description || question.label}
      </p>
    );
  }

  const texte = typeof valeur === 'string' ? valeur : '';
  const liste = Array.isArray(valeur) ? valeur : [];
  const commun = { className: CONTROLE, disabled: inerte } as const;

  const choix =
    optionsDe(question, referentiels) ??
    question.options.map((option) => ({ valeur: option, label: option }));

  const contenu = (): React.ReactNode => {
    if (question.kind === 'textarea') {
      return (
        <textarea
          {...commun}
          className={`${CONTROLE} h-24`}
          value={texte}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      );
    }

    if (question.kind === 'checkbox') {
      return (
        <input
          type="checkbox"
          disabled={inerte}
          className="size-4 rounded-[2px] border-line-strong accent-brand"
          checked={texte === 'true'}
          onChange={(event) => {
            onChange(event.target.checked ? 'true' : 'false');
          }}
        />
      );
    }

    if (question.kind === 'requesttype') {
      return (
        <select
          {...commun}
          value={texte}
          onChange={(event) => {
            onChange(event.target.value || null);
          }}
        >
          <option value="">—</option>
          <option value="incident">{t('tickets.types.incident')}</option>
          <option value="request">{t('tickets.types.request')}</option>
        </select>
      );
    }

    /**
     * Choix unique déployé.
     *
     * En deçà de six options, montrer les possibilités vaut mieux que les
     * cacher derrière une liste repliée : le demandeur voit d'un coup ce qu'on
     * lui propose, et n'ouvre rien pour le découvrir.
     */
    if (question.kind === 'radio') {
      return (
        <div className="space-y-1 pt-0.5">
          {choix.map((option) => (
            <label key={option.valeur} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                disabled={inerte}
                name={`q-${question.label}`}
                className="size-4 border-line-strong accent-brand"
                checked={texte === option.valeur}
                onChange={() => {
                  onChange(option.valeur);
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }

    if (question.kind === 'multiselect') {
      return (
        <div className="space-y-1 pt-0.5">
          {choix.map((option) => (
            <label key={option.valeur} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={inerte}
                className="size-4 rounded-[2px] border-line-strong accent-brand"
                checked={liste.includes(option.valeur)}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...liste, option.valeur]
                      : liste.filter((autre) => autre !== option.valeur),
                  );
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    }

    if (['select', 'urgency', 'user', 'group'].includes(question.kind)) {
      return (
        <select
          {...commun}
          value={texte}
          onChange={(event) => {
            onChange(event.target.value || null);
          }}
        >
          <option value="">—</option>
          {choix.map((option) => (
            <option key={option.valeur} value={option.valeur}>
              {question.kind === 'urgency'
                ? t(`tickets.priorites.p${option.valeur}` as 'tickets.priorites.p1')
                : option.label}
            </option>
          ))}
        </select>
      );
    }

    // Saisie libre. Le type dit au navigateur quel clavier ouvrir sur
    // telephone, et quelle verification faire avant l'envoi.
    const TYPES: Record<string, string> = {
      number: 'number',
      date: 'date',
      time: 'time',
      datetime: 'datetime-local',
      email: 'email',
      url: 'url',
    };

    return (
      <input
        {...commun}
        type={TYPES[question.kind] ?? 'text'}
        value={texte}
        onChange={(event) => {
          onChange(event.target.value || null);
        }}
      />
    );
  };

  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
        {question.label || t('formulaires.libelle')}
        {question.isRequired && <span className="text-brand"> *</span>}
      </span>

      {question.description && (
        <span className="block text-xs text-muted">{question.description}</span>
      )}

      {contenu()}
    </label>
  );
}
