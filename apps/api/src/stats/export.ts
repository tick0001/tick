/**
 * Exports tabulaires : CSV et PDF.
 *
 * Écrits ici plutôt qu'empruntés. Le CSV tient en une règle d'échappement ; le
 * PDF, réduit à un tableau en Helvetica, tient en un objet par page plus une
 * table de références croisées. Une bibliothèque de génération de PDF pèse
 * plusieurs mégaoctets et suit son propre calendrier de sécurité, pour un
 * besoin qui ne dépasse pas le tableau imprimable.
 */

export interface Colonne {
  key: string;
  label: string;
}

/**
 * Rendu textuel d'une valeur de cellule.
 *
 * Un objet part en JSON plutôt qu'en « [object Object] » : la cellule reste
 * lisible et diagnosticable, alors que la représentation par défaut ne dit même
 * pas quel champ a mal tourné.
 */
function texte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  if (valeur instanceof Date) return valeur.toISOString();

  return JSON.stringify(valeur) ?? '';
}

/**
 * Échappement CSV, au sens du RFC 4180.
 *
 * Les guillemets encadrent dès qu'un séparateur, un guillemet ou un saut de
 * ligne apparaît, et les guillemets internes sont doublés. Le préfixe d'une
 * valeur commençant par `=`, `+`, `-` ou `@` est neutralisé par une apostrophe :
 * sans cela, un titre de ticket commençant par `=` devient une formule dans le
 * tableur qui l'ouvre, et c'est un vecteur d'injection connu.
 */
