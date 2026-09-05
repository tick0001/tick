import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { withRequestContext, type Database, type Transaction } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { APP_DB, DB_CONNECTIONS, OWNER_DB } from './database.tokens.js';
import type { Connection } from '@tick/db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  constructor(
    @Inject(APP_DB) private readonly app: Database,
    @Inject(OWNER_DB) private readonly owner: Database,
    @Inject(DB_CONNECTIONS)
    private readonly connections: { owner: Connection; app: Connection },
  ) {}

  /**
   * Transaction du role applicatif, portant le contexte de la requete.
   *
   * C'est la seule voie d'acces pour le code metier. Les parametres de session
   * sont poses par la couche donnees, et les politiques de Row-Level Security
   * s'appliquent : aucune requete ecrite ici ne peut sortir du perimetre, meme
   * en SQL brut, meme ecrite par un plugin.
   */
  async asUser<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withRequestContext(this.app, requireContext(), work);
  }

  /**
   * Transaction du role proprietaire, hors Row-Level Security.
   *
   * Reservee aux operations qui precedent l'existence d'un contexte :
   * authentification, resolution du perimetre, amorcage, migrations. Tout autre
   * usage annulerait l'isolation entre entites.
   */
  async asOwner<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.owner.transaction(work);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.connections.owner.close(), this.connections.app.close()]);
  }
}
