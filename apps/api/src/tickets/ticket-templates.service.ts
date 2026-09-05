import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateTicket, SaveTicketTemplate, TicketTemplate } from '@tick/contracts';
import { sql, ticketTemplateFields, ticketTemplates } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';

/**
 * Champs d'un ticket qu'un gabarit peut piloter.
 *
 * Liste fermée, et c'est délibéré : un gabarit est une donnée, et accepter un
 * nom de champ arbitraire reviendrait à laisser écrire n'importe quelle colonne
 * à la création. Les champs calculés — priorité, dates, délais — en sont
 * volontairement absents.
 */
export const TEMPLATE_FIELDS = [
  'name',
  'content',
  'type',
  'urgency',
  'impact',
  'categoryId',
  'requestSourceId',
  'locationId',
] as const;

export type TemplateField = (typeof TEMPLATE_FIELDS)[number];

function isTemplateField(valeur: string): valeur is TemplateField {
  return (TEMPLATE_FIELDS as readonly string[]).includes(valeur);
}

interface TemplateRow extends Record<string, unknown> {
  id: number;
  name: string;
  comment: string | null;
  isRecursive: boolean;
  entityId: number;
  entityName: string;
  field: string | null;
  kind: 'predefined' | 'mandatory' | 'hidden' | null;
  value: string | null;
}

@Injectable()
export class TicketTemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly entities: EntitiesService,
  ) {}

  async list(): Promise<TicketTemplate[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TemplateRow>(sql`
        SELECT m.id, m.name, m.comment, m.is_recursive AS "isRecursive",
               m.entity_id AS "entityId", e.name AS "entityName",
               f.field, f.kind, f.value
          FROM ticket_templates m
          JOIN entities e ON e.id = m.entity_id
          LEFT JOIN ticket_template_fields f ON f.template_id = m.id
         WHERE m.deleted_at IS NULL
         ORDER BY m.name, f.field
      `);

      return resultat.rows;
    });

    return this.assemble(rows);
  }

  async findById(id: number): Promise<TicketTemplate> {
    const modeles = (await this.list()).filter((modele) => modele.id === id);
    const modele = modeles[0];

    if (!modele) throw new NotFoundException('Gabarit introuvable dans ce perimetre.');

    return modele;
  }

  /**
   * Gabarit à appliquer : celui demandé, sinon celui de l'entité.
   *
   * Le gabarit par défaut suit l'héritage de configuration : une sous-entité
   * qui n'en déclare pas reprend celui de son parent.
   */
  async resolve(explicite: number | null | undefined): Promise<TicketTemplate | null> {
    if (explicite) return this.findById(explicite);

    const defaut = await this.entities.resolveSetting(
      requireContext().entityId,
      'defaultTicketTemplateId',
    );

    if (typeof defaut !== 'number') return null;

    return this.findById(defaut).catch(() => null);
  }

  /**
   * Applique les valeurs préremplies aux champs absents de la saisie.
   *
   * Absents, et non vides : un champ explicitement vidé par l'utilisateur ne
   * doit pas se voir réattribuer la valeur du gabarit.
   */
  applyDefaults(modele: TicketTemplate | null, input: CreateTicket): CreateTicket {
    if (!modele) return input;

    const enrichi: Record<string, unknown> = { ...input };

    for (const [champ, valeur] of Object.entries(modele.predefined)) {
      if (!isTemplateField(champ)) continue;
      if (enrichi[champ] !== undefined && enrichi[champ] !== null && enrichi[champ] !== '') {
        continue;
      }

      enrichi[champ] = valeur;
    }

    return enrichi as CreateTicket;
  }

  /** Refuse la création si un champ obligatoire du gabarit est vide. */
  assertMandatory(modele: TicketTemplate | null, input: CreateTicket): void {
    if (!modele) return;

    const manquants = modele.mandatory.filter((champ) => {
      if (!isTemplateField(champ)) return false;

      const valeur = (input as Record<string, unknown>)[champ];

      return valeur === undefined || valeur === null || valeur === '';
    });

    if (manquants.length > 0) {
      throw new BadRequestException(
        `Le gabarit « ${modele.name} » rend obligatoire : ${manquants.join(', ')}.`,
      );
    }
  }

  async save(input: SaveTicketTemplate, id?: number): Promise<TicketTemplate> {
    const context = requireContext();

    const inconnus = input.fields.map((f) => f.field).filter((champ) => !isTemplateField(champ));

    if (inconnus.length > 0) {
      throw new BadRequestException(`Champs inconnus dans le gabarit : ${inconnus.join(', ')}.`);
    }

    const templateId = await this.db.asUser(async (tx) => {
      let cible = id;

      if (cible) {
        await tx.execute(sql`
          UPDATE ticket_templates
             SET name = ${input.name}, comment = ${input.comment ?? null},
                 is_recursive = ${input.isRecursive}, updated_at = now()
           WHERE id = ${cible}
        `);
      } else {
        const [ligne] = await tx
          .insert(ticketTemplates)
          .values({
            entityId: context.entityId,
            entityPath: 'temporaire',
            name: input.name,
            comment: input.comment ?? null,
            isRecursive: input.isRecursive,
          })
          .returning({ id: ticketTemplates.id });

        if (!ligne) throw new BadRequestException('Creation impossible dans ce perimetre.');
        cible = ligne.id;
      }

      await tx.execute(sql`DELETE FROM ticket_template_fields WHERE template_id = ${cible}`);

      if (input.fields.length > 0) {
        await tx.insert(ticketTemplateFields).values(
          input.fields.map((champ) => ({
            templateId: cible,
            field: champ.field,
            kind: champ.kind,
            value:
              champ.kind === 'predefined' && champ.value !== undefined
                ? JSON.stringify(champ.value)
                : null,
          })),
        );
      }

      return cible;
    });

    return this.findById(templateId);
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser((tx) =>
      tx.execute(sql`UPDATE ticket_templates SET deleted_at = now() WHERE id = ${id}`),
    );
  }

  /** Reconstitue les gabarits depuis les lignes aplaties par la jointure. */
  private assemble(rows: readonly TemplateRow[]): TicketTemplate[] {
    const modeles = new Map<number, TicketTemplate>();

    for (const row of rows) {
      let modele = modeles.get(row.id);

      if (!modele) {
        modele = {
          id: row.id,
          name: row.name,
          comment: row.comment,
          entity: { id: row.entityId, name: row.entityName },
          isRecursive: row.isRecursive,
          predefined: {},
          mandatory: [],
          hidden: [],
        };
        modeles.set(row.id, modele);
      }

      if (!row.field || !row.kind) continue;

      if (row.kind === 'predefined') {
        modele.predefined[row.field] = row.value === null ? null : this.parse(row.value);
      } else if (row.kind === 'mandatory') {
        modele.mandatory.push(row.field);
      } else {
        modele.hidden.push(row.field);
      }
    }

    return [...modeles.values()];
  }

  /** Une valeur illisible vaut absence : un gabarit corrompu ne bloque rien. */
  private parse(brut: string): unknown {
    try {
      return JSON.parse(brut);
    } catch {
      return brut;
    }
  }
}
