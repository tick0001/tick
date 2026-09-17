import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plugins, sql } from '@tick/db';
import { pluginManifestSchema } from '@tick/plugin-sdk/manifest';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { PluginSettingsService } from '../plugins/plugin-settings.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Les reglages de plugins, contre une vraie base.
 *
 * Trois exigences tiennent ce service : l'heritage entre entites se resout
 * comme l'ecran l'annonce, un secret n'est jamais stocke ni rendu en clair a
 * l'ecran, et le role applicatif — celui qu'utilisent les plugins — n'a aucun
 * acces a la table.
 */
describe('Reglages de plugins', () => {
  const PLUGIN = 'essai-reglages';
  let fixture: Fixture;
  let service: PluginSettingsService;

  const manifeste = pluginManifestSchema.parse({
    id: PLUGIN,
    name: 'Essai des reglages',
    version: '1.0.0',
    sdk: '^0.8.0',
    settings: [
      { key: 'titre', label: 'Titre', type: 'text', default: 'Tick&' },
      { key: 'actif', label: 'Actif', type: 'boolean', default: false },
      { key: 'seuil', label: 'Seuil', type: 'number', min: 1, max: 5 },
      {
        key: 'format',
        label: 'Format',
        type: 'enum',
        options: ['court', 'long'],
        default: 'court',
      },
      { key: 'canal', label: 'Canal', type: 'text', scope: 'entity' },
      { key: 'jeton', label: 'Jeton', type: 'secret', scope: 'entity' },
    ],
  });

  const id = (cle: string): number => fixture.entityIds[cle] as number;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    fixture = await createFixture('RGL');

    const db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });
    service = new PluginSettingsService(db, new SecretsService());

    await fixture.owner.db.insert(plugins).values({
      id: PLUGIN,
      name: manifeste.name,
      version: manifeste.version,
      sdkRange: manifeste.sdk,
      manifest: manifeste,
    });
  }, 30_000);

  afterAll(async () => {
    // Les reglages suivent le plugin par la cle etrangere.
    await fixture.owner.db.execute(sql`DELETE FROM plugins WHERE id = ${PLUGIN}`);
    await fixture.cleanup();
  });

  describe('reglages d instance', () => {
    it('rend la valeur du manifeste tant que rien n est pose', async () => {
      expect(await service.valeur(manifeste, 'titre')).toBe('Tick&');
      expect(await service.valeur(manifeste, 'seuil')).toBeNull();
    });

    it('rend la valeur posee, dans son type', async () => {
      await service.enregistrer(manifeste, null, { titre: 'Support', actif: true, seuil: 3 });

      expect(await service.valeur(manifeste, 'titre')).toBe('Support');
      expect(await service.valeur(manifeste, 'actif')).toBe(true);
      expect(await service.valeur(manifeste, 'seuil')).toBe(3);
    });

    it('revient au manifeste quand la valeur est retiree', async () => {
      await service.enregistrer(manifeste, null, { titre: null });

      expect(await service.valeur(manifeste, 'titre')).toBe('Tick&');
    });

    it('laisse inchange ce qui n est pas envoye', async () => {
      await service.enregistrer(manifeste, null, { format: 'long' });

      expect(await service.valeur(manifeste, 'seuil')).toBe(3);
      expect(await service.valeur(manifeste, 'format')).toBe('long');
    });
  });

  describe('heritage entre entites', () => {
    beforeAll(async () => {
      await service.enregistrer(manifeste, id('nord'), { canal: 'filiale' });
      await service.enregistrer(manifeste, id('siteA'), { canal: 'site-a' });
    });

    it('prend la valeur de l entite, puis celle de son plus proche ancetre', async () => {
      expect(await service.valeur(manifeste, 'canal', id('siteA'))).toBe('site-a');
      expect(await service.valeur(manifeste, 'canal', id('siteB'))).toBe('filiale');
      expect(await service.valeur(manifeste, 'canal', id('nord'))).toBe('filiale');
    });

    it('rend le defaut quand aucun ancetre ne porte de valeur', async () => {
      expect(await service.valeur(manifeste, 'canal', id('siege'))).toBeNull();
    });

    it('dit a l ecran d ou vient une valeur heritee', async () => {
      const [canal] = await service.vue(manifeste, id('siteB'));

      expect(canal).toMatchObject({
        key: 'canal',
        value: null,
        isSet: false,
        inherited: { fromEntityId: id('nord'), value: 'filiale' },
      });
      expect(canal?.inherited?.fromEntityName).toContain('Filiale Nord');
    });

    it('exige l entite pour un reglage d entite', async () => {
      await expect(service.valeur(manifeste, 'canal')).rejects.toThrow(/precisez entityId/);
    });

    it('ne montre a l instance que les reglages d instance, et inversement', async () => {
      const instance = await service.vue(manifeste, null);
      const entite = await service.vue(manifeste, id('siteA'));

      expect(instance.map((r) => r.key)).toEqual(['titre', 'actif', 'seuil', 'format']);
      expect(entite.map((r) => r.key)).toEqual(['canal', 'jeton']);
    });
  });

  describe('secrets', () => {
    beforeAll(async () => {
      await service.enregistrer(manifeste, id('nord'), { jeton: 'hunter2-tres-secret' });
    });

    it('les stocke chiffres', async () => {
      const lignes = await fixture.owner.db.execute<{ value: string }>(sql`
        SELECT value FROM plugin_settings WHERE plugin_id = ${PLUGIN} AND key = 'jeton'
      `);

      expect(lignes.rows).toHaveLength(1);
      expect(lignes.rows[0]?.value).not.toContain('hunter2');
    });

    it('les rend en clair au plugin, par heritage compris', async () => {
      expect(await service.valeur(manifeste, 'jeton', id('siteA'))).toBe('hunter2-tres-secret');
    });

    it('ne les rend jamais a l ecran, ni poses ni herites', async () => {
      const ici = (await service.vue(manifeste, id('nord'))).find((r) => r.key === 'jeton');
      const herite = (await service.vue(manifeste, id('siteA'))).find((r) => r.key === 'jeton');

      expect(ici).toMatchObject({ value: null, isSet: true });
      expect(herite).toMatchObject({ value: null, isSet: false });
      expect(herite?.inherited).toMatchObject({ fromEntityId: id('nord'), value: null });
      expect(JSON.stringify([ici, herite])).not.toContain('hunter2');
    });

    it('refuse une chaine vide, et efface sur null', async () => {
      await expect(service.enregistrer(manifeste, id('nord'), { jeton: '' })).rejects.toThrow(
        /texte non vide/,
      );
      expect(await service.valeur(manifeste, 'jeton', id('nord'))).toBe('hunter2-tres-secret');

      await service.enregistrer(manifeste, id('nord'), { jeton: null });
      expect(await service.valeur(manifeste, 'jeton', id('nord'))).toBeNull();
    });
  });

  describe('validation', () => {
    it.each([
      ['un booleen', { actif: 'oui' }],
      ['un nombre', { seuil: 'trois' }],
      ["un nombre d'au plus 5", { seuil: 9 }],
      ["un nombre d'au moins 1", { seuil: 0 }],
      ['une valeur parmi', { format: 'moyen' }],
      ['du texte', { titre: 42 }],
    ])('refuse ce qui n est pas %s', async (_attendu, valeurs) => {
      await expect(service.enregistrer(manifeste, null, valeurs)).rejects.toThrow(/attend/);
    });

    it('refuse une cle que le plugin ne declare pas', async () => {
      await expect(service.enregistrer(manifeste, null, { inconnu: 'x' })).rejects.toThrow(
        /aucun reglage/,
      );
    });

    it('refuse un reglage d entite pose sur l instance, et l inverse', async () => {
      await expect(service.enregistrer(manifeste, null, { canal: 'x' })).rejects.toThrow(
        /se pose sur une entite/,
      );
      await expect(service.enregistrer(manifeste, id('siteA'), { titre: 'x' })).rejects.toThrow(
        /toute l'instance/,
      );
    });

    it('n ecrit rien quand une seule valeur est fausse', async () => {
      await service.enregistrer(manifeste, null, { titre: 'avant' });

      await expect(
        service.enregistrer(manifeste, null, { titre: 'apres', seuil: 99 }),
      ).rejects.toThrow();

      expect(await service.valeur(manifeste, 'titre')).toBe('avant');
    });
  });

  it('reste hors de portee du role applicatif, donc des plugins', async () => {
    // Un plugin execute du SQL brut avec ce role. Il ne doit ni lire les
    // reglages des autres, ni reecrire les siens sans validation. Drizzle
    // enveloppe l'erreur de PostgreSQL : le refus est dans sa cause.
    const refus = async (requete: Promise<unknown>): Promise<string> => {
      try {
        await requete;
      } catch (erreur) {
        return String((erreur as { cause?: unknown }).cause ?? erreur);
      }

      return 'aucune erreur';
    };

    expect(await refus(fixture.app.db.execute(sql`SELECT * FROM plugin_settings`))).toMatch(
      /permission denied/,
    );
    expect(
      await refus(
        fixture.app.db.execute(
          sql`INSERT INTO plugin_settings (plugin_id, key, value) VALUES (${PLUGIN}, 'titre', 'x')`,
        ),
      ),
    ).toMatch(/permission denied/);
  });
});
