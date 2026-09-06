import { Injectable, Logger } from '@nestjs/common';

export interface RegisteredWidget {
  /** Clé du widget : `core.<nom>`, ou `<plugin>.<nom>` pour une extension. */
  kind: string;
  /** Clé de traduction, résolue au moment de servir le catalogue. */
  labelKey: string;
  descriptionKey: string;
  /** Plugin déclarant, pour retirer ses widgets à la désactivation. */
  pluginId?: string;
}

/**
 * Widgets du cœur.
 *
 * Volontairement peu nombreux : chacun répond à une question qu'un responsable
 * de service pose réellement — combien, à quel rythme, chez qui, et pour quel
 * ressenti. Multiplier les variantes d'un même compte n'aide personne à décider.
 */
const CORE: readonly RegisteredWidget[] = [
  {
    kind: 'core.counts',
    labelKey: 'statistiques.widgets.counts',
    descriptionKey: 'statistiques.widgets.countsAide',
  },
  {
    kind: 'core.trend',
    labelKey: 'statistiques.widgets.trend',
    descriptionKey: 'statistiques.widgets.trendAide',
  },
  {
    kind: 'core.breakdown',
    labelKey: 'statistiques.widgets.breakdown',
    descriptionKey: 'statistiques.widgets.breakdownAide',
  },
  {
    kind: 'core.sla',
    labelKey: 'statistiques.widgets.sla',
    descriptionKey: 'statistiques.widgets.slaAide',
  },
  {
    kind: 'core.satisfaction',
    labelKey: 'statistiques.widgets.satisfaction',
    descriptionKey: 'statistiques.widgets.satisfactionAide',
  },
];

/**
 * Registre des widgets de tableau de bord.
 *
 * Même dispositif que le registre des champs de recherche, et pour la même
 * raison : ce qu'un tableau de bord enregistre est une **clé**, pas du code. Un
 * widget dont le plugin a été désactivé disparaît alors du catalogue, mais la
 * ligne enregistrée survit — réactiver le plugin fait revenir le contenu, là où
 * une suppression en cascade aurait perdu la composition du tableau.
 */
@Injectable()
export class WidgetRegistry {
  private readonly logger = new Logger(WidgetRegistry.name);
  private readonly widgets = new Map<string, RegisteredWidget>();

  constructor() {
    for (const widget of CORE) this.widgets.set(widget.kind, widget);
  }

  register(widget: RegisteredWidget): void {
    if (this.widgets.has(widget.kind)) {
      this.logger.warn(`Widget deja declare, ignore : ${widget.kind}`);

      return;
    }

    this.widgets.set(widget.kind, widget);
  }

  /** Retire les widgets d'un plugin. Appelé à sa désactivation. */
  unregisterPlugin(pluginId: string): void {
    for (const [kind, widget] of this.widgets) {
      if (widget.pluginId === pluginId) this.widgets.delete(kind);
    }
  }

  list(): RegisteredWidget[] {
    return [...this.widgets.values()];
  }

  has(kind: string): boolean {
    return this.widgets.has(kind);
  }
}
