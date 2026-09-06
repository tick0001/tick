import type { RecurrenceStep } from '@tick/contracts';
import { instantFromZoned, zonedParts } from '../slm/working-time.js';

export interface RecurrenceRule {
  step: RecurrenceStep;
  /** Nombre de pas entre deux occurrences. Toujours ≥ 1. */
  interval: number;
  beginAt: Date;
  endAt?: Date | null;
  /** Fuseau dans lequel l'heure murale de l'occurrence est tenue. */
  timezone: string;
}

/**
 * Garde-fou de boucle.
 *
 * Une règle mal formée — intervalle nul ramené à 1, date de début très
 * ancienne — ne doit pas faire tourner le balayage indéfiniment. Dix mille pas
 * couvrent vingt-sept ans en quotidien : au-delà, il vaut mieux abandonner et
 * le dire que boucler.
 */
const MAX_PAS = 10_000;

const JOUR_MS = 86_400_000;

/**
 * Jours du mois, en tenant compte des bissextiles.
 *
 * Sert au rabattement : une récurrence mensuelle posée le 31 doit produire une
 * occurrence en février. La reporter au 1er mars la déplacerait dans le mois
 * suivant, et l'omettre ferait disparaître un mois sur deux sans le dire.
 */
function joursDansLeMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/**
 * Occurrence numéro `rang`, à partir du début de la règle.
 *
 * Calculée depuis le début plutôt que par pas successifs à partir de la
 * dernière : accumuler les pas ferait dériver une récurrence mensuelle posée le
 * 31 — rabattue au 28 en février, elle resterait au 28 pour toujours.
 */
export function occurrenceAt(regle: RecurrenceRule, rang: number): Date {
  const depart = zonedParts(regle.beginAt, regle.timezone);
  const pas = Math.max(1, Math.trunc(regle.interval));

  if (regle.step === 'monthly') {
    const total = depart.month - 1 + pas * rang;
    const annee = depart.year + Math.floor(total / 12);
    const mois = (total % 12) + 1;

    return instantFromZoned(regle.timezone, {
      ...depart,
      year: annee,
      month: mois,
      day: Math.min(depart.day, joursDansLeMois(annee, mois)),
    });
  }

  const jours = (regle.step === 'weekly' ? 7 : 1) * pas * rang;
  // Le décalage se fait sur la date civile, pas sur l'instant : ajouter
  // `jours × 86 400 000` millisecondes décalerait l'heure murale d'une heure au
  // passage à l'heure d'été, et une intervention prévue à 8 h se retrouverait
  // à 7 h pour le reste de l'année.
  const civil = new Date(Date.UTC(depart.year, depart.month - 1, depart.day) + jours * JOUR_MS);

  return instantFromZoned(regle.timezone, {
    ...depart,
    year: civil.getUTCFullYear(),
    month: civil.getUTCMonth() + 1,
    day: civil.getUTCDate(),
  });
}

/**
 * Première occurrence strictement postérieure à `apres`.
 *
 * `null` quand la règle est épuisée : la date de fin est dépassée, ou le
 * garde-fou a été atteint. L'appelant désactive alors la récurrence plutôt que
 * de la replanifier dans le passé.
 */
export function nextOccurrence(regle: RecurrenceRule, apres: Date): Date | null {
  for (let rang = 0; rang < MAX_PAS; rang += 1) {
    const instant = occurrenceAt(regle, rang);

    if (instant.getTime() > apres.getTime()) {
      if (regle.endAt && instant.getTime() > regle.endAt.getTime()) return null;

      return instant;
    }
  }

  return null;
}

/**
 * Première occurrence à produire, au démarrage d'une règle.
 *
 * Distincte de `nextOccurrence` : à la création, l'occurrence posée exactement
 * sur la date de début doit compter. La chercher « strictement après » la
 * sauterait, et la première exécution manquerait.
 */
export function firstOccurrence(regle: RecurrenceRule, maintenant: Date): Date | null {
  if (regle.beginAt.getTime() >= maintenant.getTime()) {
    if (regle.endAt && regle.beginAt.getTime() > regle.endAt.getTime()) return null;

    return regle.beginAt;
  }

  return nextOccurrence(regle, maintenant);
}

/**
 * L'occurrence est-elle à produire maintenant ?
 *
 * L'avance de création décale le déclenchement, pas l'occurrence : un ticket
 * d'intervention pour lundi 8 h doit exister le vendredi, mais il reste
 * l'occurrence de lundi.
 */
export function estEchue(occurrence: Date, avanceMinutes: number, maintenant: Date): boolean {
  return occurrence.getTime() - avanceMinutes * 60_000 <= maintenant.getTime();
}
