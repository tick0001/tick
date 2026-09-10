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

/** La date du jour, telle que le journal l'ecrit. */
function maintenant() {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

/** La ligne de lien du bas, sans laquelle le titre de la section pointe dans le vide. */
function poserLeLien(journal) {
  const premierLien = journal.indexOf('\n[0.');

  if (premierLien === -1) {
    refuser("Le journal n'a aucun bloc de liens « [x.y.z]: … » ou inserer celui de la version.");
  }

  const lien = `[${version}]: https://github.com/tick0001/tick/releases/tag/v${version}\n`;

  return journal.slice(0, premierLien + 1) + lien + journal.slice(premierLien + 1);
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

  // Une section « Non publié » deja ouverte est **datee**, pas doublee.
  //
  // C'est la facon normale de tenir ce journal : les corrections s'y accumulent
  // au fil des semaines, et la version leur donne un numero et une date. Sans
  // ce cas, la nouvelle section s'inserait au-dessus et laissait les entrees
  // orphelines dans un « Non publié » qui ne se publiait jamais.
  const enAttente = '\n## Non publié\n';

  if (journal.includes(enAttente)) {
    const ecrit = journal.replace(enAttente, `\n## [${version}] — ${maintenant()}\n`);

    return () => {
      writeFileSync(chemin, poserLeLien(ecrit));
    };
  }

  // Les rubriques restent en commentaire : oubliee, une rubrique vide se voit
  // a la relecture, alors qu'un commentaire non retire ne s'affiche nulle part.
  const section = [
    `## [${version}] — ${maintenant()}`,
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

  if (premiereVersion === -1) {
    refuser("Le journal n'a aucune section « ## [x.y.z] » au-dessus de laquelle inserer.");
  }

  const ecrit =
    journal.slice(0, premiereVersion + 1) + section + journal.slice(premiereVersion + 1);

  return () => {
    writeFileSync(chemin, poserLeLien(ecrit));
  };
}

// Tout se verifie avant que rien ne s'ecrive. Un premier essai avait monte le
// manifeste puis echoue sur le journal, laissant la branche a moitie preparee :
// l'erreur suivante aurait ete de la corriger a la main sans s'en souvenir.
const ecritures = [monterLeManifeste(), ouvrirLaSection()];

for (const ecrire of ecritures) ecrire();

console.log(`Manifeste en ${version}, section ${version} ouverte dans le journal.`);
