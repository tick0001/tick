import { Controller, Get } from '@nestjs/common';
import type { Health } from '@tick/contracts';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): Health {
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}
