import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { exigerUtf8 } from './corps-utf8.js';

const requete = {} as IncomingMessage;
const reponse = {} as ServerResponse;

describe('exigerUtf8', () => {
  const latin1 = Buffer.from([0x32, 0x65, 0x20, 0xe9, 0x74, 0x61, 0x67, 0x65]);

  it.each(['utf-8', 'UTF-8', 'utf8'])('refuse des octets invalides annonces en %s', (encodage) => {
    expect(() => {
      exigerUtf8(requete, reponse, latin1, encodage);
    }).toThrow(BadRequestException);
  });

  it('laisse passer l UTF-8 valide, accents et emoji compris', () => {
    expect(() => {
      exigerUtf8(requete, reponse, Buffer.from('2e étage — 🖨️', 'utf8'), 'utf-8');
    }).not.toThrow();
  });

  it('laisse a l analyseur un corps annonce dans un autre jeu de caracteres', () => {
    expect(() => {
      exigerUtf8(requete, reponse, Buffer.from('é', 'utf16le'), 'utf-16le');
    }).not.toThrow();
  });
});
