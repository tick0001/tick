import { describe, expect, it } from 'vitest';
import { RIGHT_CATALOGUE } from '../admin/right-catalogue.js';
import { LONGUEUR_MINIMALE, droitsAdministrateur, lireOptions } from './initialisation.js';

/**
 * L'initialisation d'une installation neuve.
 *
 * C'est la première commande que lance quiconque installe Tick&, et la seule
 * qui décide de qui pourra entrer. Ses trois règles échouent en silence si
 * elles cassent : un mot de passe trop court accepté sur une machine exposée,
 * une variable d'environnement ignorée au profit d'une valeur par défaut, un
 * droit ajouté au cœur qui n'arrive jamais à l'administrateur — et l'écran
 * refuse alors celui qui est censé tout pouvoir, sans dire pourquoi.
 */

const SANS_ENVIRONNEMENT: Record<string, string | undefined> = {};
const CORRECT = 'un-mot-de-passe-assez-long';

describe('lecture des options', () => {
  it('refuse un mot de passe absent', () => {
    expect(() => lireOptions([], SANS_ENVIRONNEMENT)).toThrow(/trop court/i);
  });

  it(`refuse un mot de passe de moins de ${String(LONGUEUR_MINIMALE)} caractères`, () => {
    const court = 'a'.repeat(LONGUEUR_MINIMALE - 1);

    expect(() => lireOptions([`--mot-de-passe=${court}`], SANS_ENVIRONNEMENT)).toThrow(
      /trop court/i,
    );
  });

  it('accepte exactement la longueur minimale', () => {
    // La borne, et pas seulement ce qui l'entoure : une comparaison ecrite avec
    // le mauvais operateur ne se voit qu'ici.
    const pile = 'a'.repeat(LONGUEUR_MINIMALE);

    expect(lireOptions([`--mot-de-passe=${pile}`], SANS_ENVIRONNEMENT).motDePasse).toBe(pile);
  });

  it("lit le mot de passe depuis l'environnement", () => {
    // C'est la voie recommandee : un argument de ligne de commande se lit dans
    // `ps`, et livrerait le compte d'administration a qui a un terminal.
    const options = lireOptions([], { TICK_ADMIN_PASSWORD: CORRECT });

    expect(options.motDePasse).toBe(CORRECT);
  });

  it("l'argument l'emporte sur l'environnement", () => {
    const options = lireOptions([`--mot-de-passe=${CORRECT}`], {
      TICK_ADMIN_PASSWORD: 'celui-de-l-environnement',
    });

    expect(options.motDePasse).toBe(CORRECT);
  });

  it('retombe sur des valeurs par defaut utilisables', () => {
    const options = lireOptions([], { TICK_ADMIN_PASSWORD: CORRECT });

    expect(options.identifiant).toBe('admin');
    expect(options.entite).toBe('Racine');
    // Le courriel reste facultatif : une installation n'a pas toujours d'adresse
    // a donner, et en inventer une ferait partir des notifications dans le vide.
    expect(options.courriel).toBeNull();
  });

  it('accepte identifiant, courriel et entite', () => {
    const options = lireOptions(
      [
        '--identifiant=responsable',
        '--courriel=responsable@exemple.fr',
        '--entite=Ville de Quelquepart',
        `--mot-de-passe=${CORRECT}`,
      ],
      SANS_ENVIRONNEMENT,
    );

    expect(options).toEqual({
      identifiant: 'responsable',
      courriel: 'responsable@exemple.fr',
      entite: 'Ville de Quelquepart',
      motDePasse: CORRECT,
    });
  });
});

describe("droits du profil d'administration", () => {
  it('couvre tout le catalogue, sans exception', () => {
    const droits = droitsAdministrateur();
    const attendus = RIGHT_CATALOGUE.reduce((total, entree) => total + entree.actions.length, 0);

    // Derives et non recopies : un droit ajoute au cœur doit revenir a
    // l'administrateur sans que personne y pense. Ce test tient cette promesse
    // — il rougira le jour ou la derivation sera remplacee par une liste.
    expect(droits).toHaveLength(attendus);

    for (const entree of RIGHT_CATALOGUE) {
      for (const action of entree.actions) {
        expect(
          droits.some((droit) => droit.object === entree.object && droit.action === action),
          `Le droit ${entree.object}:${action} manque a l'administrateur.`,
        ).toBe(true);
      }
    }
  });

  it('prend la portee la plus large que chaque objet accepte', () => {
    for (const droit of droitsAdministrateur()) {
      const entree = RIGHT_CATALOGUE.find((e) => e.object === droit.object);

      expect(entree).toBeDefined();
      // « all » quand l'objet l'admet, sinon la plus large qu'il declare : un
      // administrateur restreint a sa propre entite ne pourrait pas configurer
      // l'arbre qu'il vient de creer.
      expect(droit.scope).toBe(
        entree?.scopes.includes('all') ? 'all' : (entree?.scopes.at(-1) ?? 'entity'),
      );
    }
  });
});
