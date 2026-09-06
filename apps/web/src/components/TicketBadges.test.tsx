import type { ItilStatus, TicketType } from '@tick/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { rendre } from '@/test/rendu';
import { PriorityBadge, StatusBadge, TypeBadge } from './TicketBadges';

/**
 * Les étiquettes d'une ligne de liste.
 *
 * Ce sont les trois signaux qu'on lit en balayant quarante lignes : où en est
 * le ticket, à quel point il presse, et de quelle nature il est. Ils doivent
 * rester lisibles **sans la couleur** — un daltonien, une impression en noir et
 * blanc, un écran mal réglé — d'où la vérification que chacun porte son
 * libellé en texte, et pas seulement une teinte.
 */

const STATUTS: ItilStatus[] = ['new', 'assigned', 'planned', 'waiting', 'solved', 'closed'];

describe('StatusBadge', () => {
  it.each(STATUTS)('rend le statut %s avec son libellé traduit', (statut) => {
    rendre(<StatusBadge status={statut} />);

    // Le libelle vient de `@tick/i18n`, partage avec l'API : une cle manquante
    // afficherait la cle elle-meme, ce que ce test attraperait.
    const attendu = i18n.t(`tickets.statuts.${statut}` as 'tickets.statuts.new');

    expect(attendu).not.toContain('tickets.statuts');
    expect(screen.getByText(attendu)).toBeInTheDocument();
  });

  it('affiche un texte, pas seulement une couleur', () => {
    const { container } = rendre(<StatusBadge status="new" />);

    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('cache la pastille aux lecteurs d’écran', () => {
    const { container } = rendre(<StatusBadge status="waiting" />);

    // La pastille double la couleur du fond : l'annoncer ferait entendre un
    // element vide au milieu du libelle.
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('efface les statuts fermés au lieu de les colorer', () => {
    const { container: clos } = rendre(<StatusBadge status="closed" />);

    // Dans une liste de travail, l'oeil doit trouver ce qui reste a faire.
    // Un ticket clos aussi vif qu'un ticket neuf ferait le contraire.
    expect(clos.firstElementChild?.className).toContain('text-faint');
  });
});

describe('PriorityBadge', () => {
  it.each([1, 2, 3, 4, 5])('rend l’échelle complète pour la priorité %i', (valeur) => {
    const { container } = rendre(<PriorityBadge value={valeur} />);

    // Les segments eteints restent visibles : sans eux, on ne saurait pas sur
    // quelle echelle se lit le remplissage.
    expect(container.querySelectorAll('span.flex-1')).toHaveLength(5);
  });

  it('remplit autant de segments que la valeur', () => {
    const { container } = rendre(<PriorityBadge value={3} />);
    const segments = [...container.querySelectorAll('span.flex-1')];
    const remplis = segments.filter((segment) => !segment.className.includes('bg-sunken'));

    expect(remplis).toHaveLength(3);
  });

  it('annonce la priorité en toutes lettres', () => {
    const { container } = rendre(<PriorityBadge value={5} />);

    // La jauge est muette pour un lecteur d'ecran : le libelle en texte cache
    // est le seul moyen d'entendre « critique » plutot que rien.
    expect(container.querySelector('.sr-only')?.textContent?.length).toBeGreaterThan(0);
    expect(container.querySelector('[title]')).not.toBeNull();
  });
});

describe('TypeBadge', () => {
  it.each(['incident', 'request'] as TicketType[])('rend le type %s', (type) => {
    const { container } = rendre(<TypeBadge type={type} />);

    expect(container.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('distingue l’incident sans lui donner une étiquette pleine', () => {
    const { container } = rendre(<TypeBadge type="incident" />);

    // Une pastille coloree de plus sur chaque ligne entrerait en concurrence
    // avec le statut, qui lui doit sauter aux yeux.
    expect(container.firstElementChild?.className).toContain('text-critical');
    expect(container.firstElementChild?.className).not.toContain('bg-');
  });
});
