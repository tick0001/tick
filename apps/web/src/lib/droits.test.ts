import type { SessionContext } from '@tick/contracts';
import { describe, expect, it } from 'vitest';
import { peut, porteeDe } from './droits';

/**
 * La lecture des droits du profil actif.
 *
 * Elle décide de ce que l'interface **propose**, jamais de ce qui est permis :
 * le serveur reste seul juge, et masquer un bouton ne protège rien. Ce qui se
 * joue ici est la sincérité de l'écran — ne pas offrir une action qui finira en
 * refus, car un menu qui mène à un mur se lit comme une panne, pas comme une
 * absence de droit.
 */

function session(rights: SessionContext['rights']): SessionContext {
  return {
    user: { id: 1, username: 'thomas', displayName: 'Thomas Petit', email: null, locale: 'fr' },
    entity: { id: 1, name: 'DSI', completeName: 'DSI', path: 'e1', level: 0, parentId: null },
    profile: { id: 3, name: 'Technicien', interface: 'standard' },
    includeSubEntities: true,
    rights,
    available: [],
  };
}

describe('peut', () => {
  it('reconnaît un droit détenu', () => {
    expect(peut(session({ 'ticket:read': 'entity' }), 'ticket', 'read')).toBe(true);
  });

  it('refuse en l’absence de ligne', () => {
    // L'absence de ligne vaut refus — c'est la regle du modele, et elle vaut
    // ici comme en base. Un droit « present mais vide » n'existe pas.
    expect(peut(session({}), 'ticket', 'read')).toBe(false);
    expect(peut(session({ 'ticket:read': 'entity' }), 'ticket', 'delete')).toBe(false);
  });

  it('ne confond pas deux actions du même objet', () => {
    const courant = session({ 'ticket:read': 'entity' });

    expect(peut(courant, 'ticket', 'read')).toBe(true);
    expect(peut(courant, 'ticket', 'update')).toBe(false);
    expect(peut(courant, 'ticket', 'create')).toBe(false);
  });

  it('ne confond pas deux objets voisins', () => {
    const courant = session({ 'user:read': 'all' });

    // `user` et `group` sont deux objets distincts du catalogue : un profil qui
    // gere les comptes ne gere pas forcement les groupes.
    expect(peut(courant, 'user', 'read')).toBe(true);
    expect(peut(courant, 'group', 'read')).toBe(false);
  });

  it('ne juge pas sur la portée', () => {
    // La portee dit *quelles lignes* sont concernees, jamais *si* l'ecran
    // s'ouvre : un technicien qui ne voit que ses propres tickets garde une
    // entree « Tickets » qui a du sens.
    for (const portee of ['own', 'group', 'entity', 'recursive', 'all'] as const) {
      expect(peut(session({ 'ticket:read': portee }), 'ticket', 'read'), portee).toBe(true);
    }
  });
});

describe('porteeDe', () => {
  it('rend la portée telle quelle', () => {
    expect(porteeDe(session({ 'ticket:read': 'group' }), { objet: 'ticket', action: 'read' })).toBe(
      'group',
    );
  });

  it('rend `undefined` pour un droit absent', () => {
    expect(porteeDe(session({}), { objet: 'ticket', action: 'read' })).toBeUndefined();
  });
});
