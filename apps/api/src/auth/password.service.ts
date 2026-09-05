import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id : valeur 2 de l'enumeration `Algorithm` de @node-rs/argon2.
 * Celle-ci est declaree en `const enum`, donc inaccessible sous
 * `isolatedModules`. La valeur est reprise explicitement plutot que de
 * s'en remettre au defaut de la bibliotheque, qui pourrait changer.
 */
const ARGON2ID = 2;

/**
 * Condensats de mots de passe en Argon2id.
 *
 * Argon2id est le choix recommande actuel : il resiste a la fois aux attaques
 * par canal auxiliaire et aux attaques materielles massivement paralleles, ce
 * que bcrypt ne fait pas. Les parametres de cout sont portes par le condensat
 * lui-meme, ce qui permet de les durcir plus tard sans invalider l'existant.
 */
@Injectable()
export class PasswordService {
  async hash(plain: string): Promise<string> {
    return hash(plain, { algorithm: ARGON2ID });
  }

  /**
   * Verifie un mot de passe.
   *
   * Renvoie faux plutot que de propager l'erreur si le condensat est absent ou
   * illisible : un compte d'annuaire n'en a pas, et un condensat corrompu ne
   * doit pas devenir un moyen de distinguer les comptes existants.
   */
  async verify(digest: string | null, plain: string): Promise<boolean> {
    if (!digest) return false;

    try {
      return await verify(digest, plain);
    } catch {
      return false;
    }
  }
}
