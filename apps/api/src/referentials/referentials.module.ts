import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReferentialsController } from './referentials.controller.js';
import { ReferentialsService } from './referentials.service.js';

/**
 * Referentiels partages par la saisie.
 *
 * Ils vivent dans leur propre module plutot que dans celui des tickets : les
 * formulaires, les regles et les objets ITIL les lisent tous, et les rattacher
 * a l'un d'eux aurait fait dependre les autres de ce voisin arbitraire.
 */
@Module({
  // `AuthModule` pour la garde de droits : les routes d'ecriture la portent, et
  // une garde dont la dependance manque fait tomber le module entier au montage.
  imports: [AuthModule],
  controllers: [ReferentialsController],
  providers: [ReferentialsService],
  exports: [ReferentialsService],
})
export class ReferentialsModule {}
