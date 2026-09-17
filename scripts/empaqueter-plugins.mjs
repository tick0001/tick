// Prepare les plugins publies avec chaque version.
//
// Usage : node scripts/empaqueter-plugins.mjs <dossier-de-sortie>
//
// Chaque plugin publie est recopie dans son propre dossier, pret a etre depose
// dans le `./plugins` d'une installation : manifeste, code compile, migrations,
// README et licence. Rien d'autre — ni sources, ni configuration de test, ni
// `node_modules`.
//
// Le dossier deposable n'a **aucune dependance a resoudre** : le code d'un
// plugin est charge par un `import()` depuis le dossier des plugins, ou il n'y
// a pas de `node_modules`. Un bundle qui importerait un paquet fonctionnerait
// dans le depot, ou le paquet se trouve par hasard, et echouerait chez
// l'exploitant. Ce script refuse donc tout import qui n'est ni relatif, ni un
// module de Node.
//
// Les plugins doivent etre construits avant : `pnpm --filter "./plugins/*" build`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les plugins qui partent avec une version.
 *
 * `exemple-bonjour` n'y est pas : il sert de documentation et de test au
 * substrat, et n'a rien a faire dans l'ecran d'une installation.
 */
export const PLUGINS_PUBLIES = ['messagerie'];

/** Imports statiques, dynamiques et `require`, avec leur cible. */
const IMPORTS = [
  /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function refuser(message) {
  throw new Error(message);
}

/** Tous les fichiers d'un dossier, recursivement. */
function fichiers(dossier) {
  return readdirSync(dossier, { withFileTypes: true, recursive: true })
    .filter((entree) => entree.isFile())
    .map((entree) => join(entree.parentPath, entree.name));
}

/** Les imports d'un bundle qui ne se resoudront pas hors du depot. */
export function importsNonResolus(code) {
  const cibles = new Set();

  for (const motif of IMPORTS) {
    for (const correspondance of code.matchAll(motif)) {
      const cible = correspondance[1];

      if (!cible.startsWith('.') && !cible.startsWith('node:')) cibles.add(cible);
    }
  }

  return [...cibles];
}

/** Recopie un plugin publie dans `destination/<id>`, et le verifie. */
function empaqueterUn(nom, destination) {
  const source = join(RACINE, 'plugins', nom);
  const manifeste = JSON.parse(readFileSync(join(source, 'tick.plugin.json'), 'utf8'));
  const cible = join(destination, manifeste.id);

  if (!manifeste.server && !manifeste.client) {
    refuser(`${nom} : le manifeste ne declare aucun point d'entree.`);
  }

  for (const entree of [manifeste.server, manifeste.client].filter(Boolean)) {
    if (!existsSync(join(source, entree))) {
      refuser(`${nom} : ${entree} est absent. Construisez les plugins avant de les empaqueter.`);
    }
  }

  const dist = join(source, 'dist');

  for (const fichier of fichiers(dist).filter((f) => f.endsWith('.js'))) {
    const manquants = importsNonResolus(readFileSync(fichier, 'utf8'));

    if (manquants.length > 0) {
      refuser(
        `${nom} : ${relative(source, fichier)} importe ${manquants.join(', ')}, ` +
          "introuvable dans le dossier des plugins d'une installation. Embarquez-le dans le bundle.",
      );
    }
  }

  rmSync(cible, { recursive: true, force: true });
  mkdirSync(cible, { recursive: true });

  cpSync(join(source, 'tick.plugin.json'), join(cible, 'tick.plugin.json'));
  cpSync(dist, join(cible, 'dist'), { recursive: true });

  const migrations = join(source, manifeste.migrations ?? 'migrations');

  if (existsSync(migrations)) {
    const sql = fichiers(migrations).filter((f) => f.endsWith('.sql'));

    mkdirSync(join(cible, 'migrations'), { recursive: true });
    for (const fichier of sql) {
      cpSync(fichier, join(cible, 'migrations', relative(migrations, fichier)));
    }
  }

  if (existsSync(join(source, 'README.md'))) {
    cpSync(join(source, 'README.md'), join(cible, 'README.md'));
  }

  // L'AGPL se distribue avec son texte.
  cpSync(join(RACINE, 'LICENSE'), join(cible, 'LICENSE'));

  return { id: manifeste.id, version: manifeste.version, dossier: cible };
}

/** Empaquette tous les plugins publies. Rend ce qui a ete produit. */
export function empaqueter(destination) {
  mkdirSync(destination, { recursive: true });

  return PLUGINS_PUBLIES.map((nom) => empaqueterUn(nom, resolve(destination)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];

  if (!destination) {
    console.error('Usage : node scripts/empaqueter-plugins.mjs <dossier-de-sortie>');
    process.exit(1);
  }

  try {
    for (const plugin of empaqueter(destination)) {
      console.log(`${plugin.id} ${plugin.version} -> ${relative(process.cwd(), plugin.dossier)}`);
    }
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exit(1);
  }
}
