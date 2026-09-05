import { beforeEach, describe, expect, it } from 'vitest';
import { RuleEngineService, type EngineRule } from './rule-engine.service.js';

function regle(partial: Partial<EngineRule> & Pick<EngineRule, 'id' | 'name'>): EngineRule {
  return {
    matchAll: true,
    stopAfter: false,
    criteria: [],
    actions: [],
    ...partial,
  };
}

describe('moteur de règles', () => {
  let moteur: RuleEngineService;

  beforeEach(() => {
    moteur = new RuleEngineService();
  });

  describe('opérateurs', () => {
    const cas: [string, string, string | null, string, boolean][] = [
      ['is', 'incident', 'INCIDENT', 'name', true],
      ['is', 'incident', 'demande', 'name', false],
      ['is_not', 'incident', 'demande', 'name', true],
      ['contains', 'panne', 'Grosse panne réseau', 'name', true],
      ['not_contains', 'panne', 'Tout va bien', 'name', true],
      ['starts_with', '[urgent]', '[URGENT] serveur down', 'name', true],
      ['ends_with', 'down', 'serveur down', 'name', true],
      ['is_empty', '', null, 'name', true],
      ['is_empty', '', '   ', 'name', true],
      ['is_not_empty', '', 'quelque chose', 'name', true],
      ['under', 'e1.e3', 'e1.e3.e7', 'entityPath', true],
      ['under', 'e1.e3', 'e1.e3', 'entityPath', true],
      // Le piège classique : `e1.e30` ne doit pas être vu comme sous `e1.e3`.
      ['under', 'e1.e3', 'e1.e30', 'entityPath', false],
      ['not_under', 'e1.e3', 'e1.e4', 'entityPath', true],
    ];

    it.each(cas)('%s « %s » sur « %s »', (operator, value, actual, field, attendu) => {
      const { traces } = moteur.run(
        [
          regle({
            id: 1,
            name: 'test',
            criteria: [{ field, operator: operator as never, value }],
          }),
        ],
        { [field]: actual },
      );

      expect(traces[0]?.matched).toBe(attendu);
    });
  });

  it('exige toutes les conditions ou une seule selon le mode', () => {
    const criteres = [
      { field: 'name', operator: 'contains' as const, value: 'panne' },
      { field: 'urgency', operator: 'is' as const, value: '5' },
    ];
    const entree = { name: 'panne réseau', urgency: 3 };

    expect(
      moteur.run([regle({ id: 1, name: 'et', matchAll: true, criteria: criteres })], entree)
        .traces[0]?.matched,
    ).toBe(false);
    expect(
      moteur.run([regle({ id: 1, name: 'ou', matchAll: false, criteria: criteres })], entree)
        .traces[0]?.matched,
    ).toBe(true);
  });

  it('applique une règle sans critère, qui sert de valeur par défaut', () => {
    const { output } = moteur.run(
      [
        regle({
          id: 1,
          name: 'défaut',
          actions: [{ field: 'urgency', action: 'assign', value: '3' }],
        }),
      ],
      {},
    );

    expect(output['urgency']).toBe('3');
  });

  it('enchaîne les règles : la seconde voit ce que la première a décidé', () => {
    const { output } = moteur.run(
      [
        regle({
          id: 1,
          name: 'catégorise',
          criteria: [{ field: 'name', operator: 'contains', value: 'imprimante' }],
          actions: [{ field: 'categoryId', action: 'assign', value: '12' }],
        }),
        regle({
          id: 2,
          name: 'affecte',
          criteria: [{ field: 'categoryId', operator: 'is', value: '12' }],
          actions: [{ field: 'assignedGroupId', action: 'assign', value: '4' }],
        }),
      ],
      { name: 'imprimante bloquée', categoryId: null },
    );

    expect(output).toEqual({ categoryId: '12', assignedGroupId: '4' });
  });

  it('isole les règles quand le chaînage est coupé', () => {
    const { traces } = moteur.run(
      [
        regle({
          id: 1,
          name: 'première',
          actions: [{ field: 'profileId', action: 'assign', value: '2' }],
        }),
        regle({
          id: 2,
          name: 'seconde',
          criteria: [{ field: 'profileId', operator: 'is_empty', value: null }],
          actions: [{ field: 'profileId', action: 'assign', value: '3' }],
        }),
      ],
      {},
      { chain: false },
    );

    // Sans isolation, la seconde règle verrait le profil 2 et ne s'appliquerait
    // pas : c'est exactement le cas des habilitations d'annuaire.
    expect(traces[1]?.matched).toBe(true);
    expect(traces[1]?.applied).toEqual([{ field: 'profileId', value: '3' }]);
  });

  it('arrête l’évaluation après une règle terminale', () => {
    const { output, traces } = moteur.run(
      [
        regle({
          id: 1,
          name: 'terminale',
          stopAfter: true,
          actions: [{ field: 'urgency', action: 'assign', value: '5' }],
        }),
        regle({
          id: 2,
          name: 'jamais atteinte',
          actions: [{ field: 'urgency', action: 'assign', value: '1' }],
        }),
      ],
      {},
    );

    expect(output['urgency']).toBe('5');
    expect(traces).toHaveLength(1);
    expect(traces[0]?.stopped).toBe(true);
  });

  it('n’arrête rien quand la règle terminale ne correspond pas', () => {
    const { traces } = moteur.run(
      [
        regle({
          id: 1,
          name: 'terminale',
          stopAfter: true,
          criteria: [{ field: 'name', operator: 'is', value: 'autre chose' }],
        }),
        regle({ id: 2, name: 'suivante' }),
      ],
      { name: 'panne' },
    );

    expect(traces).toHaveLength(2);
  });

  describe('actions', () => {
    it('ajoute à la suite sans écraser', () => {
      const { output } = moteur.run(
        [
          regle({
            id: 1,
            name: 'suffixe',
            actions: [{ field: 'name', action: 'append', value: '[relance]' }],
          }),
        ],
        { name: 'Panne réseau' },
      );

      expect(output['name']).toBe('Panne réseau [relance]');
    });

    it('vide un champ', () => {
      const { output } = moteur.run(
        [
          regle({
            id: 1,
            name: 'purge',
            actions: [{ field: 'assignedGroupId', action: 'clear', value: null }],
          }),
        ],
        { assignedGroupId: 7 },
      );

      expect(output['assignedGroupId']).toBeNull();
    });

    it('réutilise les captures de l’expression régulière du même champ', () => {
      const { output } = moteur.run(
        [
          regle({
            id: 1,
            name: 'extrait le code',
            criteria: [{ field: 'name', operator: 'regex', value: '^\\[(INC\\d+)\\]\\s*(.+)$' }],
            actions: [{ field: 'name', action: 'regex_result', value: '#2 (réf. #1)' }],
          }),
        ],
        { name: '[INC4212] Serveur injoignable' },
      );

      expect(output['name']).toBe('Serveur injoignable (réf. INC4212)');
    });

    it('rend une valeur nulle quand aucune capture ne correspond', () => {
      const { output } = moteur.run(
        [
          regle({
            id: 1,
            name: 'sans regex préalable',
            actions: [{ field: 'name', action: 'regex_result', value: '#1' }],
          }),
        ],
        { name: 'peu importe' },
      );

      expect(output['name']).toBeNull();
    });
  });

  describe('robustesse', () => {
    it('ignore une expression régulière invalide plutôt que d’échouer', () => {
      const { traces } = moteur.run(
        [
          regle({
            id: 1,
            name: 'motif cassé',
            criteria: [{ field: 'name', operator: 'regex', value: '([a-z' }],
          }),
        ],
        { name: 'quoi que ce soit' },
      );

      expect(traces[0]?.matched).toBe(false);
    });

    it('ignore une expression régulière démesurée', () => {
      const { traces } = moteur.run(
        [
          regle({
            id: 1,
            name: 'motif trop long',
            criteria: [{ field: 'name', operator: 'regex', value: `${'a?'.repeat(120)}` }],
          }),
        ],
        { name: 'a'.repeat(30) },
      );

      expect(traces[0]?.matched).toBe(false);
    });

    it('compare une liste de groupes aplatie', () => {
      const { traces } = moteur.run(
        [
          regle({
            id: 1,
            name: 'appartenance',
            criteria: [{ field: 'groups', operator: 'contains', value: 'cn=support' }],
          }),
        ],
        { groups: ['cn=direction,dc=tick,dc=lan', 'cn=support,dc=tick,dc=lan'] },
      );

      expect(traces[0]?.matched).toBe(true);
      expect(traces[0]?.criteria[0]?.actual).toBe(
        'cn=direction,dc=tick,dc=lan|cn=support,dc=tick,dc=lan',
      );
    });
  });

  it('trace chaque critère, appliqué ou non', () => {
    const { traces } = moteur.run(
      [
        regle({
          id: 9,
          name: 'diagnostic',
          criteria: [
            { field: 'name', operator: 'contains', value: 'panne' },
            { field: 'urgency', operator: 'is', value: '5' },
          ],
        }),
      ],
      { name: 'panne réseau', urgency: 2 },
    );

    expect(traces[0]).toMatchObject({
      ruleId: 9,
      matched: false,
      criteria: [
        { field: 'name', matched: true, actual: 'panne réseau' },
        { field: 'urgency', matched: false, actual: '2' },
      ],
      applied: [],
    });
  });
});
