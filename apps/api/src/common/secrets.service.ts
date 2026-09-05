import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Chiffrement des secrets reutilisables stockes en base.
 *
 * A distinguer des mots de passe utilisateur, pour lesquels un condensat suffit
 * et vaut mieux : ici la valeur doit pouvoir etre relue pour ouvrir une session
 * vers un systeme tiers. AES-256-GCM apporte le chiffrement et l'authenticite,
 * donc une valeur alteree en base est rejetee au lieu d'etre dechiffree en
 * n'importe quoi.
 *
 * Format stocke : `iv:tag:chiffre`, en base64url.
 */
@Injectable()
export class SecretsService {
  private readonly key = Buffer.from(loadEnv().ENCRYPTION_KEY, 'hex');

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return [
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [ivPart, tagPart, dataPart] = stored.split(':');

    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('Secret stocke illisible : format inattendu.');
    }

    const tag = Buffer.from(tagPart, 'base64url');
    if (tag.length !== TAG_LENGTH) {
      throw new Error("Secret stocke illisible : marque d'authenticite invalide.");
    }

    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
