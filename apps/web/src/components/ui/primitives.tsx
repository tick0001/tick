import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import type { AnchorHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Briques d'interface communes.
 *
 * Elles existent pour une raison précise : avant elles, la même chaîne de
 * douze classes Tailwind était recopiée dans chaque page, et une retouche de
 * style se terminait toujours par deux écrans qui ne se ressemblaient plus.
 * Ici, la décision est prise une fois.
 */

// --- Boutons -----------------------------------------------------------------

type Variante = 'primaire' | 'secondaire' | 'discret' | 'danger';
type Taille = 'sm' | 'md';

const VARIANTES: Record<Variante, string> = {
  primaire: 'bg-brand text-on-brand hover:bg-brand-hover shadow-card',
  secondaire: 'border border-line bg-surface text-ink hover:bg-sunken',
  discret: 'text-muted hover:bg-sunken hover:text-ink',
  danger: 'border border-critical/30 bg-critical-soft text-critical-ink hover:border-critical/60',
};

const TAILLES: Record<Taille, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
};

const SOCLE =
  'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';

/**
 * Classes de bouton, exportees telles quelles.
 *
 * Quelques pages composent leurs boutons a la main, dans des boucles ou des
 * barres d'outils denses ; leur imposer le composant aurait ajoute une
 * enveloppe sans rien gagner. Elles partagent au moins les memes classes.
 */
export const BOUTON = cn(SOCLE, VARIANTES.secondaire, TAILLES.md);
export const BOUTON_PRIMAIRE = cn(SOCLE, VARIANTES.primaire, TAILLES.md);
export const BOUTON_DANGER = cn(SOCLE, VARIANTES.danger, TAILLES.sm);
export const BOUTON_SM = cn(SOCLE, VARIANTES.secondaire, TAILLES.sm);

/** Carte, en classes : quelques listes composent leurs cartes dans une boucle. */
export const CARTE = 'rounded-card border border-line bg-surface p-4 shadow-card';

export function Button({
  variante = 'secondaire',
  taille = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; taille?: Taille }) {
  return (
    <button
      type="button"
      className={cn(SOCLE, VARIANTES[variante], TAILLES[taille], className)}
      {...props}
    />
  );
}

/** Même apparence qu'un bouton, pour ce qui est réellement un lien. */
export function LinkButton({
  variante = 'secondaire',
  taille = 'md',
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variante?: Variante; taille?: Taille }) {
  return <a className={cn(SOCLE, VARIANTES[variante], TAILLES[taille], className)} {...props} />;
}

// --- Saisie ------------------------------------------------------------------

/**
 * Socle commun des contrôles de saisie.
 *
 * Exporté aussi comme chaîne : quelques formulaires composent leurs champs à la
 * main, et leur imposer un composant aurait ajouté une enveloppe pour rien.
 */
export const CONTROLE =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-brand disabled:opacity-60';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROLE, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROLE, 'h-auto py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROLE, 'pr-8', className)} {...props} />;
}

/** Étiquette et contrôle, avec l'espacement décidé une fois pour toutes. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input
        type="checkbox"
        className="size-4 shrink-0 rounded border-line-strong text-brand accent-brand"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

// --- Surfaces ----------------------------------------------------------------

export function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<
  InputHTMLAttributes<HTMLDivElement>,
  'children'
>) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface shadow-card', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/**
 * En-tête de page.
 *
 * Titre, phrase d'intention et actions. La phrase n'est pas décorative : elle
 * dit ce que l'écran permet, ce qu'un titre de deux mots ne fait jamais.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

// --- Étiquettes --------------------------------------------------------------

type Ton = 'neutre' | 'marque' | 'positif' | 'attention' | 'critique' | 'info';

const TONS: Record<Ton, string> = {
  neutre: 'bg-sunken text-muted',
  marque: 'bg-brand-soft text-brand-ink',
  positif: 'bg-positive-soft text-positive-ink',
  attention: 'bg-caution-soft text-caution-ink',
  critique: 'bg-critical-soft text-critical-ink',
  info: 'bg-info-soft text-info-ink',
};

export function Badge({
  ton = 'neutre',
  className,
  children,
}: {
  ton?: Ton;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium',
        TONS[ton],
        className,
      )}
    >
      {children}
    </span>
  );
}

// --- Onglets -----------------------------------------------------------------

/**
 * Onglets segmentés.
 *
 * Le curseur actif est un fond plein sur une piste creuse, pas un soulignement :
 * lu de loin, l'onglet courant se distingue sans que l'œil ait à comparer deux
 * traits de deux pixels.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (valeur: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div
      className={cn('inline-flex gap-1 rounded-lg border border-line bg-sunken p-1', className)}
      role="tablist"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --- États -------------------------------------------------------------------

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Message d'alerte, ton porté par la couleur et par le liseré de gauche. */
export function Notice({
  ton = 'attention',
  children,
}: {
  ton?: Exclude<Ton, 'neutre'>;
  children: ReactNode;
}) {
  const bordures: Record<Exclude<Ton, 'neutre'>, string> = {
    marque: 'border-l-brand',
    positif: 'border-l-positive',
    attention: 'border-l-caution',
    critique: 'border-l-critical',
    info: 'border-l-info',
  };

  return (
    <div
      className={cn(
        'rounded-lg border border-l-4 border-line px-3 py-2 text-sm',
        TONS[ton],
        bordures[ton],
      )}
    >
      {children}
    </div>
  );
}

/** Erreur de formulaire : discrète, mais jamais silencieuse. */
export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;

  return <p className="text-xs text-critical">{children}</p>;
}

// --- Tableaux ----------------------------------------------------------------

export function TableWrap({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-x-auto rounded-card border border-line bg-surface shadow-card',
        className,
      )}
    >
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th
      className={cn(
        'border-b border-line bg-sunken px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children?: ReactNode }) {
  return <td className={cn('px-3 py-2.5 align-middle', className)}>{children}</td>;
}

export function Tr({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <tr
      className={cn(
        'border-b border-line/70 transition-colors last:border-0 hover:bg-sunken',
        className,
      )}
    >
      {children}
    </tr>
  );
}
