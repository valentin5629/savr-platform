import { logger } from '@savr/shared/src/logger/index.js';

import type {
  Collecte,
  ConsumerTag,
  FenetreSync,
  HealthCheckResult,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';

export class ProviderManual implements LogistiqueProvider {
  constructor(private readonly transporteur: Transporteur) {}

  // Consommation d'un event outbox par le provider no-op (dispatch email/téléphone
  // hors plateforme) → log business `outbox.event_consumed` (§07/01, adapter='manual').
  private logConsumed(kind: string): void {
    logger.info('outbox.event_consumed', {
      adapter: 'manual',
      consumer: 'manual',
      kind,
      transporteur_id: this.transporteur.id,
    });
  }

  async dispatchCollecte(
    _collecte: Collecte,
    _rang: number,
  ): Promise<ConsumerTag> {
    this.logConsumed('dispatch');
    return 'manual';
  }

  async updateCollecte(_collecte: Collecte): Promise<ConsumerTag> {
    this.logConsumed('update_collecte');
    return 'manual';
  }

  async cancelCollecte(_collecte: Collecte): Promise<ConsumerTag> {
    this.logConsumed('cancel_collecte');
    return 'manual';
  }

  async updateLieu(_lieu: Lieu): Promise<void> {
    this.logConsumed('update_lieu');
  }

  async sync(_fenetre: FenetreSync): Promise<void> {
    // M1.5b
  }

  async healthCheck(): Promise<HealthCheckResult> {
    // Dispatch email/téléphone hors plateforme : aucun appel distant à sonder.
    return {
      ok: true,
      etat: 'non_applicable',
      message: 'Provider manuel (email/téléphone) — aucun appel distant.',
    };
  }
}
