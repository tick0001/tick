import { createDatabase, type Connection } from '@tick/db';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { HealthService } from '../health/health.service.js';

/**
 * La sonde de sante, contre une vraie base.
 *
 * Elle ne sondait que le role proprietaire, alors que tout le trafic passe par
 * le role applicatif. Le defaut n'a pas ete trouve en lisant le code : c'est la
 * verification de montee de version qui l'a montre. Une sauvegarde restauree
 * sans recreer `tick_app` donnait une installation dont les donnees etaient la,
 * dont la sonde repondait « ok », et qui refusait toute connexion.
 */
describe('Sonde de sante', () => {
  const ouvertes: Connection[] = [];

  function ouvrir(connectionString: string): Connection {
    const connexion = createDatabase({ connectionString, max: 1 });
    ouvertes.push(connexion);

    return connexion;
  }

  function adresse(nom: 'DATABASE_URL' | 'DATABASE_APP_URL'): string {
    const valeur = process.env[nom];

    if (!valeur) throw new Error(`${nom} est absent : ce test exige une base reelle.`);

    return valeur;
  }

  function sonde(applicative: Connection): HealthService {
    const proprietaire = ouvrir(adresse('DATABASE_URL'));
    const base = new DatabaseService(applicative.db, proprietaire.db, {
      owner: proprietaire,
      app: applicative,
    });

    return new HealthService(base);
  }

  afterEach(async () => {
    await Promise.all(ouvertes.splice(0).map((connexion) => connexion.close()));
  });

  it('repond quand les deux roles joignent la base', async () => {
    expect(await sonde(ouvrir(adresse('DATABASE_APP_URL'))).base()).toBe(true);
  });

  it('tombe quand le role applicatif ne peut plus se connecter, meme si le proprietaire le peut', async () => {
    // Le cas du guide d'installation : le mot de passe de `tick_app` a change,
    // mais `DATABASE_APP_URL` n'a pas suivi.
    const fausse = new URL(adresse('DATABASE_APP_URL'));
    fausse.password = 'pas-le-bon-mot-de-passe';

    expect(await sonde(ouvrir(fausse.toString())).base()).toBe(false);
  });
});
