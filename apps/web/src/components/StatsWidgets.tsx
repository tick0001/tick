import { useQuery } from '@tanstack/react-query';
import {
  statDimensionSchema,
  type StatDimension,
  type StatsBucket,
  type StatsFilter,
  type StatsReport,
  type StatsTrendPoint,
} from '@tick/contracts';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

/**
 * Durée lisible, à partir de secondes.
 *
 * Arrondie à l'heure au-delà d'un jour : personne ne pilote un service à la
 * minute près, et afficher « 3 j 4 h 27 min » donne une fausse impression de
 * précision sur une moyenne.
 */
export function duree(secondes: number | null, aucune: string): string {
  if (secondes === null) return aucune;

  const heures = Math.round(secondes / 3600);

  if (heures < 24) return `${String(heures)} h`;

  const jours = Math.floor(heures / 24);

  return `${String(jours)} j ${String(heures % 24)} h`;
}

function Carte({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
      <div className="text-xs font-medium text-faint">{libelle}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{valeur}</div>
    </div>
  );
}

export function Compteurs({ rapport }: { rapport: StatsReport }) {
  const { t } = useTranslation();
  const { summary } = rapport;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Carte libelle={t('statistiques.ouverts')} valeur={String(summary.opened)} />
      <Carte libelle={t('statistiques.resolus')} valeur={String(summary.solved)} />
      <Carte libelle={t('statistiques.clos')} valeur={String(summary.closed)} />
      <Carte libelle={t('statistiques.enCours')} valeur={String(summary.pending)} />
      <Carte
        libelle={t('statistiques.priseEnCompte')}
        valeur={duree(summary.averageTakeIntoAccount, '—')}
      />
      <Carte libelle={t('statistiques.resolution')} valeur={duree(summary.averageSolve, '—')} />
      <Carte
        libelle={t('statistiques.respectSla')}
        valeur={
          summary.slaCompliance === null ? '—' : `${String(Math.round(summary.slaCompliance * 100))} %`
        }
      />
      <Carte
        libelle={t('statistiques.satisfaction')}
        valeur={
          summary.satisfaction === null
            ? '—'
            : `${summary.satisfaction.toFixed(1)} / 5 · ${String(summary.satisfactionCount)} ${t(
                'statistiques.reponses',
              )}`
        }
      />
    </div>
  );
}

/**
 * Répartition, en barres proportionnelles.
 *
 * Dessinée en CSS plutôt qu'avec une bibliothèque de graphiques : une barre
 * horizontale est une div dont on fixe la largeur, et un graphique importé
 * pèserait plus lourd que tout le reste de la page.
 */
