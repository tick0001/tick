import { describe, expect, it } from 'vitest';
import { sondable, tableauIdentifiants } from './sonde-textuelle.service.js';

describe('Sonde textuelle', () => {
  describe('sondable', () => {
    it('accepte un motif dont un mot atteint trois caracteres', () => {
      expect(sondable('%imprimante%')).toBe(true);
      expect(sondable('%abc%')).toBe(true);
      expect(sondable('Réseau%')).toBe(true);
      expect(sondable('%499123%')).toBe(true);
    });

    it('refuse un motif sans trigramme exploitable', () => {
      // `pg_trgm` decoupe en mots : ni « ab », ni « #1 », ni deux mots de deux
      // lettres ne lui donnent un trigramme. L'index serait lu en entier.
      expect(sondable('%ab%')).toBe(false);
      expect(sondable('%#12%')).toBe(false);
      expect(sondable('%ab cd%')).toBe(false);
      expect(sondable('%%')).toBe(false);
    });
  });

  describe('tableauIdentifiants', () => {
    it('produit un litteral de tableau PostgreSQL', () => {
      expect(tableauIdentifiants([3, 17, 120])).toBe('{3,17,120}');
      expect(tableauIdentifiants([])).toBe('{}');
    });

    it('ne laisse passer que des entiers', () => {
      expect(tableauIdentifiants([3.7])).toBe('{3}');
    });
  });
});
