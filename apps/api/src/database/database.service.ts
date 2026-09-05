import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql, withRequestContext, type Database, type Transaction } from '@tick/db';
import { currentContext, requireContext } from '../common/request-context.js';
import { APP_DB, DB_CONNECTIONS, OWNER_DB } from './database.tokens.js';
import { flushEvents, withEventBuffer } from '../plugins/event-buffer.js';
import type { Connection } from '@tick/db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);

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
    return this.transactional(() => withRequestContext(this.app, requireContext(), work));
  }

  /**
   * Transaction du role proprietaire, hors Row-Level Security.
   *
   * Reservee aux operations qui precedent l'existence d'un contexte :
   * authentification, resolution du perimetre, amorcage, migrations. Tout autre
   * usage annulerait l'isolation entre entites.
   */
  async asOwner<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.transactional(() => this.owner.transaction(work));
  }

  /**
   * Transaction pour le compte d'un plugin, restreinte a son schema.
   *
   * Le `search_path` place le schema du plugin en premier : une requete sans
   * prefixe atteint ses tables et non celles du coeur. La connexion reste celle
   * du role applicatif, donc soumise au Row-Level Security.
   *
   * Hors requete — un gestionnaire d'evenement en arriere-plan — le perimetre
   * d'entites est **vide** : le plugin voit ses propres tables mais aucune
   * donnee metier. Lui donner le perimetre total serait plus commode et
   * annulerait l'isolation.
   */
  async asPlugin<T>(schema: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    const context = currentContext() ?? {
      userId: 0,
      profileId: 0,
      entityPath: '',
      scope: { subtreePaths: [], exactPaths: [] },
    };

    return this.transactional(() =>
      withRequestContext(this.app, context, async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO ${schema}, public`));

        return work(tx);
      }),
    );
  }

  /**
   * Ouvre un tampon d'evenements pour la duree de la transaction, et ne les
   * publie qu'une fois celle-ci validee.
   *
   * C'est ce qui garantit qu'aucune notification ne part pour une ecriture
   * annulee. Un echec de publication est journalise sans faire echouer
   * l'operation metier : la donnee est ecrite, la file a ses propres reprises.
   */
  private async transactional<T>(work: () => Promise<T>): Promise<T> {
    const { result, events } = await withEventBuffer(work);

    try {
      await flushEvents(events);
    } catch (error) {
      this.logger.error(`Publication des evenements impossible : ${String(error)}`);
    }

    return result;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.connections.owner.close(), this.connections.app.close()]);
  }
}
