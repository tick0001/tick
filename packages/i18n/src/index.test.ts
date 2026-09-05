import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, en, fr, isLocale, negotiateLocale, resources } from './index.js';

function keys(objet: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(objet).flatMap(([cle, valeur]) =>
    typeof valeur === 'object' && valeur !== null
      ? keys(valeur as Record<string, unknown>, `${prefix}${cle}.`)
      : [`${prefix}${cle}`],
  );
}

describe('ressources de traduction', () => {
  it('couvre exactement les memes cles dans toutes les langues', () => {
    // Le typage l'impose deja a la compilation ; ce test protege le jour ou une
    // langue serait chargee depuis un fichier et non depuis le code.
    const source = keys(fr).sort();

    for (const [langue, traductions] of Object.entries(resources)) {
      expect(keys(traductions).sort(), `langue ${langue}`).toEqual(source);
    }
  });

  it('ne laisse aucune traduction vide', () => {
    const vides = Object.entries(resources).flatMap(([langue, traductions]) =>
      keys(traductions)
        .filter((cle) => {
          const valeur = cle
            .split('.')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], traductions);

          return typeof valeur !== 'string' || valeur.trim().length === 0;
        })
        .map((cle) => `${langue}:${cle}`),
    );

    expect(vides).toEqual([]);
  });
});

describe('negotiateLocale', () => {
  it('retient la preference explicite avant tout', () => {
    expect(negotiateLocale('en', 'fr-FR,fr;q=0.9')).toBe('en');
  });

  it('ramene une etiquette regionale a sa langue de base', () => {
    expect(negotiateLocale('fr-CA')).toBe('fr');
    expect(negotiateLocale('en-GB')).toBe('en');
  });

  it('parcourt un en-tete Accept-Language complet', () => {
    expect(negotiateLocale(null, 'de-DE,de;q=0.9,en;q=0.8')).toBe('en');
  });

  it('retombe sur la langue par defaut sans candidat exploitable', () => {
    expect(negotiateLocale(undefined, '', 'de,es')).toBe(DEFAULT_LOCALE);
  });
});

describe('isLocale', () => {
  it('reconnait les langues livrees', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('expose une traduction anglaise distincte du francais', () => {
    expect(en.connexion.valider).not.toBe(fr.connexion.valider);
  });
});
