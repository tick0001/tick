/**
 * Lecture d'un message entrant.
 *
 * Volontairement pur : ni IMAP, ni base. Ce sont ces décisions-là qui coûtent
 * cher quand elles se trompent — rattacher une réponse au mauvais ticket, ou
 * répondre à un répondeur automatique — et elles se testent sans rien monter.
 */

export interface IncomingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface IncomingMail {
  /** Identifiant pose par la messagerie d'origine, entre chevrons. */
  messageId: string | null;
  from: string | null;
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  /** En-tetes en minuscules, pour une lecture insensible a la casse. */
  headers: Record<string, string>;
  attachments: IncomingAttachment[];
}

/**
 * Marqueur de rattachement dans le sujet.
 *
 * `[#123]` plutôt qu'un simple `#123` : un numéro nu apparaît dans du texte
 * ordinaire — « erreur #500 », « facture #42 » — et suffirait à greffer une
 * demande neuve sur un ticket sans rapport.
 */
const MARQUEUR_SUJET = /\[#(\d{1,9})\]/;

/** En-têtes qui signent une réponse automatique. */
const EN_TETES_AUTOMATIQUES = [
  'x-autoreply',
  'x-autorespond',
  'x-auto-response-suppress',
  'list-id',
  'list-unsubscribe',
];

/**
 * Lignes à partir desquelles le texte n'est plus la réponse mais la citation.
 *
 * Anglais et français, parce qu'un client de messagerie écrit dans la langue de
 * son utilisateur et que le collecteur, lui, ne choisit pas ses correspondants.
 */
const DEBUTS_DE_CITATION = [
  /^-{2,}\s*(original message|message d'origine|message original)\s*-{2,}/i,
  /^On .{0,200}\bwrote\s*:\s*$/i,
  // « ecrit » sans accent est accepte : un message traverse des passerelles
  // qui normalisent le texte, et l'accent est le premier caractere perdu.
  /^Le .{0,200}\ba\s+[eé]crit\s*:\s*$/i,
  /^De\s*:\s*.+$/i,
  /^From\s*:\s*.+$/i,
  /^_{10,}$/,
  /^>/,
];

/** Numéro de ticket cité dans le sujet, s'il y en a un. */
export function ticketFromSubject(subject: string): number | null {
  const correspondance = MARQUEUR_SUJET.exec(subject);

  if (!correspondance?.[1]) return null;

  const numero = Number(correspondance[1]);

  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

/** Sujet préfixé du marqueur, pour que la réponse revienne au bon endroit. */
export function withSubjectToken(subject: string, ticketId: number): string {
  return ticketFromSubject(subject) === ticketId ? subject : `[#${String(ticketId)}] ${subject}`;
}

/**
 * Reconnaît une réponse automatique.
 *
 * Le vrai risque n'est pas d'ouvrir un ticket de trop : c'est la boucle. Un
 * accusé de réception qui crée un ticket, qui envoie une notification, qui
 * déclenche un nouvel accusé, et ainsi de suite jusqu'à saturation de la boîte.
 */
export function isAutoReply(mail: IncomingMail): boolean {
  const auto = mail.headers['auto-submitted'];

  if (auto && auto.trim().toLowerCase() !== 'no') return true;

  const precedence = mail.headers['precedence']?.trim().toLowerCase();

  if (precedence && ['bulk', 'auto_reply', 'junk', 'list'].includes(precedence)) return true;

  return EN_TETES_AUTOMATIQUES.some((entete) => entete in mail.headers);
}

/**
 * Vrai si le message vient d'une de nos propres adresses d'expédition.
 *
 * La comparaison porte sur l'adresse nue : une messagerie écrit
 * `Tick& <support@exemple.fr>`, et comparer la chaîne entière laisserait passer
 * exactement les messages contre lesquels ce garde-fou existe.
 */
export function isFromSelf(mail: IncomingMail, adresses: readonly string[]): boolean {
  const expediteur = bareAddress(mail.from);

  if (!expediteur) return false;

  return adresses.some((adresse) => bareAddress(adresse) === expediteur);
}

/**
 * Retire la citation et la signature.
 *
 * Sans cela, chaque réponse recopierait tout l'échange précédent dans le suivi,
 * et la chronologie d'un ticket un peu long deviendrait illisible.
 */
export function stripQuotedReply(texte: string): string {
  const lignes = texte.replaceAll('\r\n', '\n').split('\n');
  const gardees: string[] = [];

  for (const ligne of lignes) {
    if (DEBUTS_DE_CITATION.some((motif) => motif.test(ligne.trim()))) break;

    // Séparateur de signature de la RFC 3676 : tout ce qui suit est signature.
    if (ligne.trimEnd() === '--') break;

    gardees.push(ligne);
  }

  return gardees.join('\n').trim();
}

/** Adresse seule, débarrassée du nom affiché. */
export function bareAddress(valeur: string | null | undefined): string | null {
  if (!valeur) return null;

  const entreChevrons = /<([^>]+)>/.exec(valeur);
  const adresse = (entreChevrons?.[1] ?? valeur).trim().toLowerCase();

  return adresse.includes('@') ? adresse : null;
}

/**
 * Identifiants de messages cités par une réponse.
 *
 * `In-Reply-To` d'abord — c'est le parent direct — puis `References`, en
 * remontant du plus récent : un fil dévié conserve la référence la plus proche
 * en dernier.
 */
export function citedMessageIds(mail: IncomingMail): string[] {
  const cites = [mail.inReplyTo, ...[...mail.references].reverse()];

  return [...new Set(cites.filter((identifiant): identifiant is string => Boolean(identifiant)))];
}