export function Repartition({
  seaux,
  dimension,
}: {
  seaux: readonly StatsBucket[];
  dimension?: StatDimension;
}) {
  const { t } = useTranslation();
  const maximum = Math.max(1, ...seaux.map((seau) => seau.opened));

  /**
   * Libellé d'un segment.
   *
   * Le serveur renvoie le nom quand il en existe un — une catégorie, un
   * technicien — et la valeur brute pour une énumération, qu'il ne sait pas
   * traduire. « assigned » n'est pas un libellé : les trois dimensions
   * énumérées sont donc traduites ici, où les clés existent.
   */
  const libelle = (seau: StatsBucket): string => {
    if (dimension === 'status') return t(`tickets.statuts.${seau.key}` as 'tickets.statuts.new');
    if (dimension === 'type') return t(`tickets.types.${seau.key}` as 'tickets.types.incident');
    if (dimension === 'priority') {
      return t(`tickets.priorites.p${seau.key}` as 'tickets.priorites.p1');
    }

    return seau.label;
  };

  if (seaux.length === 0) {
    return <p className="text-sm text-muted">{t('statistiques.aucuneDonnee')}</p>;
  }

  return (
    <ul className="space-y-1.5">
      {seaux.map((seau) => (
        <li key={seau.key} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{libelle(seau)}</span>
            <span className="tabular-nums text-muted">
              {seau.opened} · {duree(seau.averageSolve, '—')}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-sunken">
            <div
              className="h-full rounded bg-brand"
              style={{ width: `${String((seau.opened / maximum) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Courbe d'activité, en aires empilées minimalistes.
 *
 * Le tracé est un `polyline` SVG : deux séries, une grille implicite, pas
 * d'axes. Ce que l'on cherche ici est une forme — une charge qui monte, un
 * arriéré qui se creuse — pas une lecture au point près.
 */
export function Tendance({ points }: { points: readonly StatsTrendPoint[] }) {
  const { t } = useTranslation();

  if (points.length === 0) {
    return <p className="text-sm text-muted">{t('statistiques.aucuneDonnee')}</p>;
  }

  const maximum = Math.max(1, ...points.flatMap((point) => [point.opened, point.closed]));
  const largeur = 100;
  const hauteur = 30;
  const trace = (valeurs: readonly number[]): string =>
    valeurs
      .map((valeur, index) => {
        const x = (index / Math.max(1, valeurs.length - 1)) * largeur;
        const y = hauteur - (valeur / maximum) * hauteur;

        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${String(largeur)} ${String(hauteur)}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={t('statistiques.tendance')}
      >
        <polyline
          points={trace(points.map((point) => point.opened))}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.6}
          className="text-ink"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={trace(points.map((point) => point.closed))}
          fill="none"
          stroke="currentColor"
          strokeWidth={0.6}
          strokeDasharray="2 2"
          className="text-faint"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="flex justify-between text-xs text-muted">
        <span>{points[0]?.day}</span>
        <span>
          — {t('statistiques.ouverts')} · ┄ {t('statistiques.clos')}
        </span>
        <span>{points.at(-1)?.day}</span>
      </div>
    </div>
  );
}

/**
 * Rendu d'un widget de tableau de bord.
 *
 * Chaque widget lit sa propre configuration et pose sa propre requête. Faire
 * descendre un rapport unique depuis la page aurait été plus économe et aurait
 * rendu la configuration inopérante : deux widgets « répartition » sur deux
 * dimensions différentes auraient affiché la même chose.
 *
 * Un widget déclaré par un plugin n'a pas de rendu ici : il montre sa clé, et
 * l'extension d'interface du plugin prendra le relais. Un widget muet vaut
 * mieux qu'un tableau qui refuse de s'afficher parce qu'une extension manque.
 */
export function WidgetView({
  kind,
  config,
  filtre,
}: {
  kind: string;
  config: Record<string, unknown>;
  filtre: StatsFilter;
}) {
  const { t } = useTranslation();
  const dimension = statDimensionSchema.safeParse(config['dimension']);
  const propre: StatsFilter = dimension.success ? { ...filtre, dimension: dimension.data } : filtre;

  const rapport = useQuery({
    queryKey: ['stats', propre],
    queryFn: () => api.stats(propre),
    retry: false,
    enabled: kind !== 'core.trend',
  });

  const tendance = useQuery({
    queryKey: ['stats-trend', propre],
    queryFn: () => api.statsTrend(propre),
    retry: false,
    enabled: kind === 'core.trend',
  });

  if (kind === 'core.trend') {
    return tendance.data ? (
      <Tendance points={tendance.data} />
    ) : (
      <p className="text-sm text-muted">{t('commun.chargement')}</p>
    );
  }

  if (!rapport.data) return <p className="text-sm text-muted">{t('commun.chargement')}</p>;

  const { summary } = rapport.data;

  switch (kind) {
    case 'core.counts':
      return <Compteurs rapport={rapport.data} />;

    case 'core.breakdown':
      return <Repartition seaux={rapport.data.buckets} dimension={propre.dimension} />;

    case 'core.sla':
      return (
        <p className="text-2xl font-semibold tabular-nums">
          {summary.slaCompliance === null
            ? '—'
            : `${String(Math.round(summary.slaCompliance * 100))} %`}
        </p>
      );

    case 'core.satisfaction':
      return (
        <p className="text-2xl font-semibold tabular-nums">
          {summary.satisfaction === null ? '—' : `${summary.satisfaction.toFixed(1)} / 5`}
          <span className="ml-2 text-xs font-normal text-muted">
            {summary.satisfactionCount} {t('statistiques.reponses')}
          </span>
        </p>
      );

    default:
      return <p className="text-sm text-muted">{kind}</p>;
  }
}
