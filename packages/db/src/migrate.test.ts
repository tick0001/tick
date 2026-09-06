import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le point d'entrée des migrations.
 *
 * C'est un script : tout s'exécute à l'import, et il n'exporte rien. On le
 * charge donc à la demande, dépendances simulées, une fois par scénario.
 *
 * Ce qui est vérifié ici n'est pas cosmétique. La migration s'exécute avec le
 * rôle **propriétaire**, seul à pouvoir modifier les tables ; la lancer avec le
 * rôle applicatif la ferait échouer, ou pire, ne modifierait qu'une partie des
 * lignes que les politiques laissent voir. Et le pool doit se fermer même quand
 * la migration échoue, faute de quoi la commande ne rend jamais la main.
 */

const migrate = vi.hoisted(() => vi.fn());
const createDatabase = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());

vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate }));
vi.mock('./client.js', () => ({ createDatabase }));
vi.mock('node:fs', () => ({ existsSync }));

/** Laisse la promesse de tête du module se résoudre avant d'observer. */
async function laisseFinir(): Promise<void> {
  for (let tour = 0; tour < 5; tour += 1) {
    await Promise.resolve();
  }
}

describe('migrate', () => {
  const url = process.env['DATABASE_URL'];
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();

    close = vi.fn().mockResolvedValue(undefined);
    createDatabase.mockReturnValue({ db: { marqueur: 'base' }, close });
    migrate.mockResolvedValue(undefined);
    existsSync.mockReturnValue(false);

    vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    process.env['DATABASE_URL'] = 'postgres://proprietaire@localhost:5432/tick';
  });

  afterEach(() => {
    if (url === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = url;

    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('applique les migrations puis ferme le pool', async () => {
    await import('./migrate.js');
    await laisseFinir();

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith('Migrations appliquees.');
    expect(process.exitCode).not.toBe(1);
  });

  it('emprunte le role proprietaire, jamais l’applicatif', async () => {
    process.env['DATABASE_APP_URL'] = 'postgres://applicatif@localhost:5432/tick';

    await import('./migrate.js');
    await laisseFinir();

    expect(createDatabase).toHaveBeenCalledWith({
      connectionString: 'postgres://proprietaire@localhost:5432/tick',
    });

    delete process.env['DATABASE_APP_URL'];
  });

  it('cherche les migrations dans le dossier du paquet', async () => {
    await import('./migrate.js');
    await laisseFinir();

    const [base, options] = migrate.mock.calls[0] as [unknown, { migrationsFolder: string }];

    expect(base).toEqual({ marqueur: 'base' });
    expect(options.migrationsFolder).toMatch(/drizzle$/);
  });

  it('s’arrete net si l’URL de la base est absente', async () => {
    delete process.env['DATABASE_URL'];

    await import('./migrate.js');
    await laisseFinir();

    // Sans URL, ne rien faire serait pire qu'echouer : la commande rendrait la
    // main en laissant croire que le schema est a jour.
    expect(createDatabase).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('ferme le pool meme quand la migration echoue', async () => {
    migrate.mockRejectedValue(new Error('contrainte violee'));

    await import('./migrate.js');
    await laisseFinir();

    // Le `finally` est ce qui empeche la commande de rester suspendue sur une
    // connexion ouverte, en integration comme sur un poste.
    expect(close).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('recherche du fichier .env', () => {
  const url = process.env['DATABASE_URL'];

  beforeEach(() => {
    vi.resetModules();

    createDatabase.mockReturnValue({ db: {}, close: vi.fn().mockResolvedValue(undefined) });
    migrate.mockResolvedValue(undefined);

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    process.env['DATABASE_URL'] = 'postgres://proprietaire@localhost:5432/tick';
  });

  afterEach(() => {
    if (url === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = url;

    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('charge le premier .env rencontre en remontant', async () => {
    // La commande se lance depuis n'importe quel repertoire, alors que le
    // fichier de configuration est unique et vit a la racine du depot.
    existsSync.mockReturnValue(true);

    const charge = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    await import('./migrate.js');
    await laisseFinir();

    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0]?.[0]).toMatch(/\.env$/);
  });

  it('abandonne sans erreur si la racine est atteinte', async () => {
    // Un deploiement peut ne fournir que des variables d'environnement : ne
    // trouver aucun `.env` est un cas normal, pas une panne.
    existsSync.mockReturnValue(false);

    const charge = vi.spyOn(process, 'loadEnvFile').mockImplementation(() => undefined);

    await import('./migrate.js');
    await laisseFinir();

    expect(charge).not.toHaveBeenCalled();
    expect(existsSync.mock.calls.length).toBeGreaterThan(1);
    expect(migrate).toHaveBeenCalled();
  });
});
