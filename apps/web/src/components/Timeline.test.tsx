import type { TimelineEntry } from '@tick/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { rendre } from '@/test/rendu';
import { Timeline } from './Timeline';

/**
 * La chronologie d'un objet ITIL.
 *
 * Un seul composant pour le ticket, le problème et le changement : les
 * satellites sont polymorphes en base, et les rendre différemment selon le
 * porteur reviendrait à nier ce que le modèle a déjà unifié.
 *
 * L'enjeu d'affichage est la **hiérarchie de lecture** : un suivi rédigé par un
 * humain et un changement de champ enregistré par le système ne se lisent pas
 * au même rythme. Les fondre au même niveau noierait les seconds dans les
 * premiers — ou l'inverse, ce qui est pire.
 */

const BASE = { id: 1, at: '2026-03-01T09:30:00.000Z', author: { id: 2, name: 'Sophie Bernard' } };

const SUIVI: TimelineEntry = {
  ...BASE,
  kind: 'followup',
  content: 'Diagnostic en cours.',
  isPrivate: false,
  source: 'interface',
};

describe('Timeline', () => {
  it('annonce le vide plutôt que de ne rien montrer', () => {
    rendre(<Timeline entrees={[]} locale="fr" />);

    // Une chronologie vide sans phrase se lit comme un chargement bloque.
    expect(screen.getByText('Rien à afficher pour le moment.')).toBeInTheDocument();
  });

  it('reste muette tant que les entrées ne sont pas chargées', () => {
    const { container } = rendre(<Timeline entrees={undefined} locale="fr" />);

    // `undefined` n'est pas « vide » : afficher « aucune entree » pendant le
    // chargement ferait croire a un ticket sans historique.
    expect(container.querySelector('li')).toBeNull();
    expect(screen.queryByText('Rien à afficher pour le moment.')).not.toBeInTheDocument();
  });

  it('rend un suivi avec son auteur et son horodatage', () => {
    rendre(<Timeline entrees={[SUIVI]} locale="fr" />);

    expect(screen.getByText('Diagnostic en cours.')).toBeInTheDocument();
    expect(screen.getByText(/Sophie Bernard/)).toBeInTheDocument();
    expect(screen.getByText(/01\/03\/2026/)).toBeInTheDocument();
  });

  it('formate la date selon la langue demandée', () => {
    rendre(<Timeline entrees={[SUIVI]} locale="en" />);

    // Le format vient de la langue, pas du serveur : « 03/01 » et « 01/03 »
    // designent deux jours differents, et se confondent onze mois sur douze.
    expect(screen.getByText(/3\/1\/26/)).toBeInTheDocument();
  });

  it('signale un suivi privé', () => {
    rendre(<Timeline entrees={[{ ...SUIVI, isPrivate: true }]} locale="fr" />);

    // Un suivi prive n'est pas visible du demandeur : l'ecrire sans le savoir
    // est une erreur qu'on ne decouvre qu'en relisant le ticket a sa place.
    expect(screen.getByText(/priv/i)).toBeInTheDocument();
  });

  it('rend une tâche, une solution et une validation', () => {
    const entrees: TimelineEntry[] = [
      {
        ...BASE,
        id: 2,
        kind: 'task',
        content: 'Remplacer le disque',
        state: 'todo',
        isPrivate: false,
        actionTime: 30,
        beginAt: null,
        endAt: null,
        technician: null,
        group: null,
        category: null,
      },
      {
        ...BASE,
        id: 3,
        kind: 'solution',
        content: 'Disque remplace.',
        status: 'accepted',
        solutionType: null,
        approvalComment: null,
      },
      {
        ...BASE,
        id: 4,
        kind: 'validation',
        status: 'granted',
        validator: { id: 5, name: 'Thomas Petit' },
        requestComment: null,
        responseComment: 'Accord donne.',
      },
    ];

    rendre(<Timeline entrees={entrees} locale="fr" />);

    expect(screen.getByText('Remplacer le disque')).toBeInTheDocument();
    expect(screen.getByText('Disque remplace.')).toBeInTheDocument();
    expect(screen.getByText(/Accord donne\./)).toBeInTheDocument();
  });

  it('rend un changement de champ en retrait de la conversation', () => {
    const journal: TimelineEntry = {
      ...BASE,
      id: 9,
      kind: 'log',
      field: 'status',
      oldValue: 'new',
      newValue: 'assigned',
    };

    const { container } = rendre(<Timeline entrees={[journal]} locale="fr" />);

    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();

    // L'historique documente, il ne se lit pas au meme rythme qu'un suivi :
    // il n'a donc pas de carte, seulement une ligne grise.
    expect(container.querySelector('li')?.querySelector('.rounded-card')).toBeNull();
  });

  it('rend une création, qui n’a pas d’ancienne valeur', () => {
    const journal: TimelineEntry = {
      ...BASE,
      id: 10,
      kind: 'log',
      field: 'creation',
      oldValue: null,
      newValue: 'ticket',
    };

    rendre(<Timeline entrees={[journal]} locale="fr" />);

    expect(screen.getByText('ticket')).toBeInTheDocument();
  });

  it('supporte un changement sans auteur ni valeurs', () => {
    const journal: TimelineEntry = {
      ...BASE,
      id: 11,
      author: null,
      kind: 'log',
      field: 'purge',
      oldValue: null,
      newValue: null,
    };

    rendre(<Timeline entrees={[journal]} locale="fr" />);

    // Une tache automatique n'a pas d'auteur : afficher « null » a sa place
    // serait pire que de ne rien afficher.
    expect(screen.getByText('purge')).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });

  it('accroche toutes les entrées au même filet', () => {
    const { container } = rendre(
      <Timeline entrees={[SUIVI, { ...SUIVI, id: 2, content: 'Suite.' }]} locale="fr" />,
    );

    // L'ordre se lit alors sans compter les cartes.
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('ul')?.className).toContain('before:');
  });
});
