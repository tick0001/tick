import { Controller, Get } from '@nestjs/common';
import type { InstanceInfo } from '@tick/contracts';
import { loadEnv } from '../config/env.js';

/**
 * Ce que l'instance dit d'elle-meme avant toute authentification.
 *
 * Sous `public/`, comme la FAQ et les enquetes de satisfaction : la convention
 * du depot veut que le prefixe annonce l'absence de garde, plutot que de
 * laisser le lecteur deduire d'un `@UseGuards` manquant s'il s'agit d'un choix
 * ou d'un oubli.
 *
 * Rien de sensible n'y transite. Le message est ecrit par l'exploitant dans sa
 * configuration, et il est deja destine a etre lu par quiconque atteint
 * l'ecran de connexion.
 */
@Controller('public/instance')
export class InstanceController {
  @Get()
  info(): InstanceInfo {
    // `||` et non `??` : le schema applique `trim()`, si bien qu'un message
    // fait d'espaces arrive ici en chaine vide plutot qu'en `undefined`. Les
    // deux cas veulent dire « rien a dire », et le client ne doit pas avoir a
    // les distinguer.
    return { banner: loadEnv().LOGIN_BANNER || null };
  }
}
