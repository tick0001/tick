import { Injectable } from '@nestjs/common';
import { sql } from '@tick/db';
import { DatabaseService } from '../database/database.service.js';

/**
 * Au-dela de ce nombre de tickets semblables, les correspondances sont dites
 * denses.
 *
 * Deux strategies, et aucune ne gagne partout — mesure a cinq cent mille
 * tickets :
 *
 *   peu de correspondances   filtrer sur les identifiants     2,6 ms pour 2 000
 *   correspondances denses   parcourir la liste dans l'ordre  3,7 ms
 *
 * Filtrer sur 62 501 identifiants coutait 334 ms ; parcourir la liste dans
 * l'ordre pour un ticket unique la parcourt en entier. Le plafond separe les
 * deux regimes.
 */
export const PLAFOND_SONDE = 2000;

/**
 * `ILIKE`, pour les correspondances denses.
 *
 * Meme fonction, meme resultat ; seule l'estimation change. Sous Row-Level
 * Security, le planificateur suppose qu'un `ILIKE` ne retient presque rien, et
 * balaie la table au lieu de parcourir la liste dans l'ordre. Voir l'operateur
 * `~~~*` dans la migration `0033_recherche_textuelle`.
 */
export const OPERATEUR_DENSE = sql.raw('OPERATOR(public.~~~*)');

/** Colonnes que `tick_tickets_semblables` sait interroger. */
export type CibleTextuelle = 'titre' | 'description' | 'tous';

/**
 * Ce que la sonde a trouve.
 *
 * `identifiants` est **complet** : tous les tickets semblables que l'appelant a
 * le droit de voir, a l'instant de la sonde.
 */
export type Sondage =
  { readonly dense: false; readonly identifiants: readonly number[] } | { readonly dense: true };

export type Resolution = ReadonlyMap<string, Sondage>;

export function cleSondage(cible: CibleTextuelle, motif: string): string {
  return `${cible}:${motif}`;
}

/**
 * L'index trigramme peut-il servir ce motif ?
 *
 * `pg_trgm` decoupe le texte en mots — suites de lettres et de chiffres — et en
 * tire des trigrammes. Un motif dont aucun mot n'atteint trois caracteres n'en
 * fournit aucun : l'index devrait etre lu en entier, et la sonde couterait
 * autant que le balayage qu'elle cherche a eviter. Ces motifs gardent la
 * recherche d'avant.
 */
export function sondable(motif: string): boolean {
  return motif.split(/[^\p{L}\p{N}]+/u).some((mot) => mot.length >= 3);
}

/**
 * Premier temps de la recherche textuelle : interroger l'index.
 *
 * `tick_tickets_semblables` lit l'index en tant que proprietaire et applique
 * elle-meme le perimetre de l'appelant — voir la migration
 * `0033_recherche_textuelle`. La sonde passe par `asUser` : c'est ce qui pose le
 * perimetre dans la transaction, et sans contexte la fonction ne rend rien.
 */
@Injectable()
export class SondeTextuelle {
  constructor(private readonly db: DatabaseService) {}

  /** `undefined` quand l'index ne peut pas servir : la recherche reste celle d'avant. */
  async sonder(cible: CibleTextuelle, motif: string): Promise<Sondage | undefined> {
    if (!sondable(motif)) return undefined;

    const lignes = await this.db.asUser((tx) =>
      tx.execute<{ id: string }>(sql`
        SELECT semblables.id
          FROM tick_tickets_semblables(${motif}, ${cible}, ${PLAFOND_SONDE + 1})
            AS semblables(id)
      `),
    );

    if (lignes.rows.length > PLAFOND_SONDE) return { dense: true };

    return { dense: false, identifiants: lignes.rows.map((ligne) => Number(ligne.id)) };
  }
}

/**
 * Litteral de tableau PostgreSQL, a partir d'identifiants deja convertis en
 * nombres.
 *
 * Passer un tableau JavaScript au gabarit `sql` le deplierait en liste de
 * parametres ; un litteral unique garde la requete stable, quelle que soit la
 * taille de la liste.
 */
export function tableauIdentifiants(identifiants: readonly number[]): string {
  return `{${identifiants.map((id) => String(Math.trunc(id))).join(',')}}`;
}
