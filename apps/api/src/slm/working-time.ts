/**
 * Arithmétique du temps ouvré.
 *
 * Volontairement sans dépendance : le calcul se réduit à deux opérations —
 * convertir un instant en heure murale dans un fuseau, et l'inverse — et une
 * bibliothèque de dates complète coûterait plus en surface qu'elle n'apporte
 * ici. Les fonctions sont pures pour rester testables sans base ni horloge.
 */

/** Une plage d'ouverture, telle qu'elle est stockée. */
export interface WorkingSegment {
  /** 0 = dimanche, conformément à `Date.getDay()`. */
  weekday: number;
  /** `HH:MM[:SS]`, heure murale. */
  beginAt: string;
  endAt: string;
}

export interface WorkingHoliday {
  /** `YYYY-MM-DD`. */
  day: string;
  /** Revient chaque année à la même date. */
  isPerpetual: boolean;
}

export interface WorkingCalendar {
  timezone: string;
  segments: readonly WorkingSegment[];
  holidays: readonly WorkingHoliday[];
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const SECONDS_PER_DAY = 86_400;

/**
 * Garde-fou de boucle.
 *
 * Un calendrier dont toutes les plages ont été supprimées ne fournit aucune
 * seconde ouvrée : sans borne, le calcul d'échéance tournerait indéfiniment.
 * Dix ans dépassent de loin tout engagement plausible.
 */
const MAX_DAYS = 3660;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let existant = formatters.get(timezone);

  if (!existant) {
    existant = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, existant);
  }

  return existant;
}

/** Vrai si le fuseau est connu du moteur ICU embarqué. */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });

    return true;
  } catch {
    return false;
  }
}

/**
 * Heure murale d'un instant, dans un fuseau donné.
 *
 * Exportée pour la récurrence, qui a le même besoin : une occurrence
 * hebdomadaire doit rester à la même heure murale de part et d'autre d'un
 * changement d'heure. Deux implémentations du même calcul divergeraient
 * exactement le week-end où l'écart se voit.
 */
export function zonedParts(instant: Date, timezone: string): ZonedParts {
  const parts = formatter(timezone).formatToParts(instant);
  const lu = (type: Intl.DateTimeFormatPartTypes): number => {
    const trouve = parts.find((part) => part.type === type);

    return trouve ? Number(trouve.value) : 0;
  };

  return {
    year: lu('year'),
    month: lu('month'),
    day: lu('day'),
    hour: lu('hour'),
    minute: lu('minute'),
    second: lu('second'),
  };
}

/** Décalage du fuseau, en millisecondes, à un instant donné. */
function offsetAt(timezone: string, instantMs: number): number {
  const parts = zonedParts(new Date(instantMs), timezone);
  const commeUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return commeUtc - instantMs;
}

/**
 * Instant correspondant à une heure murale.
 *
 * Deux passes : la première estime le décalage à l'instant naïf, la seconde le
 * corrige si l'estimation tombait du mauvais côté d'un changement d'heure.
 * C'est la méthode de convergence habituelle, et elle suffit parce qu'aucun
 * fuseau ne change d'heure deux fois dans la même journée.
 */
export function instantFromZoned(timezone: string, parts: ZonedParts): Date {
  const naif = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const premiere = naif - offsetAt(timezone, naif);

  return new Date(naif - offsetAt(timezone, premiere));
}

/** Jour de la semaine d'une date civile, sans passer par le fuseau local. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** `HH:MM[:SS]` en secondes depuis minuit. */
function secondsOfTime(valeur: string): number {
  const [heures = '0', minutes = '0', secondes = '0'] = valeur.split(':');

  return Number(heures) * 3600 + Number(minutes) * 60 + Number(secondes);
}

function pad(valeur: number): string {
  return String(valeur).padStart(2, '0');
}

