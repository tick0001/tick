import { describe, expect, it } from 'vitest';
import {
  addFollowupSchema,
  answerValidationSchema,
  createTicketSchema,
  severitySchema,
  ticketFilterSchema,
  timelineEntrySchema,
  updateTicketSchema,
} from './itil.js';

/**
 * Le filtre de tickets vient d'une chaîne de requête.
 *
 * Tout y arrive en texte : les listes, les nombres, les booléens. Les erreurs
 * de conversion y sont silencieuses — un filtre qui ne filtre pas ressemble à
 * un filtre qui ne trouve rien — d'où le détail de ces cas.
 */
describe('ticketFilterSchema', () => {
  it('lit une liste separee par des virgules', () => {
    const filtre = ticketFilterSchema.parse({ status: 'new,assigned' });

    expect(filtre.status).toEqual(['new', 'assigned']);
  });

  it('accepte aussi la liste deja decoupee', () => {
    const filtre = ticketFilterSchema.parse({ status: ['new', 'waiting'] });

    expect(filtre.status).toEqual(['new', 'waiting']);
  });

  it('ignore les segments vides d’une liste mal formee', () => {
    // `?status=new,,assigned,` arrive tel quel : les vides ne sont pas des
    // statuts, et les laisser passer ferait echouer la validation de l'element.
    expect(ticketFilterSchema.parse({ status: 'new,,assigned,' }).status).toEqual([
      'new',
      'assigned',
    ]);
  });

  it('convertit les priorites en nombres', () => {
    expect(ticketFilterSchema.parse({ priority: '4,5' }).priority).toEqual([4, 5]);
  });

  it('refuse un statut inconnu dans la liste', () => {
    expect(ticketFilterSchema.safeParse({ status: 'new,inexistant' }).success).toBe(false);
  });

  it('pose les valeurs par defaut de la pagination', () => {
    const filtre = ticketFilterSchema.parse({});

    expect(filtre).toMatchObject({
      deleted: false,
      limit: 50,
      sort: 'dateOpened',
      direction: 'desc',
    });
  });

  it('borne la taille de page', () => {
    expect(ticketFilterSchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ticketFilterSchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(ticketFilterSchema.parse({ limit: '200' }).limit).toBe(200);
  });

  it('ne confond pas « corbeille desactivee » avec une chaine non vide', () => {
    expect(ticketFilterSchema.parse({ deleted: 'false' }).deleted).toBe(false);
  });
});

describe('severitySchema', () => {
  it('tient l’echelle de 1 a 5', () => {
    expect(severitySchema.parse(1)).toBe(1);
    expect(severitySchema.parse(5)).toBe(5);
    expect(severitySchema.safeParse(0).success).toBe(false);
    expect(severitySchema.safeParse(6).success).toBe(false);
    expect(severitySchema.safeParse(2.5).success).toBe(false);
  });
});

describe('createTicketSchema', () => {
  it('exige un titre et pose le reste', () => {
    const ticket = createTicketSchema.parse({ name: 'Panne' });

    expect(ticket).toMatchObject({
      name: 'Panne',
      content: '',
      type: 'incident',
      urgency: 3,
      impact: 3,
      actors: [],
    });
  });

  it('refuse un titre vide', () => {
    expect(createTicketSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTicketSchema.safeParse({}).success).toBe(false);
  });

  it('accepte des acteurs initiaux', () => {
    const ticket = createTicketSchema.parse({
      name: 'Panne',
      actors: [{ role: 'requester', actorType: 'user', actorId: 3 }],
    });

    expect(ticket.actors).toHaveLength(1);
  });
});

describe('updateTicketSchema', () => {
  it('n’exige rien : une modification partielle est la regle', () => {
    expect(updateTicketSchema.parse({})).toEqual({});
  });

  it('distingue « detacher » de « ne pas toucher »', () => {
    // `null` retire la categorie, l'absence de cle la laisse en place. Confondre
    // les deux ferait effacer une categorie a chaque changement de statut.
    expect(updateTicketSchema.parse({ categoryId: null }).categoryId).toBeNull();
    expect(updateTicketSchema.parse({}).categoryId).toBeUndefined();
  });
});

describe('addFollowupSchema', () => {
  it('pose une source et une visibilite par defaut', () => {
    expect(addFollowupSchema.parse({ content: 'Fait.' })).toEqual({
      content: 'Fait.',
      isPrivate: false,
      source: 'interface',
    });
  });

  it('refuse un suivi vide', () => {
    expect(addFollowupSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('answerValidationSchema', () => {
  it('accepte une reponse sans commentaire', () => {
    expect(answerValidationSchema.parse({ granted: true }).granted).toBe(true);
  });
});

/**
 * L'union discriminée de la chronologie.
 *
 * Chaque nature a ses champs propres : un `task` sans `state` ou un `log` avec
 * un `content` doivent être refusés, sinon l'interface rendrait une entrée dont
 * la moitié des champs manquent.
 */
describe('timelineEntrySchema', () => {
  const base = { id: 1, at: '2026-01-01T00:00:00.000Z', author: null };

  it('accepte un suivi complet', () => {
    const entree = timelineEntrySchema.parse({
      ...base,
      kind: 'followup',
      content: 'Texte',
      isPrivate: false,
      source: 'interface',
    });

    expect(entree.kind).toBe('followup');
  });

  it('accepte une tache complete', () => {
    const entree = timelineEntrySchema.parse({
      ...base,
      kind: 'task',
      content: 'Intervenir',
      state: 'todo',
      isPrivate: false,
      actionTime: 30,
      beginAt: null,
      endAt: null,
      technician: null,
      group: null,
      category: null,
    });

    expect(entree.kind).toBe('task');
  });

  it('accepte une entree d’historique', () => {
    const entree = timelineEntrySchema.parse({
      ...base,
      kind: 'log',
      field: 'status',
      oldValue: 'new',
      newValue: 'assigned',
    });

    expect(entree.kind).toBe('log');
  });

  it('refuse une nature inconnue', () => {
    expect(timelineEntrySchema.safeParse({ ...base, kind: 'autre' }).success).toBe(false);
  });

  it('refuse une tache privee de ses champs propres', () => {
    expect(timelineEntrySchema.safeParse({ ...base, kind: 'task', content: 'x' }).success).toBe(
      false,
    );
  });
});
