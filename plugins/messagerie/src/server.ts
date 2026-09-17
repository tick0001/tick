import { definePlugin, type PluginContext } from '@tick/plugin-sdk';
import { corps, type Annonce, type Format, type Langue } from './messages.js';

/** Au-delà, une ligne du journal des envois n'aide plus à diagnostiquer. */
const RETENTION_JOURS = 30;

/** Réglage qui autorise chaque genre d'annonce. */
const BASCULES: Record<Annonce['genre'], string> = {
  creation: 'creation',
  escalade: 'escalade',
  resolution: 'resolution',
};

/**
 * Un échec qui mérite d'être retenté.
 *
 * Une messagerie indisponible (5xx), qui limite le débit (429), ou qu'on n'a
 * pas pu joindre, répondra peut-être plus tard. Une adresse refusée (4xx) ne
 * répondra pas mieux à la cinquième tentative : l'échec est journalisé, et la
 * file n'est pas sollicitée pour rien.
 */
function aRetenter(statut: number | null): boolean {
  return statut === null || statut === 429 || statut >= 500;
}

/**
 * Annonce un évènement dans le canal de l'entité, si elle en a un.
 *
 * Tout se lit dans les réglages, par entité et avec héritage : une filiale sans
 * webhook utilise celui de la racine, et une filiale qui a le sien l'utilise
 * pour elle et sa descendance.
 *
 * Exporté pour être éprouvé sans monter le serveur.
 */
export async function annoncer(
  context: PluginContext,
  entiteId: number,
  annonce: Annonce,
): Promise<void> {
  const reglage = (cle: string) => context.settings.get(cle, { entityId: entiteId });

  const webhook = await reglage('webhook');

  if (typeof webhook !== 'string' || webhook.length === 0) return;
  if ((await reglage(BASCULES[annonce.genre])) !== true) return;

  if (annonce.genre === 'creation') {
    const minimum = Number((await reglage('priorite_minimale')) ?? 1);

    if (annonce.priorite < minimum) return;
  }

  const format = ((await reglage('format')) ?? 'slack') as Format;
  const langue = ((await context.settings.get('langue')) ?? 'fr') as Langue;

  let statut: number | null = null;
  let erreur: string | null = null;

  try {
    const reponse = await context.http.request(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corps(annonce, { format, langue, webUrl: context.instance.webUrl }),
    });

    statut = reponse.status;

    if (statut < 200 || statut >= 300) {
      erreur = reponse.body.slice(0, 500) || `HTTP ${String(statut)}`;
    }
  } catch (echec) {
    // Le message vient du client de l'instance, qui ne cite jamais l'adresse
    // complète : le jeton du webhook n'atterrit pas dans le journal.
    erreur = echec instanceof Error ? echec.message : String(echec);
  }

  await context.db.query(
    'INSERT INTO envois (evenement, ticket_id, entite_id, statut, erreur) VALUES ($1, $2, $3, $4, $5)',
    [annonce.genre, annonce.ticketId, entiteId, statut, erreur],
  );
  await context.db.query(
    `DELETE FROM envois WHERE envoye_le < now() - interval '${String(RETENTION_JOURS)} days'`,
  );

  if (erreur !== null) {
    const message = `Annonce du ticket #${String(annonce.ticketId)} non délivrée (${
      statut === null ? 'sans réponse' : `HTTP ${String(statut)}`
    }) : ${erreur}`;

    if (!aRetenter(statut)) {
      context.logger.warn(message);

      return;
    }

    // Lever rend la main à la file, qui retentera. Seul cet abonné sera
    // rappelé : les autres, notifications du cœur comprises, ne le sont pas.
    throw new Error(message);
  }
}

export default definePlugin({
  install(context) {
    context.logger.log(
      'Installé. Renseignez l’adresse du webhook dans les réglages de l’extension, ' +
        'sur la racine ou sur une entité.',
    );
  },

  register(api) {
    api.events.on('ticket.created', (evenement, context) =>
      annoncer(context, evenement.entityId, {
        genre: 'creation',
        ticketId: evenement.id,
        titre: evenement.name,
        priorite: evenement.priority,
        type: evenement.type,
      }),
    );

    api.events.on('ticket.escalated', (evenement, context) =>
      annoncer(context, evenement.entityId, {
        genre: 'escalade',
        ticketId: evenement.id,
        niveau: evenement.levelName,
        engagement: evenement.agreementName,
      }),
    );

    api.events.on('ticket.solved', (evenement, context) =>
      annoncer(context, evenement.entityId, { genre: 'resolution', ticketId: evenement.id }),
    );
  },
});
