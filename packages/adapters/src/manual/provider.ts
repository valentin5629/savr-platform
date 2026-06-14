import type {
  Collecte,
  FenetreSync,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';

export class ProviderManual implements LogistiqueProvider {
  constructor(private readonly transporteur: Transporteur) {}

  async dispatchCollecte(_collecte: Collecte, _rang: number): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'platform',
        event: 'provider_manual.dispatch',
        consumer: 'manual',
        transporteur_id: this.transporteur.id,
      }),
    );
  }

  async updateCollecte(_collecte: Collecte): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'platform',
        event: 'provider_manual.update_collecte',
        consumer: 'manual',
        transporteur_id: this.transporteur.id,
      }),
    );
  }

  async cancelCollecte(_collecte: Collecte): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'platform',
        event: 'provider_manual.cancel_collecte',
        consumer: 'manual',
        transporteur_id: this.transporteur.id,
      }),
    );
  }

  async updateLieu(_lieu: Lieu): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'platform',
        event: 'provider_manual.update_lieu',
        consumer: 'manual',
        transporteur_id: this.transporteur.id,
      }),
    );
  }

  async sync(_fenetre: FenetreSync): Promise<void> {
    // M1.5b
  }
}
