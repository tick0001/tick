import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validation des entrees par schema Zod.
 *
 * Zod est deja le langage des contrats partages avec l'interface et les plugins
 * (@tick/contracts) : y ajouter class-validator ferait vivre deux descriptions
 * concurrentes de la meme donnee, qui divergeraient.
 *
 * Usage : @Body(new ZodValidationPipe(creerTicketSchema)) corps: CreerTicket
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  /**
   * Le schema est public a dessein.
   *
   * C'est lui que le generateur OpenAPI relit pour decrire la route. La
   * documentation se deduit ainsi de ce que le code **verifie reellement**,
   * plutot que d'une description tenue en parallele — qui aurait commence a
   * mentir au premier champ ajoute.
   */
  constructor(public readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Donnees invalides.',
        issues: result.error.issues.map((issue) => ({
          chemin: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}
