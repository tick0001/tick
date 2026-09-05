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
          owner: createDatabase({ connectionString: env.DATABASE_URL, max: 4 }),
          app: createDatabase({ connectionString: env.DATABASE_APP_URL, max: 20 }),
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