function champ(valeur: unknown): string {
  const rendu = texte(valeur);
  const neutralise = /^[=+\-@\t\r]/.test(rendu) ? `'${rendu}` : rendu;

  return /[",\r\n]/.test(neutralise) ? `"${neutralise.replaceAll('"', '""')}"` : neutralise;
}

export function toCsv(
  colonnes: readonly Colonne[],
  lignes: readonly Record<string, unknown>[],
): string {
  const sortie = [colonnes.map((colonne) => champ(colonne.label)).join(',')];

  for (const ligne of lignes) {
    sortie.push(colonnes.map((colonne) => champ(ligne[colonne.key])).join(','));
  }

  // Marque d'ordre des octets : sans elle, Excel lit le fichier en codage
  // local et transforme chaque accent en deux caracteres. Ecrite en
  // echappement, parce qu'un caractere invisible dans le source est
  // exactement le genre de detail qu'une copie perd en silence.
  return `\u{FEFF}${sortie.join('\r\n')}\r\n`;
}

// --- PDF ---------------------------------------------------------------------

/** Page A4 en points PostScript, à 72 points par pouce. */
const LARGEUR = 595;
const HAUTEUR = 842;
const MARGE = 36;
const LIGNE_HAUTEUR = 14;
const TAILLE_TITRE = 14;
const TAILLE_TEXTE = 9;

/**
 * Échappement d'une chaîne littérale PDF.
 *
 * Les parenthèses délimitent la chaîne : non échappées, une parenthèse dans un
 * titre de ticket casse le document entier, et les lecteurs ne le disent pas —
 * ils affichent une page blanche.
 */
function texteVersPdf(valeur: string): string {
  return valeur
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll(/[\r\n]/g, ' ');
}

/**
 * Réduit au jeu de caractères WinAnsi.
 *
 * La police de base 14 n'a pas de table de correspondance Unicode : tout
 * caractère hors WinAnsi sortirait en glyphe arbitraire. Les accents latins
 * passent, le reste est remplacé — un point d'interrogation visible vaut mieux
 * qu'un caractère faux qu'on croira exact.
 */
function versWinAnsi(valeur: string): string {
  let sortie = '';

  for (const caractere of valeur.normalize('NFC')) {
    const code = caractere.codePointAt(0) ?? 63;

    sortie += code >= 32 && code <= 255 ? caractere : '?';
  }

  return sortie;
}

/** Largeur approchée d'un texte en Helvetica, en points. */
function largeurApprochee(texte: string, taille: number): number {
  // 0,5 em par caractère : la moyenne d'Helvetica sur du texte courant. La
  // mesure exacte demanderait la table de chasses de la police, pour un gain
  // invisible sur une troncature.
  return texte.length * taille * 0.5;
}

function tronque(texte: string, largeurMax: number, taille: number): string {
  if (largeurApprochee(texte, taille) <= largeurMax) return texte;

  const caracteres = Math.max(1, Math.floor(largeurMax / (taille * 0.5)) - 1);

  return `${texte.slice(0, caracteres)}…`.replace('…', '...');
}

interface Page {
  contenu: string;
}

/**
 * Compose un tableau paginé.
 *
 * Les colonnes se partagent la largeur utile à parts égales. Une répartition
 * proportionnelle au contenu serait plus jolie et demanderait de mesurer tout
 * le tableau avant d'en dessiner la première ligne.
 */
function pages(
  titre: string,
  colonnes: readonly Colonne[],
  lignes: readonly Record<string, unknown>[],
): Page[] {
  const utile = LARGEUR - 2 * MARGE;
  const colonneLargeur = utile / Math.max(1, colonnes.length);
  const parPage = Math.floor((HAUTEUR - 2 * MARGE - 3 * LIGNE_HAUTEUR) / LIGNE_HAUTEUR);
  const resultat: Page[] = [];

  for (let debut = 0; debut < Math.max(1, lignes.length); debut += parPage) {
    const morceau = lignes.slice(debut, debut + parPage);
    const flux: string[] = ['BT', `/F2 ${String(TAILLE_TITRE)} Tf`];
    let y = HAUTEUR - MARGE - TAILLE_TITRE;

    flux.push(`1 0 0 1 ${String(MARGE)} ${String(y)} Tm`, `(${texteVersPdf(titre)}) Tj`);

    y -= LIGNE_HAUTEUR * 1.5;
    flux.push(`/F2 ${String(TAILLE_TEXTE)} Tf`);

    colonnes.forEach((colonne, index) => {
      const x = MARGE + index * colonneLargeur;

      flux.push(
        `1 0 0 1 ${String(x)} ${String(y)} Tm`,
        `(${texteVersPdf(tronque(colonne.label, colonneLargeur - 4, TAILLE_TEXTE))}) Tj`,
      );
    });

    y -= LIGNE_HAUTEUR;
    flux.push(`/F1 ${String(TAILLE_TEXTE)} Tf`);

    for (const ligne of morceau) {
      colonnes.forEach((colonne, index) => {
        const valeur = texte(ligne[colonne.key]);
        const x = MARGE + index * colonneLargeur;

        flux.push(
          `1 0 0 1 ${String(x)} ${String(y)} Tm`,
          `(${texteVersPdf(tronque(valeur, colonneLargeur - 4, TAILLE_TEXTE))}) Tj`,
        );
      });

      y -= LIGNE_HAUTEUR;
    }

    flux.push('ET');
    resultat.push({ contenu: flux.join('\n') });
  }

  return resultat;
}

/**
 * Assemble le document.
 *
 * La table de références croisées exige la position en octets de chaque objet :
 * le document est donc construit en une passe, en cumulant les longueurs au
 * fur et à mesure. Un décalage d'un octet rend le fichier illisible, sans
 * message d'erreur utile.
 */
export function toPdf(
  titre: string,
  colonnes: readonly Colonne[],
  lignes: readonly Record<string, unknown>[],
): Buffer {
  const propres = lignes.map((ligne) => {
    const copie: Record<string, unknown> = {};

    for (const colonne of colonnes) {
      const valeur = ligne[colonne.key];

      copie[colonne.key] = versWinAnsi(texte(valeur));
    }

    return copie;
  });

  const feuilles = pages(
    versWinAnsi(titre),
    colonnes.map((colonne) => ({ ...colonne, label: versWinAnsi(colonne.label) })),
    propres,
  );

  const objets: string[] = [];
  const premierePage = 4;
  const identifiants = feuilles.map((_, index) => premierePage + index * 2);

  objets.push('<< /Type /Catalog /Pages 2 0 R >>');
  objets.push(
    `<< /Type /Pages /Count ${String(feuilles.length)} /Kids [${identifiants
      .map((id) => `${String(id)} 0 R`)
      .join(' ')}] >>`,
  );
  objets.push(
    '<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica ' +
      '/Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 ' +
      '/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >>',
  );

  for (const [index, feuille] of feuilles.entries()) {
    const contenuId = identifiants[index]! + 1;

    objets.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(LARGEUR)} ${String(HAUTEUR)}] ` +
        `/Resources 3 0 R /Contents ${String(contenuId)} 0 R >>`,
    );
    objets.push(
      `<< /Length ${String(Buffer.byteLength(feuille.contenu, 'latin1'))} >>\nstream\n` +
        `${feuille.contenu}\nendstream`,
    );
  }

  let sortie = '%PDF-1.4\n';
  const positions: number[] = [];

  for (const [index, objet] of objets.entries()) {
    positions.push(Buffer.byteLength(sortie, 'latin1'));
    sortie += `${String(index + 1)} 0 obj\n${objet}\nendobj\n`;
  }

  const debutXref = Buffer.byteLength(sortie, 'latin1');

  sortie += `xref\n0 ${String(objets.length + 1)}\n0000000000 65535 f \n`;

  for (const position of positions) {
    sortie += `${String(position).padStart(10, '0')} 00000 n \n`;
  }

  sortie +=
    `trailer\n<< /Size ${String(objets.length + 1)} /Root 1 0 R >>\n` +
    `startxref\n${String(debutXref)}\n%%EOF\n`;

  // `latin1` et non `utf8` : les chaînes ont déjà été réduites à WinAnsi, et
  // un encodage en UTF-8 décalerait toutes les positions de la table de
  // références croisées.
  return Buffer.from(sortie, 'latin1');
}
