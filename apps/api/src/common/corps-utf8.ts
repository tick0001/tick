import { isUtf8 } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BadRequestException } from '@nestjs/common';

/**
 * Refuse un corps de requête annoncé en UTF-8 qui n'en est pas.
 *
 * Sans ce contrôle, l'analyseur remplace chaque séquence invalide par « � » et
 * la requête passe : un client qui envoie du Windows-1252 en se disant UTF-8
 * enregistre « 2e �tage » au lieu de « 2e étage », sans erreur, et le
 * caractère d'origine est perdu. Constaté avec `curl` sous Git Bash pour
 * Windows. JSON impose l'UTF-8 (RFC 8259) : mieux vaut refuser que corrompre.
 *
 * Branché comme `verify` des analyseurs, qui le rappellent avec les octets
 * bruts avant tout décodage. Une exception HTTP de Nest, et non une erreur
 * quelconque : l'analyseur reprend son statut, et Nest la rend comme un refus
 * ordinaire au lieu de la journaliser comme une panne.
 */
export function exigerUtf8(
  _requete: IncomingMessage,
  _reponse: ServerResponse,
  corps: Buffer,
  encodage: string,
): void {
  // Un corps annoncé dans un autre jeu de caractères est décodé comme tel.
  if (encodage.toLowerCase().replace('-', '') !== 'utf8') return;
  if (isUtf8(corps)) return;

  throw new BadRequestException(
    "Le corps de la requête n'est pas de l'UTF-8 valide : vérifiez l'encodage du client.",
  );
}
