import { describe, expect, it } from 'vitest';
import { estEchue, firstOccurrence, nextOccurrence, occurrenceAt } from './recurrence.js';
import type { RecurrenceRule } from './recurrence.js';

const PARIS = 'Europe/Paris';

function regle(patch: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    step: 'weekly',
    interval: 1,
    // Lundi 2 mars 2026, 8 h à Paris (heure d'hiver, UTC+1).
    beginAt: new Date('2026-03-02T07:00:00Z'),
    endAt: null,
    timezone: PARIS,
    ...patch,
  };
}

/** Heure murale lue dans le fuseau de la règle, pour des assertions lisibles. */
function murale(instant: Date, timezone = PARIS): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(instant);
}

describe('Récurrence', () => {
  it('tient l’heure murale de part et d’autre du changement d’heure', () => {
    // Le passage à l'heure d'été en Europe a lieu le 29 mars 2026. Une
    // récurrence hebdomadaire posée le 2 mars à 8 h doit rester à 8 h après.
    const avant = occurrenceAt(regle(), 3);
    const apres = occurrenceAt(regle(), 5);

    expect(murale(avant)).toBe('23/03/2026 08:00');
    expect(murale(apres)).toBe('06/04/2026 08:00');

    // Et l'instant absolu a bien bougé d'une heure : c'est le fuseau qui a
    // changé, pas l'heure affichée.
    expect(avant.toISOString().slice(11, 16)).toBe('07:00');
    expect(apres.toISOString().slice(11, 16)).toBe('06:00');
  });

  it('rabat le quantième sur le dernier jour du mois plutôt que de sauter', () => {
    const mensuelle = regle({
      step: 'monthly',
      beginAt: new Date('2026-01-31T07:00:00Z'),
    });

    expect(murale(occurrenceAt(mensuelle, 1))).toBe('28/02/2026 08:00');
    // Et surtout : le rabattement ne fait pas dériver la suite. Mars retrouve
    // le 31, ce qu'un calcul par pas successifs aurait perdu.
    expect(murale(occurrenceAt(mensuelle, 2))).toBe('31/03/2026 08:00');
  });

  it('applique l’intervalle au pas choisi', () => {
    const quinzaine = regle({ interval: 2 });

    expect(murale(occurrenceAt(quinzaine, 1))).toBe('16/03/2026 08:00');
  });

  it('cherche la première occurrence strictement postérieure', () => {
    const suivante = nextOccurrence(regle(), new Date('2026-03-09T07:00:00Z'));

    expect(suivante && murale(suivante)).toBe('16/03/2026 08:00');
  });

  it('s’arrête à la date de fin', () => {
    const bornee = regle({ endAt: new Date('2026-03-10T00:00:00Z') });

    expect(nextOccurrence(bornee, new Date('2026-03-09T07:00:00Z'))).toBeNull();
  });

  it('retient la date de début quand elle est encore à venir', () => {
    const future = regle({ beginAt: new Date('2027-01-04T07:00:00Z') });
    const premiere = firstOccurrence(future, new Date('2026-03-02T00:00:00Z'));

    // `nextOccurrence` la sauterait : elle cherche strictement après l'instant
    // donné, et la première exécution manquerait.
    expect(premiere?.toISOString()).toBe('2027-01-04T07:00:00.000Z');
  });

  it('déclenche en avance sans déplacer l’occurrence', () => {
    const occurrence = new Date('2026-03-09T07:00:00Z');
    const deuxJours = 2 * 24 * 60;

    expect(estEchue(occurrence, deuxJours, new Date('2026-03-07T08:00:00Z'))).toBe(true);
    expect(estEchue(occurrence, deuxJours, new Date('2026-03-06T08:00:00Z'))).toBe(false);
    expect(estEchue(occurrence, 0, new Date('2026-03-07T08:00:00Z'))).toBe(false);
  });
});
