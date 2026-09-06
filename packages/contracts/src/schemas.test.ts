import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contrats from './index.js';

/**
 * Propriétés vraies de **tous** les schémas, vérifiées d'un coup.
 *
 * Écrire un test par schéma les ferait diverger : celui qu'on ajoute demain
 * n'aurait pas le sien, et personne ne le remarquerait. Ce fichier part au
 * contraire de ce que le paquet exporte réellement, si bien qu'un schéma ajouté
 * est vérifié sans que quiconque y pense.
 */

type Entree = readonly [string, z.ZodType];

/**
 * Les exports sont élargis avant d'être filtrés.
 *
 * `Object.entries(contrats)` produit l'union de tous les types exportés, où se
 * mêlent des schémas et des constantes. Un prédicat de type doit être
 * assignable à ce qu'il filtre, ce qu'une union de cette taille n'admet pas.
 * Passer par `unknown` rend le filtre écrivable sans rien affaiblir : ce qui en
 * sort est vérifié à l'exécution, juste en dessous.
 */
const exportes = contrats as Record<string, unknown>;

const schemas: Entree[] = Object.entries(exportes)
  .filter(
    (entree): entree is [string, z.ZodType] =>
      entree[0].endsWith('Schema') && entree[1] instanceof z.ZodType,
  )
  .sort(([a], [b]) => a.localeCompare(b));

describe('Contrats exportés', () => {
  it('expose au moins cent schémas', () => {
    // Garde-fou : si l'index cessait de réexporter un module, ce fichier
    // continuerait de passer en ne testant plus rien.
    expect(schemas.length).toBeGreaterThan(100);
  });

  it.each(schemas)('%s est un schéma Zod utilisable', (_nom, schema) => {
    expect(schema).toBeInstanceOf(z.ZodType);
    expect(typeof schema.safeParse).toBe('function');
  });

  /**
   * Aucun schéma n'accepte n'importe quoi.
   *
   * Un `z.any()` oublié passe la revue sans bruit et rend la validation
   * décorative : le serveur croit vérifier, et laisse entrer la valeur qui fera
   * tomber la requête trois couches plus bas.
   */
  it.each(schemas)('%s refuse une valeur absurde', (nom, schema) => {
    const absurde = Symbol('valeur qui ne ressemble a rien');
    const resultat = schema.safeParse(absurde);

    if (resultat.success) {
      throw new Error(`${nom} accepte n'importe quelle valeur.`);
    }

    expect(resultat.success).toBe(false);
  });

  /**
   * Un refus porte toujours un chemin exploitable.
   *
   * C'est ce que l'interface affiche à côté du champ fautif. Sans lui, elle ne
   * peut que dire « formulaire invalide », ce qui laisse chercher lequel des
   * quinze champs pose problème.
   */
  it.each(schemas)('%s décrit ses refus', (_nom, schema) => {
    const resultat = schema.safeParse(Symbol('rien'));

    expect(resultat.success).toBe(false);

    if (!resultat.success) {
      expect(resultat.error.issues.length).toBeGreaterThan(0);
      expect(resultat.error.issues[0]).toHaveProperty('message');
    }
  });
});
