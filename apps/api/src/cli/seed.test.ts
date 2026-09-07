import { createDatabase, sql, type Connection } from '@tick/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Le jeu de démonstration, exécuté pour de vrai.
 *
 * C'est le premier contact avec Tick& : `pnpm db:seed` doit peupler une base
 * vierge sans intervention. Un script d'amorçage cassé n'échoue pas à moitié —
 * il laisse une base à demi remplie que personne ne sait réparer, et le nouveau
 * venu abandonne là.
 *
 * Ce fichier passe **avant** tous les autres (voir le séquenceur de
 * `vitest.config.mts`) : l'amorçage tronque les tables, et le lancer au milieu
 * de la suite effacerait les données des autres tests. En contrepartie, la
 * suite entière devient rejouable depuis une base neuve, ce qui n'était pas le
 * cas quand elle supposait un `pnpm db:seed` lancé à la main.
 */

let base: Connection;

async function compte(table: string): Promise<number> {
  const resultat = await base.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
  );

  return resultat.rows[0]?.n ?? 0;
}

describe('Jeu de démonstration', () => {
  beforeAll(async () => {
    // L'import déclenche l'amorçage, mais rend la main dès que le corps du
    // module est évalué : c'est la promesse exportée qu'il faut attendre.
    // Sans elle, les assertions portaient sur une base encore vide en
    // intégration continue, et sur les données de l'exécution précédente en
    // local — où le test passait donc sans rien vérifier de ce qu'il croyait.
    const { amorcage } = await import('./seed.js');

    await amorcage;

    base = createDatabase({ connectionString: process.env['DATABASE_URL'] ?? '', max: 2 });
  }, 180_000);

  afterAll(async () => {
    await base.close();
  });

  it('bâtit une arborescence d’entités', async () => {
    const resultat = await base.db.execute<{ name: string; path: string; level: number }>(
      sql`SELECT name, path::text AS path, level FROM entities ORDER BY path`,
    );

    expect(resultat.rows.length).toBeGreaterThan(3);
    expect(resultat.rows.filter((ligne) => ligne.level === 0)).toHaveLength(1);

    // Le chemin materialise est pose par le declencheur, jamais par le script :
    // une entite restee a « temporaire » serait invisible a toute politique de
    // securite, donc silencieusement inaccessible.
    for (const ligne of resultat.rows) {
      expect(ligne.path, ligne.name).not.toBe('temporaire');
      expect(ligne.path).toMatch(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/);
    }
  });

  it('crée les profils de référence et leurs droits', async () => {
    const profils = await base.db.execute<{ name: string; n: number }>(sql`
      SELECT p.name, count(r.object)::int AS n
        FROM profiles p LEFT JOIN profile_rights r ON r.profile_id = p.id
       GROUP BY p.name ORDER BY p.name
    `);

    expect(profils.rows.map((ligne) => ligne.name)).toEqual(
      expect.arrayContaining(['Self-service', 'Technicien', 'Superviseur']),
    );

    // L'absence de ligne vaut refus : un profil sans droit n'ouvre rien, et
    // c'est exactement ce qu'on verrait si l'insertion des droits echouait.
    for (const ligne of profils.rows) {
      expect(ligne.n, ligne.name).toBeGreaterThan(0);
    }
  });

  it('ouvre un compte administrateur utilisable', async () => {
    const resultat = await base.db.execute<{ username: string; hash: string; actif: boolean }>(sql`
      SELECT username::text AS username, password_hash AS hash, is_active AS actif
        FROM users WHERE username = 'admin'
    `);

    expect(resultat.rows).toHaveLength(1);
    expect(resultat.rows[0]?.actif).toBe(true);

    // Le mot de passe est condense, jamais stocke en clair — meme dans un jeu
    // de demonstration, dont on sait qu'il finit parfois en production.
    expect(resultat.rows[0]?.hash).not.toBe('tick');
    expect((resultat.rows[0]?.hash ?? '').length).toBeGreaterThan(20);
  });

  it('habilite chaque compte quelque part', async () => {
    const orphelins = await base.db.execute<{ username: string }>(sql`
      SELECT u.username::text AS username
        FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM authorizations a WHERE a.user_id = u.id)
    `);

    // Un compte sans habilitation se connecte et ne voit rien : c'est le
    // symptome le plus deroutant qu'un amorçage incomplet puisse produire.
    expect(orphelins.rows.map((ligne) => ligne.username)).toEqual([]);
  });

  it('peuple les référentiels du socle ITIL', async () => {
    for (const table of [
      'itil_categories',
      'request_sources',
      'task_categories',
      'solution_types',
      'locations',
    ]) {
      expect(await compte(table), table).toBeGreaterThan(0);
    }
  });

  it('ouvre des tickets, des problèmes et des changements', async () => {
    expect(await compte('tickets')).toBeGreaterThan(0);
    expect(await compte('problems')).toBeGreaterThan(0);
    expect(await compte('changes')).toBeGreaterThan(0);
    expect(await compte('itil_followups')).toBeGreaterThan(0);
    expect(await compte('itil_actors')).toBeGreaterThan(0);
  });

  it('donne à chaque ticket une priorité dans l’échelle', async () => {
    const incoherents = await base.db.execute<{ id: number }>(
      sql`SELECT id FROM tickets WHERE priority < 1 OR priority > 5`,
    );

    expect(incoherents.rows).toEqual([]);
  });

  it('rattache chaque objet à une entité résolue', async () => {
    for (const table of ['tickets', 'problems', 'changes', 'groups', 'rules', 'agreements']) {
      const resultat = await base.db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE entity_path::text = 'temporaire'`,
      );

      expect(resultat.rows[0]?.n, table).toBe(0);
    }
  });

  it('configure les engagements, calendriers et règles', async () => {
    for (const table of [
      'calendars',
      'calendar_segments',
      'agreements',
      'agreement_levels',
      'rules',
      'rule_criteria',
      'rule_actions',
    ]) {
      expect(await compte(table), table).toBeGreaterThan(0);
    }
  });

  it('configure notifications, connaissance, formulaires et satisfaction', async () => {
    for (const table of [
      'notification_templates',
      'notification_template_translations',
      'kb_categories',
      'kb_articles',
      'forms',
      'form_questions',
      'satisfaction_configs',
    ]) {
      expect(await compte(table), table).toBeGreaterThan(0);
    }
  });

  it('prépare le pilotage : tableaux de bord, récurrences, planning', async () => {
    for (const table of [
      'dashboards',
      'dashboard_widgets',
      'recurring_tickets',
      'unavailabilities',
    ]) {
      expect(await compte(table), table).toBeGreaterThan(0);
    }
  });

  it('chiffre les secrets des collecteurs et des annuaires', async () => {
    const collecteurs = await base.db.execute<{ chiffre: string | null }>(
      sql`SELECT password_encrypted AS chiffre FROM mail_collectors`,
    );

    expect(collecteurs.rows.length).toBeGreaterThan(0);

    // Un secret stocke en clair fuit avec la moindre sauvegarde de base.
    for (const ligne of collecteurs.rows) {
      expect(ligne.chiffre).not.toBe('support');
    }
  });

  it('déclare des annuaires et leurs règles d’affectation', async () => {
    expect(await compte('ldap_directories')).toBeGreaterThan(0);
  });
});
