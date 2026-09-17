/**
 * Le contenu d'un fichier correspond-il au type qu'il annonce ?
 *
 * Le type d'une pièce jointe vient de l'expéditeur : l'en-tête d'un envoi
 * multipart, celui d'une partie de courriel. Le vérifier contre la liste
 * blanche ne prouvait rien — un SVG annoncé `image/png` passait, et un SVG
 * porte du script. Les premiers octets, eux, ne mentent pas sur la famille du
 * fichier.
 *
 * Le contrôle est volontairement simple :
 *
 * - images et PDF : leur signature exacte ;
 * - ZIP, et les formats bureautiques qui en sont — OOXML, OpenDocument : la
 *   signature d'une archive. Le contenu d'une archive n'est pas exécuté par un
 *   navigateur, et le téléchargement se fait en pièce jointe ;
 * - texte et CSV : aucun octet nul. Un fichier binaire se trahit presque
 *   toujours par un zéro dans ses premiers kilo-octets ; un texte n'en a pas.
 *
 * Il ne remplace pas les deux autres protections, qui restent : les pièces
 * sont servies en `attachment`, avec `nosniff`.
 */

type Verification = (contenu: Buffer) => boolean;

const commencePar =
  (...signatures: (number[] | string)[]): Verification =>
  (contenu) =>
    signatures.some((signature) => {
      const octets =
        typeof signature === 'string' ? Buffer.from(signature, 'latin1') : Buffer.from(signature);

      return contenu.subarray(0, octets.length).equals(octets);
    });

/** `PK\x03\x04` pour une archive, `PK\x05\x06` pour une archive vide. */
const archive = commencePar([0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]);

/** Les premiers kilo-octets suffisent : un binaire y a presque toujours un zéro. */
const texte: Verification = (contenu) => !contenu.subarray(0, 8192).includes(0);

const VERIFICATIONS: Record<string, Verification> = {
  'image/png': commencePar([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': commencePar([0xff, 0xd8, 0xff]),
  'image/gif': commencePar('GIF87a', 'GIF89a'),
  'image/webp': (contenu) =>
    commencePar('RIFF')(contenu) && contenu.subarray(8, 12).equals(Buffer.from('WEBP')),
  'application/pdf': commencePar('%PDF-'),
  'application/zip': archive,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': archive,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': archive,
  'application/vnd.oasis.opendocument.text': archive,
  'application/vnd.oasis.opendocument.spreadsheet': archive,
  'text/plain': texte,
  'text/csv': texte,
};

/** Les types dont on sait vérifier le contenu : ce sont les seuls acceptés. */
export const TYPES_ACCEPTES: ReadonlySet<string> = new Set(Object.keys(VERIFICATIONS));

/** Vrai si le contenu est de la famille que le type annonce. Faux pour un type inconnu. */
export function contenuConforme(type: string, contenu: Buffer): boolean {
  const verification = VERIFICATIONS[type];

  return verification !== undefined && verification(contenu);
}
