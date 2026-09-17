/**
 * Ce que le plugin annonce, et comment il l'écrit.
 *
 * Tout est pur ici : aucune requête, aucun réglage. Le serveur décide *si* il
 * faut annoncer ; ce module décide *quoi* écrire.
 */

export type Format = 'slack' | 'teams';
export type Langue = 'fr' | 'en';

export type Annonce =
  | {
      readonly genre: 'creation';
      readonly ticketId: number;
      readonly titre: string;
      readonly priorite: number;
      readonly type: 'incident' | 'request';
    }
  | {
      readonly genre: 'escalade';
      readonly ticketId: number;
      readonly niveau: string;
      readonly engagement: string;
    }
  | { readonly genre: 'resolution'; readonly ticketId: number };

const TEXTES = {
  fr: {
    incident: (id: number, titre: string, priorite: number) =>
      `Nouvel incident #${String(id)} — ${titre} (priorité ${String(priorite)})`,
    request: (id: number, titre: string, priorite: number) =>
      `Nouvelle demande #${String(id)} — ${titre} (priorité ${String(priorite)})`,
    escalade: (id: number, niveau: string, engagement: string) =>
      `Escalade sur le ticket #${String(id)} : niveau « ${niveau} » de l’engagement « ${engagement} »`,
    resolution: (id: number) => `Ticket #${String(id)} résolu`,
    ouvrir: 'Ouvrir le ticket',
  },
  en: {
    incident: (id: number, titre: string, priorite: number) =>
      `New incident #${String(id)} — ${titre} (priority ${String(priorite)})`,
    request: (id: number, titre: string, priorite: number) =>
      `New request #${String(id)} — ${titre} (priority ${String(priorite)})`,
    escalade: (id: number, niveau: string, engagement: string) =>
      `Escalation on ticket #${String(id)}: level “${niveau}” of agreement “${engagement}”`,
    resolution: (id: number) => `Ticket #${String(id)} solved`,
    ouvrir: 'Open the ticket',
  },
} as const;

const ESPACE_INVISIBLE = '​';

/**
 * Désamorce ce qu'un texte venu d'un utilisateur ferait faire à la messagerie.
 *
 * Le titre d'un ticket est saisi par un demandeur — parfois par un inconnu, via
 * un collecteur de courriel. Recopié tel quel, `<!channel>` ferait sonner tout
 * un canal Slack, `@here` tout un canal Mattermost ou Discord, et `[ici](…)`
 * deviendrait un lien au libellé choisi par l'auteur.
 *
 * - `&`, `<` et `>` sont échappés comme Slack l'exige ;
 * - un espace invisible suit chaque `@`, ce qui casse toute mention ;
 * - un espace invisible sépare `]` de `(`, ce qui casse tout lien Markdown.
 *
 * Le texte reste lisible à l'identique. Mattermost, qui ne décode pas toujours
 * les entités, peut afficher `&lt;` pour un titre contenant `<` : un défaut
 * d'affichage, préférable à une notification générale déclenchée par un
 * inconnu.
 */
export function neutraliser(texte: string): string {
  return texte
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('@', `@${ESPACE_INVISIBLE}`)
    .replaceAll('](', `]${ESPACE_INVISIBLE}(`);
}

/** Lien vers le ticket, quelle que soit la forme de l'adresse de l'instance. */
export function lienTicket(webUrl: string, ticketId: number): string {
  return `${webUrl.replace(/\/+$/, '')}/tickets/${String(ticketId)}`;
}

/** La phrase, dans la langue voulue, avec les parties saisies neutralisées. */
export function phrase(annonce: Annonce, langue: Langue): string {
  const textes = TEXTES[langue];

  switch (annonce.genre) {
    case 'creation':
      return textes[annonce.type](annonce.ticketId, neutraliser(annonce.titre), annonce.priorite);
    case 'escalade':
      return textes.escalade(
        annonce.ticketId,
        neutraliser(annonce.niveau),
        neutraliser(annonce.engagement),
      );
    case 'resolution':
      return textes.resolution(annonce.ticketId);
  }
}

/**
 * Le corps de la requête, prêt à partir.
 *
 * `slack` : le format des webhooks entrants de Slack, repris par Mattermost,
 * Rocket.Chat et Discord. Le lien est en clair sur sa propre ligne : chaque
 * messagerie le rend cliquable, sans dépendre de sa syntaxe de lien.
 *
 * `teams` : une carte adaptative, ce qu'attend le modèle « publier dans un
 * canal lorsqu'une requête webhook est reçue » des flux de travail Teams.
 */
export function corps(
  annonce: Annonce,
  options: { format: Format; langue: Langue; webUrl: string },
): string {
  const texte = phrase(annonce, options.langue);
  const lien = lienTicket(options.webUrl, annonce.ticketId);

  if (options.format === 'teams') {
    return JSON.stringify({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [{ type: 'TextBlock', text: texte, wrap: true }],
            actions: [{ type: 'Action.OpenUrl', title: TEXTES[options.langue].ouvrir, url: lien }],
          },
        },
      ],
    });
  }

  return JSON.stringify({ text: `${texte}\n${lien}` });
}
