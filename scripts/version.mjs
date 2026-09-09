// Prepare une version : manifeste et squelette de journal.
//
// Appele par `make version V=0.1.8`, apres que la cible a cree la branche.
// Deux gestes fastidieux et faciles a rater, que personne ne devrait taper a
// la main : le numero dans le manifeste — que lit `/api/health`, et dont la
// publication refuse la divergence — et l'ossature de la section du journal,
// dont la position, le format de date et la ligne de lien se trompent
// silencieusement.
//
// Le contenu, lui, s'ecrit. Ce script ne devine pas ce qu'une version change.

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error(`« ${version ?? ''} » n'est pas un numero de version.`);
  process.exit(1);
}

function refuser(raison) {
  console.error(raison);
  process.exit(1);
}

/** Le manifeste que lit la route de sante, et sur lequel la publication verifie la concordance. */
function monterLeManifeste() {
  const chemin = 'apps/api/package.json';
  const manifeste = JSON.parse(readFileSync(chemin, 'utf8'));

  manifeste.version = version;

  return () => {
    writeFileSync(chemin, `${JSON.stringify(manifeste, null, 2)}\n`);
  };
}

/**
 * Insere la section, en tete des versions et non en tete du fichier.
 *
 * Le journal s'ouvre sur un preambule qui dit a qui il s'adresse : ecrire
 * avant lui mettrait la nouveaute au-dessus de son mode d'emploi.
 */
function ouvrirLaSection() {
  const chemin = 'CHANGELOG.md';
  const journal = readFileSync(chemin, 'utf8');

  if (journal.includes(`\n## [${version}]`)) {
    refuser(`Le journal a deja une section ${version}.`);
  }

  const date = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  // Les rubriques restent en commentaire : oubliee, une rubrique vide se voit
  // a la relecture, alors qu'un commentaire non retire ne s'affiche nulle part.
  const section = [
    `## [${version}] — ${date}`,
    '',
    '<!--',
    'Rubriques utiles seulement, dans cet ordre :',
    '',
    '### Sécurité   ### Corrigé   ### Ajouté   ### Modifié   ### À faire en montant',
    '',
    'Rien de ce qui ne concerne que le dépôt — intégration continue, outillage de',
    'publication, fichiers de communauté. Ce journal s’adresse à qui exploite Tick&.',
    '-->',
    '',
    '',
  ].join('\n');

  const premiereVersion = journal.indexOf('\n## [');
  const premierLien = journal.indexOf('\n[0.');

  if (premiereVersion === -1 || premierLien === -1) {
    refuser(
      "Le journal n'a pas la forme attendue : une section « ## [x.y.z] » et un bloc de liens" +
        ' « [x.y.z]: … » sont requis pour savoir ou inserer.',
    );
  }

  // La ligne de lien, sans laquelle le titre pointe dans le vide.
  const lien = `[${version}]: https://github.com/tick0001/tick/releases/tag/v${version}\n`;
  const ecrit =
    journal.slice(0, premiereVersion + 1) +
    section +
    journal.slice(premiereVersion + 1, premierLien + 1) +
    lien +
    journal.slice(premierLien + 1);

  return () => {
    writeFileSync(chemin, ecrit);
  };
}

// Tout se verifie avant que rien ne s'ecrive. Un premier essai avait monte le
// manifeste puis echoue sur le journal, laissant la branche a moitie preparee :
// l'erreur suivante aurait ete de la corriger a la main sans s'en souvenir.
const ecritures = [monterLeManifeste(), ouvrirLaSection()];

for (const ecrire of ecritures) ecrire();

console.log(`Manifeste en ${version}, section ${version} ouverte dans le journal.`);
