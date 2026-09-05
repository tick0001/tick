import { describe, expect, it } from 'vitest';
import { escapeFilterValue } from './ldap.service.js';

/**
 * Il n'existe pas de requete parametree en LDAP : un filtre est une chaine
 * assemblee a la main. L'echappement est donc la seule barriere entre un
 * identifiant saisi par un inconnu et une requete d'annuaire arbitraire.
 */
describe('escapeFilterValue', () => {
  it('laisse un identifiant ordinaire intact', () => {
    expect(escapeFilterValue('thomas.petit')).toBe('thomas.petit');
  });

  it('neutralise une tentative de detournement du filtre', () => {
    // Sans echappement, `(&(objectClass=person)(uid=*)(uid=*))` selectionnerait
    // tous les comptes de l'annuaire au lieu d'un seul.
    expect(escapeFilterValue('*)(uid=*')).toBe('\\2a\\29\\28uid=\\2a');
  });

  it('echappe la contre-oblique en premier', () => {
    // Traiter la contre-oblique apres les autres caracteres reintroduirait une
    // sequence valide a partir de ce que l'on vient d'ecrire.
    expect(escapeFilterValue('a\\b')).toBe('a\\5cb');
  });

  it('echappe chaque caractere reserve de la RFC 4515', () => {
    expect(escapeFilterValue('(')).toBe('\\28');
    expect(escapeFilterValue(')')).toBe('\\29');
    expect(escapeFilterValue('*')).toBe('\\2a');
    expect(escapeFilterValue('\0')).toBe('\\00');
  });
});
