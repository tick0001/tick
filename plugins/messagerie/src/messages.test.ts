import { describe, expect, it } from 'vitest';
import { corps, lienTicket, neutraliser, phrase, type Annonce } from './messages.js';

const CREATION: Annonce = {
  genre: 'creation',
  ticketId: 42,
  titre: 'Imprimante bloquée',
  priorite: 4,
  type: 'incident',
};

describe('phrase', () => {
  it('annonce un nouveau ticket selon son type, dans chaque langue', () => {
    expect(phrase(CREATION, 'fr')).toBe('Nouvel incident #42 — Imprimante bloquée (priorité 4)');
    expect(phrase({ ...CREATION, type: 'request' }, 'fr')).toBe(
      'Nouvelle demande #42 — Imprimante bloquée (priorité 4)',
    );
    expect(phrase(CREATION, 'en')).toBe('New incident #42 — Imprimante bloquée (priority 4)');
  });

  it('annonce une escalade et une resolution', () => {
    expect(
      phrase({ genre: 'escalade', ticketId: 7, niveau: 'N2', engagement: 'Standard' }, 'fr'),
    ).toBe('Escalade sur le ticket #7 : niveau « N2 » de l’engagement « Standard »');
    expect(phrase({ genre: 'resolution', ticketId: 7 }, 'en')).toBe('Ticket #7 solved');
  });
});

describe('neutraliser', () => {
  it.each([
    ['une mention Slack', '<!channel> urgent', '&lt;!channel&gt; urgent'],
    ['une mention Mattermost ou Discord', '@here serveur tombé', '@​here serveur tombé'],
    ['un lien Markdown', '[ici](http://piege.exemple)', '[ici]​(http://piege.exemple)'],
    ['une esperluette', 'R&D', 'R&amp;D'],
  ])('desamorce %s', (_cas, entree, attendu) => {
    expect(neutraliser(entree)).toBe(attendu);
  });

  it('s applique au titre avant qu il ne parte', () => {
    const texte = phrase({ ...CREATION, titre: '<!everyone> @channel' }, 'fr');

    expect(texte).not.toContain('<!everyone>');
    expect(texte).not.toMatch(/@channel/);
  });
});

describe('lienTicket', () => {
  it('compose le lien, avec ou sans barre finale', () => {
    expect(lienTicket('https://support.exemple.fr', 42)).toBe(
      'https://support.exemple.fr/tickets/42',
    );
    expect(lienTicket('https://support.exemple.fr/', 42)).toBe(
      'https://support.exemple.fr/tickets/42',
    );
  });
});

describe('corps', () => {
  const options = { langue: 'fr', webUrl: 'https://support.exemple.fr' } as const;

  it('ecrit un webhook au format Slack, lien en clair sur sa ligne', () => {
    expect(JSON.parse(corps(CREATION, { ...options, format: 'slack' }))).toEqual({
      text:
        'Nouvel incident #42 — Imprimante bloquée (priorité 4)\n' +
        'https://support.exemple.fr/tickets/42',
    });
  });

  it('ecrit une carte adaptative pour Teams', () => {
    const carte = JSON.parse(corps(CREATION, { ...options, format: 'teams' })) as {
      type: string;
      attachments: {
        contentType: string;
        content: {
          type: string;
          body: { text: string }[];
          actions: { type: string; title: string; url: string }[];
        };
      }[];
    };
    const piece = carte.attachments[0];

    expect(carte.type).toBe('message');
    expect(piece?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(piece?.content.type).toBe('AdaptiveCard');
    expect(piece?.content.body[0]?.text).toBe(
      'Nouvel incident #42 — Imprimante bloquée (priorité 4)',
    );
    expect(piece?.content.actions[0]).toEqual({
      type: 'Action.OpenUrl',
      title: 'Ouvrir le ticket',
      url: 'https://support.exemple.fr/tickets/42',
    });
  });
});
