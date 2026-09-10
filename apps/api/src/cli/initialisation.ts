import type { RightScope } from '@tick/contracts';
import { RIGHT_CATALOGUE } from '../admin/right-catalogue.js';

/**
 * Ce que l'initialisation décide, sans rien écrire.
 *
 * Extrait de `initialiser.ts` pour être testable : la commande exécute `main()`
 * dès qu'on l'importe, si bien qu'un test ne pouvait pas la charger sans la
 * lancer. Ces trois fonctions n'ont aucun effet de bord, et ce sont elles qui
 * portent les règles — la commande, elle, ne fait qu'écrire ce qu'elles disent.
 *
 * Les défauts qu'elles évitent sont tous silencieux : un mot de passe trop
 * court accepté sur une installation exposée, une variable d'environnement
 * ignorée au profit d'une valeur par défaut, un droit ajouté au cœur qui
 * n'arrive jamais à l'administrateur.
 */

/** Portée la plus large que l'objet accepte : « all » quand il l'admet. */
export function porteeMaximale(portees: readonly RightScope[]): RightScope {
  return portees.includes('all') ? 'all' : (portees.at(-1) ?? 'entity');
}

/**
 * Droits du profil d'administration, dérivés du catalogue.
 *
 * Dérivés et non recopiés : un droit ajouté au cœur doit revenir à
 * l'administrateur sans que personne y pense. Une liste tenue à la main aurait
 * dérivé au premier objet ajouté, et le premier symptôme serait un écran
 * inaccessible à celui qui est censé tout pouvoir.
 */
export function droitsAdministrateur(): { object: string; action: string; scope: RightScope }[] {
  return RIGHT_CATALOGUE.flatMap((entree) =>
    entree.actions.map((action) => ({
      object: entree.object,
      action,
      scope: porteeMaximale(entree.scopes),
    })),
  );
}

export interface Options {
  identifiant: string;
  motDePasse: string;
  courriel: string | null;
  entite: string;
}

/** Longueur minimale du mot de passe d'administration, à la création. */
export const LONGUEUR_MINIMALE = 12;

/**
 * Lit les options, de la ligne de commande ou de l'environnement.
 *
 * Le mot de passe est accepté par variable d'environnement en plus de
 * l'argument : sur un serveur, un argument de ligne de commande est visible de
 * tout le monde dans `ps`, ce qui livre le compte d'administration à quiconque
 * a un terminal sur la machine.
 */
export function lireOptions(
  argv: readonly string[],
  environnement: Record<string, string | undefined> = process.env,
): Options {
  const valeur = (nom: string): string | undefined => {
    const prefixe = `--${nom}=`;

    return argv.find((argument) => argument.startsWith(prefixe))?.slice(prefixe.length);
  };

  const identifiant = valeur('identifiant') ?? environnement['TICK_ADMIN_USERNAME'] ?? 'admin';
  const motDePasse = valeur('mot-de-passe') ?? environnement['TICK_ADMIN_PASSWORD'] ?? '';
  const courriel = valeur('courriel') ?? environnement['TICK_ADMIN_EMAIL'] ?? null;
  const entite = valeur('entite') ?? environnement['TICK_ROOT_ENTITY'] ?? 'Racine';

  if (motDePasse.length < LONGUEUR_MINIMALE) {
    throw new Error(
      `Mot de passe absent ou trop court (${String(LONGUEUR_MINIMALE)} caractères au minimum).\n` +
        'Passez-le par TICK_ADMIN_PASSWORD, de préférence à --mot-de-passe : ' +
        'un argument de ligne de commande se lit dans `ps`.',
    );
  }

  return { identifiant, motDePasse, courriel, entite };
}
