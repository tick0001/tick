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

/**
 * La marque : l'esperluette du nom.
 *
 * « Tick& » porte deja son signe distinctif dans son nom. Un « T » dans un carre
 * arrondi est le monogramme que produit n'importe quel generateur ; l'esperluette
 * ne ressemble qu'a cette application, et se reconnait a la taille d'un favicon.
 *
 * Le carre est presque droit et l'aplat plein : c'est le seul endroit de
 * l'interface ou le vermillon occupe une surface, ce qui en fait un point
 * d'ancrage plutot qu'une decoration de plus.
 */
export function Marque({ taille = 'sm' }: { taille?: 'sm' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-[3px] bg-brand font-bold text-on-brand',
        taille === 'lg' ? 'size-11 text-2xl' : 'size-7 text-base',
      )}
    >
      &amp;
    </span>
  );
}

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
 * Un rectangle franc, pas une pilule. Le champ est une **zone à remplir** sur un
 * formulaire : il se pose sur le papier, cerné d'un filet, et le filet s'assombrit
 * quand on écrit dedans. Le coin arrondi et la bordure qui vire au bleu au focus
 * sont le réglage par défaut de toutes les bibliothèques — et ne disent rien de
 * plus que « ceci est un champ ».
 *
 * Le focus ne colore pas la bordure : l'anneau vermillon posé sur le document
 * s'en charge déjà. Doubler le signal en ferait deux, dont aucun ne porte.
 *
 * Exporté aussi comme chaîne : quelques formulaires composent leurs champs à la
 * main, et leur imposer un composant aurait ajouté une enveloppe pour rien.
 */
export const CONTROLE =
  'h-9 w-full rounded-[2px] border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-faint transition-colors hover:border-line-strong focus:border-ink disabled:bg-sunken disabled:opacity-70';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROLE, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(CONTROLE, 'h-auto py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROLE, 'pr-8', className)} {...props} />;
}

/**
 * Étiquette et contrôle, avec l'espacement décidé une fois pour toutes.
 *
 * L'étiquette est en petites capitales : sur un formulaire dense, elle se
 * distingue alors de la valeur saisie sans qu'on ait à la mettre en gras ni à
 * la grossir. C'est la convention des bordereaux et des plans — elle nomme la
 * case sans se disputer la lecture avec ce qu'on y écrit.
 */
export function Field({
  label,
  hint,
  className,
  groupe = false,
  children,
}: {
  label: string;
  hint?: string | undefined;
  className?: string | undefined;
  /**
   * Le champ porte plusieurs controles, et non un seul.
   *
   * Un `<label>` s'associe a **un** controle : celui qu'il enveloppe, ou le
   * premier s'il en enveloppe plusieurs. Un groupe de cases logees dans un
   * `<label>` produit donc des etiquettes imbriquees -- ce que la norme
   * interdit -- et, a l'usage, un clic sur la troisieme case qui bascule aussi
   * la premiere. Le groupe se declare en `<fieldset>`, dont c'est le role.
   */
  groupe?: boolean;
  children: ReactNode;
}) {
  const intitule = (
    <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">
      {label}
    </span>
  );

  const aide = hint ? <span className="block text-xs text-faint">{hint}</span> : null;

  if (groupe) {
    return (
      <fieldset className={cn('block space-y-1', className)}>
        <legend>{intitule}</legend>
        {children}
        {aide}
      </fieldset>
    );
  }

  return (
    <label className={cn('block space-y-1', className)}>
      {intitule}
      {children}
      {aide}
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
        className="size-4 shrink-0 rounded-[2px] border-line-strong accent-brand"
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
 * Le filet d'encre sous le titre n'est pas un ornement : c'est ce qui donne son
 * assise à la page. Sans lui, le trio « titre, phrase grise, bouton » flotte au
 * milieu du vide — la composition que produit toute bibliothèque, et qui ne dit
 * jamais où la page commence.
 *
 * L'intention passe **sous** le filet, avec le contenu. Elle appartient à ce
 * qu'on lit, pas à l'en-tête ; la garder au-dessus l'aurait mise sur le même
 * plan que le titre, qu'elle n'a pas à concurrencer.
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
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-3">
        <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
    </header>
  );
}

/**
 * Bandeau de filtres, posé sous l'en-tête.
 *
 * Les filtres laissés à nu sur le papier se lisent comme des restes : rien ne
 * dit qu'ils forment un ensemble, ni qu'ils commandent la liste qui suit. Le
 * fond creux et le filet les tiennent, et rattachent visuellement la commande à
 * son résultat.
 */
export function FilterBar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 border border-line bg-sunken px-3 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Titre de section, prolongé d'un filet jusqu'au bord.
 *
 * C'est le rythme vertical d'un document technique : l'œil trouve les sections
 * en balayant les filets, sans lire les libellés. Un petit gras nu, lui, se
 * confond avec le contenu dès que la page s'allonge.
 */
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h3 className="text-xs font-semibold tracking-wider whitespace-nowrap text-muted uppercase">
        {children}
      </h3>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {action}
    </div>
  );
}

/**
 * Actions de ligne : des verbes, pas des boutons.
 *
 * Répétées sur chaque ligne d'un tableau, deux boutons pleins deviennent le
 * motif dominant de l'écran — on voit la colonne d'actions avant les données
 * qu'elle commande. Un verbe discret, souligné au survol, rend la ligne à son
 * contenu tout en restant atteignable au clavier.
 */
export const ACTION_LIGNE =
  'text-xs font-medium text-muted underline-offset-2 transition-colors hover:text-ink hover:underline disabled:pointer-events-none disabled:opacity-40';

/** Même chose, pour ce qui détruit : l'encre critique tient lieu d'avertissement. */
export const ACTION_LIGNE_DANGER =
  'text-xs font-medium text-critical underline-offset-2 transition-colors hover:underline disabled:pointer-events-none disabled:opacity-40';

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
