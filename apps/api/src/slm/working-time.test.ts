import { describe, expect, it } from 'vitest';
import {
  addWorkingSeconds,
  isKnownTimezone,
  subtractWorkingSeconds,
  workingSecondsBetween,
  type WorkingCalendar,
} from './working-time.js';

const HEURE = 3600;

/** Lundi-vendredi, 8h-12h puis 13h-18h : neuf heures ouvrées par jour. */
const bureau: WorkingCalendar = {
  timezone: 'Europe/Paris',
  segments: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, beginAt: '08:00:00', endAt: '12:00:00' },
    { weekday, beginAt: '13:00:00', endAt: '18:00:00' },
  ]),
  holidays: [],
};

describe('temps ouvré', () => {
  it('avance à l’intérieur d’une plage', () => {
    // Mardi 10 mars 2026, 9h00 heure de Paris (UTC+1 en mars).
    const depart = new Date('2026-03-10T08:00:00Z');

    expect(addWorkingSeconds(bureau, depart, 2 * HEURE).toISOString()).toBe(
      '2026-03-10T10:00:00.000Z',
    );
  });

  it('saute la pause déjeuner', () => {
    // Mardi 11h00 locale + 2h ouvrées : 12h-13h ne compte pas, donc 14h00.
    const depart = new Date('2026-03-10T10:00:00Z');

    expect(addWorkingSeconds(bureau, depart, 2 * HEURE).toISOString()).toBe(
      '2026-03-10T13:00:00.000Z',
    );
  });

  it('reporte au lendemain matin après la fermeture', () => {
    // Mardi 17h00 locale + 2h : une heure mardi, une heure mercredi dès 8h.
    const depart = new Date('2026-03-10T16:00:00Z');

    expect(addWorkingSeconds(bureau, depart, 2 * HEURE).toISOString()).toBe(
      '2026-03-11T08:00:00.000Z',
    );
  });

  it('démarre à l’ouverture quand le ticket arrive la nuit', () => {
    // Mardi 3h00 locale : rien avant 8h.
    const depart = new Date('2026-03-10T02:00:00Z');

    expect(addWorkingSeconds(bureau, depart, HEURE).toISOString()).toBe('2026-03-10T08:00:00.000Z');
  });

  it('franchit le week-end', () => {
    // Vendredi 13 mars 17h00 locale + 3h : 1h vendredi, puis lundi 16 dès 8h.
    const depart = new Date('2026-03-13T16:00:00Z');

    expect(addWorkingSeconds(bureau, depart, 3 * HEURE).toISOString()).toBe(
      '2026-03-16T09:00:00.000Z',
    );
  });

  it('ignore un jour férié perpétuel', () => {
    const avecFerie: WorkingCalendar = {
      ...bureau,
      holidays: [{ day: '2020-05-01', isPerpetual: true }],
    };
    // Le 1er mai 2026 tombe un vendredi : on bascule au lundi 4 mai.
    const depart = new Date('2026-04-30T15:00:00Z'); // jeudi 17h00 locale

    expect(addWorkingSeconds(avecFerie, depart, 3 * HEURE).toISOString()).toBe(
      '2026-05-04T08:00:00.000Z',
    );
  });

  it('distingue un férié ponctuel d’un férié perpétuel', () => {
    const ponctuel: WorkingCalendar = {
      ...bureau,
      holidays: [{ day: '2026-03-11', isPerpetual: false }],
    };
    const depart = new Date('2026-03-10T16:00:00Z'); // mardi 17h00 locale

    // Mercredi 11 est fermé, on reprend jeudi 12 à 8h.
    expect(addWorkingSeconds(ponctuel, depart, 2 * HEURE).toISOString()).toBe(
      '2026-03-12T08:00:00.000Z',
    );
    // La même date une autre année reste ouvrée.
    expect(addWorkingSeconds(ponctuel, new Date('2027-03-10T16:00:00Z'), 2 * HEURE)).toEqual(
      new Date('2027-03-11T08:00:00Z'), // 9h locale, UTC+1 en mars
    );
  });

  it('traverse le changement d’heure sans dériver', () => {
    // La France passe à l'heure d'été le dimanche 29 mars 2026.
    // Vendredi 27 mars 17h locale (16h UTC) : il reste une heure ouvrée. Les
    // deux suivantes tombent lundi 30 mars, de 8h à 10h locale — soit 8h UTC
    // et non 9h, parce que le décalage est passé à +2 entre-temps.
    const depart = new Date('2026-03-27T16:00:00Z');

    expect(addWorkingSeconds(bureau, depart, 3 * HEURE).toISOString()).toBe(
      '2026-03-30T08:00:00.000Z',
    );
  });

  it('fusionne des plages qui se chevauchent', () => {
    const chevauchant: WorkingCalendar = {
      timezone: 'Europe/Paris',
      segments: [
        { weekday: 2, beginAt: '08:00:00', endAt: '12:00:00' },
        { weekday: 2, beginAt: '11:00:00', endAt: '18:00:00' },
      ],
      holidays: [],
    };
    const depart = new Date('2026-03-10T07:00:00Z'); // mardi 8h locale

    // Sans fusion, l'heure de 11h à 12h compterait deux fois.
    expect(workingSecondsBetween(chevauchant, depart, new Date('2026-03-10T17:00:00Z'))).toBe(
      10 * HEURE,
    );
  });

  it('compte le temps calendaire sans calendrier', () => {
    const depart = new Date('2026-03-14T00:00:00Z'); // un samedi

    expect(addWorkingSeconds(null, depart, 4 * HEURE).toISOString()).toBe(
      '2026-03-14T04:00:00.000Z',
    );
    expect(workingSecondsBetween(null, depart, new Date('2026-03-15T00:00:00Z'))).toBe(24 * HEURE);
  });

  it('refuse de boucler sur un calendrier sans aucune ouverture', () => {
    const ferme: WorkingCalendar = {
      timezone: 'Europe/Paris',
      segments: [{ weekday: 1, beginAt: '08:00:00', endAt: '08:00:00' }],
      holidays: [],
    };

    expect(() => addWorkingSeconds(ferme, new Date('2026-03-10T08:00:00Z'), HEURE)).toThrow(
      /secondes ouvrées/,
    );
  });
});

