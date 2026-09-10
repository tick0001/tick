import { Global, Module } from '@nestjs/common';
import { createDatabase, type Connection, type Database } from '@tick/db';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from './database.service.js';
import { APP_DB, DB_CONNECTIONS, OWNER_DB } from './database.tokens.js';

export interface Connections {
  owner: Connection;
  app: Connection;
}

@Global()
@Module({
  providers: [
    {
      provide: DB_CONNECTIONS,
      useFactory: (): Connections => {
        const env = loadEnv();

        return {
          // Le pool proprietaire reste petit, et volontairement : il ne sert
          // qu'aux migrations, a l'amorcage et a la sonde de sante. Lui donner
          // de la place prendrait des connexions au trafic reel.
          owner: createDatabase({ connectionString: env.DATABASE_URL, max: 4 }),
          // Le pool applicatif porte tout le reste. Reglable, parce qu'un
          // serveur de collectivite et un serveur de PME n'ont pas la meme
          // marge — et parce que c'etait le seul reglage fige dans le code.
          app: createDatabase({
            connectionString: env.DATABASE_APP_URL,
            max: env.DATABASE_POOL_MAX,
          }),
        };
      },
    },
    {
      provide: OWNER_DB,
      inject: [DB_CONNECTIONS],
      useFactory: (connections: Connections): Database => connections.owner.db,
    },
    {
      provide: APP_DB,
      inject: [DB_CONNECTIONS],
      useFactory: (connections: Connections): Database => connections.app.db,
    },
    DatabaseService,
  ],
  exports: [DatabaseService, OWNER_DB, APP_DB],
})
export class DatabaseModule {}
