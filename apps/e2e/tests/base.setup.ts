import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Remet la base dans un etat connu avant toute la suite.
 *
 * **Cette etape efface la base de developpement.** C'est delibere, et c'est la
 * seule facon d'avoir des scenarios repetables : les tests creent des tickets,
 * publient des suivis, envoient des demandes. Sans remise a zero, la deuxieme
 * execution part d'un etat different de la premiere — et une suite dont le
 * resultat depend du nombre de fois qu'on l'a lancee ne protege de rien.
 *
 * Le defaut a ete constate, pas suppose : les comptages de tickets par portee
 * passaient au premier run et echouaient au second, les demandes envoyees par
 * le scenario de libre-service ayant grossi la liste du demandeur.
 *
 * Seules les **donnees** sont remises a zero : les conteneurs, eux, restent
 * en place. La base visee est celle du `.env` de developpement.
 */
export default function reinitialiserLaBase(): void {
  const racine = fileURLToPath(new URL('../../..', import.meta.url));

  // `db:seed` et non `db:reset` : le second fait un `docker compose down -v`,
  // detruit les conteneurs et arrache la base sous l'API qui tourne deja. Le
  // seed, lui, commence par un TRUNCATE de toutes les tables — il remet les
  // donnees a zero sans toucher aux services. Constate en direct : la suite
  // passait de 35 verts a 4, l'API ayant perdu PostgreSQL et Redis.
  execFileSync('pnpm', ['db:seed'], {
    cwd: racine,
    stdio: 'inherit',
    // Windows resout `pnpm` par un `.cmd` : sans shell, le binaire est
    // introuvable et la suite echoue sur une erreur sans rapport.
    shell: process.platform === 'win32',
  });
}
