import { afterEach, describe, expect, it } from 'vitest';
import { InstanceController } from './instance.controller.js';

const originale = process.env['LOGIN_BANNER'];

afterEach(() => {
  if (originale === undefined) delete process.env['LOGIN_BANNER'];
  else process.env['LOGIN_BANNER'] = originale;
});

describe('InstanceController', () => {
  it('ne dit rien quand aucun message n est configure', () => {
    delete process.env['LOGIN_BANNER'];
    expect(new InstanceController().info()).toEqual({ banner: null });
  });

  it('rend le message configure', () => {
    process.env['LOGIN_BANNER'] = 'Support N1 : 01 23 45 67 89';
    expect(new InstanceController().info().banner).toBe('Support N1 : 01 23 45 67 89');
  });

  it('renvoie null plutot qu une chaine vide', () => {
    // `trim()` du schema ramene un message d espaces a la chaine vide ; le
    // client ne doit pas avoir a distinguer « vide » de « absent ».
    process.env['LOGIN_BANNER'] = '   ';
    expect(new InstanceController().info().banner).toBeNull();
  });
});
