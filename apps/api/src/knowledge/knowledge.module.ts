import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { KnowledgeController, PublicFaqController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * Base de connaissances.
 *
 * Le controleur public et le controleur authentifie partagent le meme service :
 * une seconde implementation « publique » finirait par diverger, et c'est
 * exactement la ou une divergence exposerait ce qui ne devait pas l'etre.
 */
@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController, PublicFaqController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
