import type { PlanningEntry } from '@tick/contracts';

/**
 * Sérialisation iCalendar (RFC 5545).
 *
 * Écrite ici plutôt qu'empruntée : le format tient en trois règles — repli des
 * lignes à 75 octets, échappement de quatre caractères, horodatage UTC — et
 * une dépendance de plus se paierait à chaque mise à jour de sécurité pour un
 * gain de quelques dizaines de lignes.
 */

/** Horodatage UTC de base, sans séparateurs : `20260906T143000Z`. */
function horodatage(valeur: string): string {
  const date = new Date(valeur);

  if (Number.isNaN(date.getTime())) return '19700101T000000Z';

  return `${date.toISOString().replaceAll(/[-:]/g, '').slice(0, 15)}Z`;
}

/**
 * Échappement des valeurs texte.
 *
 * L'antislash passe en premier : l'échapper après les autres doublerait les
 * antislashs que l'on vient d'introduire.
 */
function echappe(valeur: string): string {
  return valeur
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

/**
 * Repli des lignes longues.
 *
 * La limite de 75 porte sur les **octets**, pas sur les caractères : un accent
 * compte double en UTF-8, et compter en caractères produirait des lignes que
 * les clients stricts refusent. La continuation commence par une espace.
 */
function plie(ligne: string): string {
  const octets = Buffer.from(ligne, 'utf8');

  if (octets.length <= 75) return ligne;

  const morceaux: string[] = [];
  let debut = 0;

  while (debut < octets.length) {
    const taille = debut === 0 ? 75 : 74;
    let fin = Math.min(debut + taille, octets.length);

    // Ne jamais couper au milieu d'une séquence UTF-8 : les octets de
    // continuation ont leurs deux bits de poids fort à `10`.
    while (fin < octets.length && (octets[fin]! & 0b1100_0000) === 0b1000_0000) fin -= 1;

    morceaux.push((debut === 0 ? '' : ' ') + octets.subarray(debut, fin).toString('utf8'));
    debut = fin;
  }

  return morceaux.join('\r\n');
}

/** Identifiant stable d'une entrée, pour que le client sache la remplacer. */
function uid(entree: PlanningEntry): string {
  return `${entree.kind}-${String(entree.id)}@tick`;
}

export function toIcalendar(entrees: readonly PlanningEntry[], maintenant = new Date()): string {
  const lignes: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tick&//Planning//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const entree of entrees) {
    const description =
      entree.itilType && entree.itilId
        ? `${entree.itilType} #${String(entree.itilId)}`
        : (entree.userName ?? '');

    lignes.push(
      'BEGIN:VEVENT',
      `UID:${uid(entree)}`,
      `DTSTAMP:${horodatage(maintenant.toISOString())}`,
      `DTSTART:${horodatage(entree.beginAt)}`,
      `DTEND:${horodatage(entree.endAt)}`,
      plie(`SUMMARY:${echappe(entree.title)}`),
      plie(`DESCRIPTION:${echappe(description)}`),
      // Une indisponibilité occupe la personne, une tâche « pour information »
      // ne l'occupe pas : c'est cette distinction que le client de calendrier
      // utilise pour proposer un créneau.
      `TRANSP:${entree.state === 'information' ? 'TRANSPARENT' : 'OPAQUE'}`,
      'END:VEVENT',
    );
  }

  lignes.push('END:VCALENDAR');

  // CRLF exigé par la norme, y compris en fin de fichier.
  return `${lignes.join('\r\n')}\r\n`;
}
