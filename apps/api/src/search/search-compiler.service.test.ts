import { BadRequestException } from '@nestjs/common';
import { rendreSql, sql } from '@tick/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { SearchCompiler } from './search-compiler.service.js';
import { SearchRegistry, type SearchableField } from './search-registry.service.js';

/**
 * Le compilateur de critères.
 *
 * C'est la pièce la plus exposée du moteur de recherche : elle transforme un
 * arbre venu du client en fragment de clause `WHERE`. Trois règles la tiennent,
 * et ce fichier existe pour qu'aucune ne se perde à la première retouche.
 *
 *  1. Un critère ne nomme qu'une **clé enregistrée**. L'expression SQL vient du
 *     registre, écrite à l'avance ; jamais de la requête.
 *  2. Les valeurs passent en **paramètres liés**, jamais concaténées.
 *  3. Une valeur du mauvais type est **refusée**, pas convertie au mieux : une
 *     date illisible comparée comme du texte produirait un résultat plausible
 *     et faux, ce qui est pire qu'une erreur.
 *
 * Les tests lisent le SQL produit par sa forme paramétrée : ce qui compte n'est
 * pas le texte exact mais le fait que la valeur soit **hors** de ce texte.
 */

function champ(surcharge: Partial<SearchableField> & { key: string }): SearchableField {
  return {
    labelKey: `recherche.champs.${surcharge.key}`,
    type: 'text',
    operators: ['eq', 'ne', 'contains', 'startsWith', 'isNull', 'isNotNull', 'in', 'lt', 'gt'],
    column: sql.raw(`t.${surcharge.key}`),
    ...surcharge,
  };
}