function isoDay(parts: ZonedParts): string {
  return `${String(parts.year)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Decale d'un jour civil, en restant sur des dates civiles. */
function shiftDay(parts: ZonedParts, pas: number): ZonedParts {
  const decale = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + pas));

  return {
    year: decale.getUTCFullYear(),
    month: decale.getUTCMonth() + 1,
    day: decale.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

function nextDay(parts: ZonedParts): ZonedParts {
  return shiftDay(parts, 1);
}

function previousDay(parts: ZonedParts): ZonedParts {
  return shiftDay(parts, -1);
}

function isHoliday(calendar: WorkingCalendar, parts: ZonedParts): boolean {
  const jour = isoDay(parts);
  const mmdd = jour.slice(5);

  return calendar.holidays.some((ferie) =>
    ferie.isPerpetual ? ferie.day.slice(5) === mmdd : ferie.day === jour,
  );
}

/**
 * Plages ouvertes d'un jour, en secondes depuis minuit, fusionnées.
 *
 * La fusion n'est pas un détail : deux plages saisies « 8h-12h » et « 11h-18h »
 * compteraient une heure deux fois, et l'échéance tomberait trop tôt.
 */
function daySpans(calendar: WorkingCalendar, parts: ZonedParts): [number, number][] {
  if (isHoliday(calendar, parts)) {
    return [];
  }

  const jourSemaine = weekdayOf(parts.year, parts.month, parts.day);
  const brutes = calendar.segments
    .filter((segment) => segment.weekday === jourSemaine)
    .map((segment): [number, number] => [
      Math.max(0, secondsOfTime(segment.beginAt)),
      Math.min(SECONDS_PER_DAY, secondsOfTime(segment.endAt)),
    ])
    .filter(([debut, fin]) => fin > debut)
    .sort((a, b) => a[0] - b[0]);

  const fusionnees: [number, number][] = [];

  for (const [debut, fin] of brutes) {
    const derniere = fusionnees.at(-1);

    if (derniere && debut <= derniere[1]) {
      derniere[1] = Math.max(derniere[1], fin);
    } else {
      fusionnees.push([debut, fin]);
    }
  }

  return fusionnees;
}

/** Un calendrier sans aucune plage revient à compter en temps calendaire. */
function isCalendarTime(calendar: WorkingCalendar | null): calendar is null {
  return calendar === null || calendar.segments.length === 0;
}

function atSecondOfDay(timezone: string, parts: ZonedParts, seconds: number): Date {
  const borne = Math.min(seconds, SECONDS_PER_DAY - 1);

  return instantFromZoned(timezone, {
    ...parts,
    hour: Math.floor(borne / 3600),
    minute: Math.floor((borne % 3600) / 60),
    second: borne % 60,
  });
}

/**
 * Ajoute des secondes ouvrées à un instant.
 *
 * Un calendrier absent ou vide fait basculer en temps calendaire plutôt que
 * d'échouer : un engagement « 4 heures, 24/7 » est un cas légitime, pas une
 * configuration incomplète.
 */
export function addWorkingSeconds(
  calendar: WorkingCalendar | null,
  from: Date,
  seconds: number,
): Date {
  if (seconds <= 0) {
    return new Date(from.getTime());
  }

  if (isCalendarTime(calendar)) {
    return new Date(from.getTime() + seconds * 1000);
  }

  const { timezone } = calendar;
  let jour = zonedParts(from, timezone);
  let curseur = jour.hour * 3600 + jour.minute * 60 + jour.second;
  let restant = seconds;

  for (let index = 0; index < MAX_DAYS; index += 1) {
    for (const [debut, fin] of daySpans(calendar, jour)) {
      const depart = Math.max(debut, curseur);

      if (depart >= fin) {
        continue;
      }

      const disponible = fin - depart;

      if (restant <= disponible) {
        return atSecondOfDay(timezone, jour, depart + restant);
      }

      restant -= disponible;
    }

    jour = nextDay(jour);
    curseur = 0;
  }

  throw new Error(
    `Le calendrier n'offre pas ${String(seconds)} secondes ouvrées en ${String(MAX_DAYS)} jours.`,
  );
}

/**
 * Secondes ouvrées écoulées entre deux instants.
 *
 * Sert au recalcul après suspension : le temps passé « en attente » se retire
 * de ce qui a déjà été consommé, pas de la durée de l'engagement.
 */
export function workingSecondsBetween(
  calendar: WorkingCalendar | null,
  from: Date,
  to: Date,
): number {
  if (to.getTime() <= from.getTime()) {
    return 0;
  }

  if (isCalendarTime(calendar)) {
    return Math.round((to.getTime() - from.getTime()) / 1000);
  }

  const { timezone } = calendar;
  const fin = zonedParts(to, timezone);
  const finJour = isoDay(fin);
  const finSecondes = fin.hour * 3600 + fin.minute * 60 + fin.second;

  let jour = zonedParts(from, timezone);
  let curseur = jour.hour * 3600 + jour.minute * 60 + jour.second;
  let total = 0;

  for (let index = 0; index < MAX_DAYS; index += 1) {
    const courant = isoDay(jour);
    const dernier = courant === finJour;

    for (const [debut, borne] of daySpans(calendar, jour)) {
      const depart = Math.max(debut, curseur);
      const arrivee = dernier ? Math.min(borne, finSecondes) : borne;

      if (arrivee > depart) {
        total += arrivee - depart;
      }
    }

    if (dernier || courant > finJour) {
      return total;
    }

    jour = nextDay(jour);
    curseur = 0;
  }

  return total;
}

/**
 * Retire des secondes ouvrees a un instant.
 *
 * Symetrique de l'ajout, et indispensable aux rappels d'escalade : « deux
 * heures ouvrees avant l'echeance » ne se calcule pas en soustrayant deux
 * heures calendaires, sans quoi un rappel prevu un lundi matin tomberait le
 * dimanche, ou personne ne le verra.
 */
export function subtractWorkingSeconds(
  calendar: WorkingCalendar | null,
  from: Date,
  seconds: number,
): Date {
  if (seconds <= 0) {
    return new Date(from.getTime());
  }

  if (isCalendarTime(calendar)) {
    return new Date(from.getTime() - seconds * 1000);
  }

  const { timezone } = calendar;
  let jour = zonedParts(from, timezone);
  let curseur = jour.hour * 3600 + jour.minute * 60 + jour.second;
  let restant = seconds;

  for (let index = 0; index < MAX_DAYS; index += 1) {
    for (const [debut, fin] of [...daySpans(calendar, jour)].reverse()) {
      const arrivee = Math.min(fin, curseur);

      if (arrivee <= debut) {
        continue;
      }

      const disponible = arrivee - debut;

      if (restant <= disponible) {
        return atSecondOfDay(timezone, jour, arrivee - restant);
      }

      restant -= disponible;
    }

    jour = previousDay(jour);
    curseur = SECONDS_PER_DAY;
  }

  throw new Error(
    `Le calendrier n'offre pas ${String(seconds)} secondes ouvrees en ${String(MAX_DAYS)} jours.`,
  );
}
