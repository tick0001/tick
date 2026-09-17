import { describe, expect, it } from 'vitest';
import {
  BLOCAGE_MAXIMAL_MS,
  BLOCAGE_MINIMAL_MS,
  dureeDeBlocage,
  ECHECS_AVANT_BLOCAGE,
  ECHECS_PAR_ADRESSE,
  FENETRE_ADRESSE_MS,
  LimiteConnexionService,
  MagasinEnMemoire,
  OUBLI_COMPTE_MS,
} from './limite-connexion.service.js';

/**
 * La limite des tentatives, sur une horloge qu'on avance à la main.
 *
 * Le stockage Redis est éprouvé par le test HTTP ; ici, ce sont les règles.
 */

function limiteur() {
  let maintenant = 1_000_000;
  const service = LimiteConnexionService.avec(new MagasinEnMemoire(() => maintenant));

  return {
    service,
    avancer: (ms: number) => {
      maintenant += ms;
    },
  };
}

describe('dureeDeBlocage', () => {
  it('ne bloque pas avant le seuil, puis double, puis plafonne', () => {
    expect(dureeDeBlocage(ECHECS_AVANT_BLOCAGE - 1)).toBe(0);
    expect(dureeDeBlocage(ECHECS_AVANT_BLOCAGE)).toBe(BLOCAGE_MINIMAL_MS);
    expect(dureeDeBlocage(ECHECS_AVANT_BLOCAGE + 1)).toBe(2 * BLOCAGE_MINIMAL_MS);
    expect(dureeDeBlocage(ECHECS_AVANT_BLOCAGE + 20)).toBe(BLOCAGE_MAXIMAL_MS);
  });
});

describe('LimiteConnexionService', () => {
  const ADRESSE = '203.0.113.7';

  it('laisse passer les premiers échecs, puis bloque le compte', async () => {
    const { service } = limiteur();

    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) {
      expect(await service.echec('sophie', ADRESSE)).toBe(0);
      expect(await service.attente('sophie', ADRESSE)).toBe(0);
    }

    expect(await service.echec('sophie', ADRESSE)).toBe(BLOCAGE_MINIMAL_MS);
    expect(await service.attente('sophie', ADRESSE)).toBe(BLOCAGE_MINIMAL_MS);
  });

  it('bloque le compte quelle que soit l’adresse, et quelle que soit la casse', async () => {
    const { service } = limiteur();

    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) {
      await service.echec('Sophie', `198.51.100.${String(i)}`);
    }

    expect(await service.attente(' sophie ', '192.0.2.1')).toBeGreaterThan(0);
  });

  it('lève le blocage une fois le délai écoulé', async () => {
    const { service, avancer } = limiteur();

    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) await service.echec('sophie', ADRESSE);

    avancer(BLOCAGE_MINIMAL_MS);

    expect(await service.attente('sophie', ADRESSE)).toBe(0);
  });

  it('allonge le blocage à chaque nouvel échec', async () => {
    const { service, avancer } = limiteur();

    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) await service.echec('sophie', ADRESSE);
    avancer(BLOCAGE_MINIMAL_MS);

    expect(await service.echec('sophie', ADRESSE)).toBe(2 * BLOCAGE_MINIMAL_MS);
  });

  it('oublie les échecs d’un compte laissé tranquille', async () => {
    const { service, avancer } = limiteur();

    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) await service.echec('sophie', ADRESSE);
    avancer(OUBLI_COMPTE_MS);

    expect(await service.echec('sophie', ADRESSE)).toBe(0);
  });

  it('efface l’historique du compte à la connexion réussie', async () => {
    const { service } = limiteur();

    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) await service.echec('sophie', ADRESSE);
    await service.succes('sophie');

    expect(await service.echec('sophie', ADRESSE)).toBe(0);
  });

  it('compte un identifiant qui n’existe pas comme les autres', async () => {
    const { service } = limiteur();

    // Ne compter que les comptes existants dirait lesquels existent.
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) await service.echec('personne', ADRESSE);

    expect(await service.attente('personne', ADRESSE)).toBeGreaterThan(0);
  });

  it('bloque une adresse qui essaie de nombreux comptes', async () => {
    const { service, avancer } = limiteur();

    // Un échec par compte : aucun compte n'atteint son seuil.
    for (let i = 0; i < ECHECS_PAR_ADRESSE; i += 1) {
      await service.echec(`compte-${String(i)}`, ADRESSE);
    }

    expect(await service.attente('encore-un-autre', ADRESSE)).toBeGreaterThan(0);
    expect(await service.attente('encore-un-autre', '192.0.2.1')).toBe(0);

    // La fenêtre part du premier échec : insister ne la prolonge pas.
    avancer(FENETRE_ADRESSE_MS);

    expect(await service.attente('encore-un-autre', ADRESSE)).toBe(0);
  });

  it('ne compte pas d’adresse quand elle est inconnue', async () => {
    const { service } = limiteur();

    for (let i = 0; i < ECHECS_PAR_ADRESSE; i += 1) {
      await service.echec(`compte-${String(i)}`, undefined);
    }

    expect(await service.attente('autre', undefined)).toBe(0);
  });
});

describe('MagasinEnMemoire', () => {
  it('se borne, en oubliant les entrées les plus anciennes', async () => {
    const magasin = new MagasinEnMemoire();

    for (let i = 0; i <= MagasinEnMemoire.LIMITE; i += 1) {
      await magasin.incrementer(`cle-${String(i)}`, 60_000, false);
    }

    expect(await magasin.lire('cle-0')).toBeNull();
    expect(await magasin.lire(`cle-${String(MagasinEnMemoire.LIMITE)}`)).not.toBeNull();
  });
});
