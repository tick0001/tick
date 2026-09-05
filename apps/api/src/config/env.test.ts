import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const minimal = {
  DATABASE_URL: 'postgres://tick:tick@localhost:5432/tick',
  DATABASE_APP_URL: 'postgres://tick_app:tick_app@localhost:5432/tick',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'un-secret-assez-long',
};

describe('loadEnv', () => {
  it('applique les valeurs par defaut sur une configuration minimale', () => {
    const env = loadEnv(minimal);

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.DEFAULT_LOCALE).toBe('fr');
  });

  it('convertit le port en nombre', () => {
    expect(loadEnv({ ...minimal, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('refuse de demarrer sans URL de base de donnees', () => {
    const { DATABASE_URL: _omis, ...sansBase } = minimal;

    expect(() => loadEnv(sansBase)).toThrowError(/DATABASE_URL/);
  });

  it('refuse un secret de session trop court', () => {
    expect(() => loadEnv({ ...minimal, SESSION_SECRET: 'court' })).toThrowError(/SESSION_SECRET/);
  });

  it('refuse une langue non prise en charge', () => {
    expect(() => loadEnv({ ...minimal, DEFAULT_LOCALE: 'de' })).toThrowError(/DEFAULT_LOCALE/);
  });
});
