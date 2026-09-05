import { definePlugin } from '@tick/plugin-sdk';

/**
 * Plugin de référence.
 *
 * Il n'a pas d'utilité fonctionnelle : il existe pour exercer chaque point du
 * substrat d'extension et servir de test d'intégration permanent. S'il cesse de
 * fonctionner, c'est que le contrat a été rompu.
 */
export default definePlugin({
  async install(context) {
    context.logger.log(`Installation en version ${context.version}.`);
    await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
      'install',
      `version ${context.version}`,
    ]);
  },

  async upgrade(context, versionPrecedente) {
    context.logger.log(`Montée de ${versionPrecedente} vers ${context.version}.`);
    await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
      'upgrade',
      `${versionPrecedente} vers ${context.version}`,
    ]);
  },

  async uninstall(context) {
    // Rien à nettoyer : le schéma du plugin est supprimé juste après. Ce crochet
    // sert aux effets qui vivent ailleurs — fichiers, abonnements distants.
    context.logger.log('Désinstallation.');
    await Promise.resolve();
  },

  register(api) {
    /**
     * Hook synchrone, dans la transaction.
     *
     * Il modifie la charge utile — les espaces superflus disparaissent — et
     * refuse l'opération pour un nom réservé. Le refus annule réellement
     * l'écriture, ce qu'un événement ne pourrait pas faire.
     */
    api.hooks.on('entity.beforeCreate', (payload, context) => {
      const nom = payload.name.trim().replaceAll(/\s+/g, ' ');

      if (nom.toLowerCase() === 'interdit') {
        throw new Error('le nom « interdit » est refusé par le plugin de démonstration');
      }

      if (nom !== payload.name) {
        context.logger.debug(`Nom normalisé : « ${payload.name} » → « ${nom} »`);
      }

      return { ...payload, name: nom };
    });

    /**
     * Même mécanique sur le ticket, apparue avec le SDK 0.2.
     *
     * Le hook s'exécute **avant** le calcul de la priorité : relever l'urgence
     * ici fait suivre la priorité, ce qui ne serait pas le cas si la priorité
     * était figée en amont.
     */
    api.hooks.on('ticket.beforeCreate', (payload, context) => {
      const titre = payload.name.trim().replaceAll(/\s+/g, ' ');

      if (titre.length < 5) {
        throw new Error('un titre de ticket doit faire au moins cinq caractères');
      }

      // Démonstration de l'ordre : un mot-clé dans le titre relève l'urgence,
      // et la priorité recalculée en tient compte.
      const urgent = /\burgent\b/i.test(titre);

      if (urgent && payload.urgency < 5) {
        context.logger.debug(`Urgence relevée pour « ${titre} »`);

        return { ...payload, name: titre, urgency: 5 };
      }

      return { ...payload, name: titre };
    });

    api.events.on('ticket.created', async (payload, context) => {
      await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
        'ticket.created',
        `#${String(payload.id)} ${payload.name} (priorité ${String(payload.priority)})`,
      ]);
    });

    api.events.on('ticket.statusChanged', async (payload, context) => {
      await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
        'ticket.statusChanged',
        `#${String(payload.id)} ${payload.from} vers ${payload.to}`,
      ]);
    });

    /**
     * Événement asynchrone, après le commit.
     *
     * Il écrit dans la table du plugin, dans son propre schéma. Si la création
     * d'entité avait été annulée, cet événement n'aurait jamais été publié.
     */
    api.events.on('entity.created', async (payload, context) => {
      await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
        'entity.created',
        `#${String(payload.id)} ${payload.name} (${payload.path})`,
      ]);
    });

    api.events.on('entity.deleted', async (payload, context) => {
      await context.db.query('INSERT INTO journal (evenement, detail) VALUES ($1, $2)', [
        'entity.deleted',
        `#${String(payload.id)}`,
      ]);
    });

    api.context.logger.log('Enregistré : 2 hooks, 4 abonnements.');
  },
});
