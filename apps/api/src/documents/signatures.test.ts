import { describe, expect, it } from 'vitest';
import { contenuConforme, TYPES_ACCEPTES } from './signatures.js';

const octets = (...valeurs: number[]) => Buffer.from(valeurs);
const texte = (valeur: string) => Buffer.from(valeur, 'utf8');
const ZIP = Buffer.concat([octets(0x50, 0x4b, 0x03, 0x04), Buffer.alloc(26)]);
const SVG = texte('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = texte('<!doctype html><script>alert(1)</script>');

describe('contenuConforme', () => {
  it.each([
    [
      'image/png',
      Buffer.concat([octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(8)]),
    ],
    ['image/jpeg', octets(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)],
    ['image/gif', Buffer.concat([texte('GIF89a'), octets(0x01, 0x00)])],
    ['image/webp', Buffer.concat([texte('RIFF'), octets(0, 0, 0, 0), texte('WEBPVP8 ')])],
    ['application/pdf', texte('%PDF-1.7\n')],
    ['application/zip', ZIP],
    ['application/zip', Buffer.concat([octets(0x50, 0x4b, 0x05, 0x06), Buffer.alloc(18)])],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP],
    ['application/vnd.oasis.opendocument.spreadsheet', ZIP],
    ['text/plain', texte('Journal du serveur\nligne 2 — accentuée\n')],
    ['text/csv', texte('ticket;duree\n42;3\n')],
  ])('accepte un vrai %s', (type, contenu) => {
    expect(contenuConforme(type, contenu)).toBe(true);
  });

  it.each([
    ['un SVG annoncé comme PNG', 'image/png', SVG],
    ['une page HTML annoncée comme JPEG', 'image/jpeg', HTML],
    ['un PNG annoncé comme PDF', 'application/pdf', octets(0x89, 0x50, 0x4e, 0x47)],
    [
      'un RIFF qui n’est pas du WebP',
      'image/webp',
      Buffer.concat([texte('RIFF'), octets(0, 0, 0, 0), texte('AVI ')]),
    ],
    ['un texte annoncé comme archive', 'application/vnd.oasis.opendocument.text', texte('bonjour')],
    ['un binaire annoncé comme texte', 'text/plain', octets(0x4d, 0x5a, 0x90, 0x00, 0x03)],
    ['un fichier vide annoncé comme image', 'image/gif', Buffer.alloc(0)],
  ])('refuse %s', (_cas, type, contenu) => {
    expect(contenuConforme(type, contenu)).toBe(false);
  });

  it('refuse un type qu’il ne sait pas vérifier', () => {
    expect(contenuConforme('image/svg+xml', SVG)).toBe(false);
    expect(TYPES_ACCEPTES.has('image/svg+xml')).toBe(false);
    expect(TYPES_ACCEPTES.has('text/html')).toBe(false);
  });
});
