import type { SessionContext } from '@tick/contracts';
import { describe, expect, it } from 'vitest';
import { droitDe, premierReglageAccessible, REGLAGES } from './navigation';

/**
 * Où mène la zone de configuration.
 *
 * `/settings` n'est pas un écran mais une porte. La franchir doit mener quelque
 * part : viser un écran fixe conduirait un profil qui n'y a pas droit sur un
 * refus, alors même que la zone lui est ouverte pour d'autres écrans.
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

describe('REGLAGES', () => {
  it('couvre chaque écran de configuration une seule fois', () => {
    const chemins = REGLAGES.map((entree) => entree.to);

    expect(new Set(chemins).size).toBe(chemins.length);
    expect(chemins.length).toBeGreaterThan(10);
  });

  it('donne le droit d’un écran par son chemin', () => {
    expect(droitDe('/settings/rules')).toEqual({ objet: 'rule', action: 'read' });
    expect(droitDe('/settings/inexistant')).toBeUndefined();
  });
});

describe('premierReglageAccessible', () => {
  it('rend le premier écran permis, dans l’ordre du menu', () => {
    // L'ordre compte : on arrive sur le premier ecran du menu, pas sur un
    // ecran choisi au hasard parmi ceux qui sont ouverts.
    expect(premierReglageAccessible(session({ 'rule:read': 'all', 'user:read': 'all' }))).toBe(
      '/settings/rules',
    );
  });

  it('saute les écrans refusés', () => {
    expect(premierReglageAccessible(session({ 'group:read': 'entity' }))).toBe('/settings/groups');
  });

  it('ne rend rien quand aucun écran n’est ouvert', () => {
    // L'appelant retombe alors sur l'accueil : mieux vaut la page d'arrivee
    // qu'un refus sur un ecran qu'on n'a pas demande.
    expect(premierReglageAccessible(session({ 'ticket:read': 'own' }))).toBeUndefined();
  });
});
