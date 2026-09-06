import type { PlanningEntry } from '@tick/contracts';
import { describe, expect, it } from 'vitest';
import { toIcalendar } from './ical.js';
import { marqueConflits } from './planning.service.js';

function entree(patch: Partial<PlanningEntry> & { id: number }): PlanningEntry {
  return {
    kind: 'task',
    beginAt: '2026-09-07T08:00:00.000Z',
    endAt: '2026-09-07T09:00:00.000Z',
    title: 'Tache',
    userId: 1,
    userName: 'Thomas Petit',
    groupId: null,
    groupName: null,
    itilType: 'ticket',
    itilId: 12,
    state: 'todo',
    conflicts: [],
    ...patch,
  };
}

describe('Conflits de planning', () => {
  it('marque un chevauchement dans les deux sens', () => {
    const resultat = marqueConflits([
      entree({ id: 1 }),
      entree({ id: 2, beginAt: '2026-09-07T08:30:00.000Z', endAt: '2026-09-07T10:00:00.000Z' }),
    ]);

    expect(resultat[0]?.conflicts).toEqual([2]);
    expect(resultat[1]?.conflicts).toEqual([1]);
  });

  it('ignore deux entrées qui se touchent sans se recouvrir', () => {
    const resultat = marqueConflits([
      entree({ id: 1 }),
      entree({ id: 2, beginAt: '2026-09-07T09:00:00.000Z', endAt: '2026-09-07T10:00:00.000Z' }),
    ]);

    expect(resultat.every((valeur) => valeur.conflicts.length === 0)).toBe(true);
  });

  it('ne rapproche pas deux techniciens différents', () => {
    // Deux personnes occupées au même moment, c'est une équipe qui travaille.
    const resultat = marqueConflits([entree({ id: 1 }), entree({ id: 2, userId: 2 })]);

    expect(resultat.every((valeur) => valeur.conflicts.length === 0)).toBe(true);
  });

  it('laisse hors conflit une tâche sans technicien', () => {
    // Affectée à un groupe seulement : personne n'est encore engagé.
    const resultat = marqueConflits([entree({ id: 1, userId: null }), entree({ id: 2 })]);

    expect(resultat.every((valeur) => valeur.conflicts.length === 0)).toBe(true);
  });

  it('détecte un conflit entre une tâche et une indisponibilité', () => {
    const resultat = marqueConflits([
      entree({ id: 1 }),
      entree({
        id: 2,
        kind: 'unavailability',
        beginAt: '2026-09-07T00:00:00.000Z',
        endAt: '2026-09-08T00:00:00.000Z',
        itilType: null,
        itilId: null,
        state: null,
      }),
    ]);

    expect(resultat[0]?.conflicts).toContain(2);
  });
});

describe('Export iCal', () => {
  it('échappe les caractères réservés', () => {
    const sortie = toIcalendar([entree({ id: 1, title: 'Diagnostic; 2e etage, salle B\\C' })]);

    expect(sortie).toContain('SUMMARY:Diagnostic\\; 2e etage\\, salle B\\\\C');
  });

  it('replie les lignes longues sans couper un caractère accentué', () => {
    const long = `Intervention ${'é'.repeat(80)}`;
    const sortie = toIcalendar([entree({ id: 1, title: long })]);
    const lignes = sortie.split('\r\n').filter((ligne) => ligne.length > 0);

    for (const ligne of lignes) {
      expect(Buffer.from(ligne, 'utf8').length).toBeLessThanOrEqual(75);
    }

    // Recomposée, la valeur doit être intacte : un repli qui perd un octet
    // produit un fichier que le client accepte et affiche de travers.
    const recompose = lignes
      .filter((ligne) => ligne.startsWith('SUMMARY:') || ligne.startsWith(' '))
      .map((ligne) => (ligne.startsWith(' ') ? ligne.slice(1) : ligne.slice('SUMMARY:'.length)))
      .join('');

    expect(recompose).toBe(long);
  });

  it('marque les tâches d’information comme n’occupant pas la personne', () => {
    const sortie = toIcalendar([entree({ id: 1, state: 'information' })]);

    expect(sortie).toContain('TRANSP:TRANSPARENT');
  });

  it('termine par une fin de calendrier et des sauts CRLF', () => {
    const sortie = toIcalendar([entree({ id: 1 })]);

    expect(sortie.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(sortie.includes('\n\n')).toBe(false);
  });
});