describe('SearchCompiler', () => {
  let registre: SearchRegistry;
  let compilateur: SearchCompiler;

  beforeEach(() => {
    registre = new SearchRegistry();
    compilateur = new SearchCompiler(registre);

    registre.register(champ({ key: 'sujet', type: 'text' }));
    registre.register(champ({ key: 'urgence', type: 'number' }));
    registre.register(champ({ key: 'ouvert_le', type: 'date' }));
    registre.register(champ({ key: 'archive', type: 'boolean' }));
    registre.register(
      champ({ key: 'statut', type: 'enum', options: ['new', 'assigned', 'solved'] }),
    );
    registre.register(champ({ key: 'categorie', type: 'reference' }));
  });

  /**
   * Le SQL rendu : texte à marqueurs d'un côté, valeurs de l'autre.
   *
   * C'est ce que PostgreSQL recevra. Lire les deux séparément permet de dire à
   * la fois quel opérateur a été produit et que la valeur est bien hors du
   * texte.
   */
  const rendu = (arbre: Parameters<SearchCompiler['compile']>[0]) => {
    const clause = compilateur.compile(arbre);

    return clause ? rendreSql(clause) : undefined;
  };

  const critere = (field: string, operator: string, value?: unknown) =>
    ({ kind: 'criterion' as const, field, operator, value }) as Parameters<
      SearchCompiler['compile']
    >[0];

  describe('sûreté', () => {
    it('refuse un champ qui n’est pas au registre', () => {
      // C'est la garde principale : sans elle, `field` nommerait une colonne,
      // et la recherche reviendrait a composer la clause `WHERE`.
      expect(() => compilateur.compile(critere('t.password', 'eq', 'x'))).toThrow(
        BadRequestException,
      );
    });

    it('refuse un opérateur que le champ n’accepte pas', () => {
      registre.register(champ({ key: 'restreint', operators: ['eq'] }));

      expect(() => compilateur.compile(critere('restreint', 'contains', 'x'))).toThrow(
        BadRequestException,
      );
    });

    it('refuse un critère sans opérateur', () => {
      expect(() => compilateur.compile(critere('sujet', ''))).toThrow(BadRequestException);
    });

    it('lie la valeur au lieu de la concaténer', () => {
      const { texte, parametres } = rendu(critere('sujet', 'eq', "'; DROP TABLE tickets; --"))!;

      // La valeur est un parametre, pas du texte insere : elle ne figure nulle
      // part dans le SQL, et se retrouve entiere dans les parametres.
      expect(texte).not.toContain('DROP TABLE');
      expect(texte).toContain('$1');
      expect(parametres).toEqual(["'; DROP TABLE tickets; --"]);
    });

    it('refuse un arbre trop imbriqué', () => {
      let arbre: Parameters<SearchCompiler['compile']>[0] = critere('sujet', 'eq', 'x');

      for (let niveau = 0; niveau < 8; niveau += 1) {
        arbre = { kind: 'group', link: 'and', children: [arbre] } as typeof arbre;
      }

      // Un arbre sans borne permettrait de faire travailler l'analyseur SQL
      // indefiniment avec une requete de quelques kilo-octets.
      expect(() => compilateur.compile(arbre)).toThrow(BadRequestException);
    });
  });

  describe('groupes', () => {
    it('ne produit rien pour un arbre absent', () => {
      expect(compilateur.compile(undefined)).toBeUndefined();
    });

    it('ne produit rien pour un groupe vide', () => {
      // Et surtout pas `TRUE` : un groupe vide qui selectionnerait tout
      // transformerait un filtre incomplet en absence de filtre.
      expect(compilateur.compile({ kind: 'group', link: 'and', children: [] })).toBeUndefined();
    });

    it('ignore les enfants qui ne produisent rien', () => {
      const clause = compilateur.compile({
        kind: 'group',
        link: 'and',
        children: [{ kind: 'group', link: 'and', children: [] }, critere('sujet', 'eq', 'panne')!],
      });

      expect(clause).toBeDefined();
    });

    it('relie par ET ou par OU selon le groupe', () => {
      const enfants = [critere('sujet', 'eq', 'a')!, critere('sujet', 'eq', 'b')!];

      const et = rendu({ kind: 'group', link: 'and', children: enfants })!;
      const ou = rendu({ kind: 'group', link: 'or', children: enfants })!;

      expect(et.texte).toContain(' AND ');
      expect(ou.texte).toContain(' OR ');
    });

    it('relie par ET quand le groupe ne le précise pas', () => {
      const clause = rendu({
        kind: 'group',
        children: [critere('sujet', 'eq', 'a')!, critere('sujet', 'eq', 'b')!],
      })!;

      // Le defaut est le plus restrictif : un filtre qu'on croyait cumulatif
      // et qui elargit silencieusement est le pire des deux.
      expect(clause.texte).toContain(' AND ');
    });
  });

  describe('opérateurs', () => {
    const texteDe = (arbre: Parameters<SearchCompiler['compile']>[0]) => rendu(arbre)!.texte;

    it('compile la nullité sans valeur', () => {
      expect(texteDe(critere('sujet', 'isNull'))).toContain('IS NULL');
      expect(texteDe(critere('sujet', 'isNotNull'))).toContain('IS NOT NULL');
    });

    it('compile les comparaisons de rang', () => {
      expect(texteDe(critere('urgence', 'lt', 3))).toContain('<');
      expect(texteDe(critere('urgence', 'gt', 3))).toContain('>');
    });

    it('compile « contient » et « commence par » en ILIKE', () => {
      expect(texteDe(critere('sujet', 'contains', 'panne'))).toContain('ILIKE');
      expect(texteDe(critere('sujet', 'startsWith', 'pan'))).toContain('ILIKE');
    });

    it('traite « différent de » en IS DISTINCT FROM', () => {
      // `<>` laisserait une valeur nulle n'etre « differente de » rien, ce qui
      // surprend toujours : un ticket sans categorie disparaitrait d'un filtre
      // « categorie differente de 3 ».
      expect(texteDe(critere('urgence', 'ne', 3))).toContain('IS DISTINCT FROM');
    });

    it('ne sélectionne rien pour une liste vide', () => {
      // Et surtout pas tout : `IN ()` est une erreur SQL, et un repli sur
      // `TRUE` transformerait un filtre vide en absence de filtre.
      expect(texteDe(critere('urgence', 'in', []))).toContain('FALSE');
    });

    it('accepte une valeur seule là où une liste est attendue', () => {
      expect(texteDe(critere('urgence', 'in', 3))).toContain('IN');
    });
  });

  describe('typage des valeurs', () => {
    it('refuse du texte là où un nombre est attendu', () => {
      expect(() => compilateur.compile(critere('urgence', 'eq', 'beaucoup'))).toThrow(
        BadRequestException,
      );
    });

    it('accepte un nombre écrit en texte', () => {
      // Les valeurs arrivent d'une chaine de requete, ou tout est texte :
      // refuser « 3 » rendrait le filtre inutilisable depuis une URL.
      expect(compilateur.compile(critere('urgence', 'eq', '3'))).toBeDefined();
    });

    it('refuse une date illisible', () => {
      expect(() => compilateur.compile(critere('ouvert_le', 'lt', 'hier'))).toThrow(
        BadRequestException,
      );
    });

    it('accepte une date en texte ou en objet', () => {
      expect(compilateur.compile(critere('ouvert_le', 'lt', '2026-03-01'))).toBeDefined();
      expect(compilateur.compile(critere('ouvert_le', 'lt', new Date()))).toBeDefined();
    });

    it('refuse une valeur hors des choix d’un champ énuméré', () => {
      // Une valeur hors liste ne remonterait aucun ticket : le dire vaut mieux
      // que de rendre une liste vide qu'on prendrait pour un resultat.
      expect(() => compilateur.compile(critere('statut', 'eq', 'inexistant'))).toThrow(
        BadRequestException,
      );

      expect(compilateur.compile(critere('statut', 'eq', 'solved'))).toBeDefined();
    });

    it('lit un booléen depuis le texte comme depuis le type', () => {
      expect(compilateur.compile(critere('archive', 'eq', 'true'))).toBeDefined();
      expect(compilateur.compile(critere('archive', 'eq', true))).toBeDefined();
      expect(compilateur.compile(critere('archive', 'eq', 'non'))).toBeDefined();
    });

    it('traite une référence comme un nombre', () => {
      expect(compilateur.compile(critere('categorie', 'eq', '12'))).toBeDefined();
      expect(() => compilateur.compile(critere('categorie', 'eq', 'douze'))).toThrow(
        BadRequestException,
      );
    });

    it('refuse une valeur non textuelle pour « contient »', () => {
      expect(() => compilateur.compile(critere('sujet', 'contains', 42))).toThrow(
        BadRequestException,
      );
    });
  });
});