describe('mesure du temps écoulé', () => {
  it('ne compte que les heures ouvrées', () => {
    // Mardi 11h locale à mercredi 9h locale : 1h + 5h + 1h = 7h.
    const debut = new Date('2026-03-10T10:00:00Z');
    const fin = new Date('2026-03-11T08:00:00Z');

    expect(workingSecondsBetween(bureau, debut, fin)).toBe(7 * HEURE);
  });

  it('renvoie zéro quand les bornes sont inversées', () => {
    expect(
      workingSecondsBetween(
        bureau,
        new Date('2026-03-11T08:00:00Z'),
        new Date('2026-03-10T08:00:00Z'),
      ),
    ).toBe(0);
  });

  it('est l’inverse de l’ajout', () => {
    const depart = new Date('2026-03-10T08:00:00Z');
    const echeance = addWorkingSeconds(bureau, depart, 20 * HEURE);

    expect(workingSecondsBetween(bureau, depart, echeance)).toBe(20 * HEURE);
  });
});

describe('fuseaux', () => {
  it('reconnaît un fuseau valide et rejette un fuseau inventé', () => {
    expect(isKnownTimezone('Europe/Paris')).toBe(true);
    expect(isKnownTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('recul dans le temps ouvre', () => {
  it('recule a l’interieur d’une plage', () => {
    // Mardi 15h locale - 2h : 13h locale.
    expect(
      subtractWorkingSeconds(bureau, new Date('2026-03-10T14:00:00Z'), 2 * HEURE).toISOString(),
    ).toBe('2026-03-10T12:00:00.000Z');
  });

  it('remonte la pause dejeuner', () => {
    // Mardi 14h locale - 2h : 13h puis 11h, la pause ne comptant pas.
    expect(
      subtractWorkingSeconds(bureau, new Date('2026-03-10T13:00:00Z'), 2 * HEURE).toISOString(),
    ).toBe('2026-03-10T10:00:00.000Z');
  });

  it('remonte au vendredi soir depuis le lundi matin', () => {
    // Lundi 16 mars 9h locale - 2h : 1h lundi, 1h vendredi 13 a 17h.
    expect(
      subtractWorkingSeconds(bureau, new Date('2026-03-16T08:00:00Z'), 2 * HEURE).toISOString(),
    ).toBe('2026-03-13T16:00:00.000Z');
  });

  it('annule exactement un ajout', () => {
    const depart = new Date('2026-03-10T09:30:00Z');
    const echeance = addWorkingSeconds(bureau, depart, 13 * HEURE);

    expect(subtractWorkingSeconds(bureau, echeance, 13 * HEURE).toISOString()).toBe(
      depart.toISOString(),
    );
  });

  it('recule en temps calendaire sans calendrier', () => {
    expect(
      subtractWorkingSeconds(null, new Date('2026-03-14T06:00:00Z'), 4 * HEURE).toISOString(),
    ).toBe('2026-03-14T02:00:00.000Z');
  });
});
