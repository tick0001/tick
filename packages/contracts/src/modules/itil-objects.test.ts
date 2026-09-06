import { describe, expect, it } from 'vitest';
import { updateItilObjectSchema, upsertItilObjectSchema } from './itil-objects.js';

/**
 * Le piège que `updateItilObjectSchema` existe pour éviter.
 *
 * `.partial()` rend les clés facultatives mais **ne neutralise pas** les
 * valeurs par défaut. Un schéma de modification dérivé du schéma de création
 * réintroduit donc ces défauts sur chaque clé absente : une requête qui ne veut
 * changer que le statut repart avec `content: ''`, et efface la description.
 *
 * Le défaut ne se voit ni au typage ni à l'exécution — seulement sur la donnée,
 * plus tard. D'où ces cas nommés un par un.
 */
describe('updateItilObjectSchema', () => {
  it('ne rend rien pour une modification vide', () => {
    expect(updateItilObjectSchema.parse({})).toEqual({});
  });

  it('ne réintroduit aucune valeur par défaut', () => {
    const partiel = updateItilObjectSchema.parse({ status: 'assigned' });

    expect(partiel).toEqual({ status: 'assigned' });
    expect(partiel.content).toBeUndefined();
    expect(partiel.urgency).toBeUndefined();
    expect(partiel.impact).toBeUndefined();
  });

  it('démontre pourquoi `.partial()` ne suffit pas', () => {
    // Le comportement est celui de Zod, pas un defaut du contrat : c'est
    // justement ce qui le rend facile a reintroduire.
    const derive = upsertItilObjectSchema.partial().parse({ status: 'assigned' });

    expect(derive).toMatchObject({ content: '', urgency: 3, impact: 3 });
  });

  it('conserve les contraintes de chaque champ', () => {
    expect(updateItilObjectSchema.safeParse({ name: '' }).success).toBe(false);
    expect(updateItilObjectSchema.safeParse({ urgency: 9 }).success).toBe(false);
    expect(updateItilObjectSchema.safeParse({ status: 'inconnu' }).success).toBe(false);
  });

  it('distingue « detacher » de « ne pas toucher »', () => {
    expect(updateItilObjectSchema.parse({ categoryId: null }).categoryId).toBeNull();
    expect(updateItilObjectSchema.parse({}).categoryId).toBeUndefined();
  });
});

describe('upsertItilObjectSchema', () => {
  it('exige un titre et pose le reste', () => {
    expect(upsertItilObjectSchema.parse({ name: 'Panne' })).toMatchObject({
      name: 'Panne',
      content: '',
      urgency: 3,
      impact: 3,
      checklist: [],
    });
  });

  it('refuse un titre vide', () => {
    expect(upsertItilObjectSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
