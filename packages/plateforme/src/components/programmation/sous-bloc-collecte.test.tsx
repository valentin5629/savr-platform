/**
 * M1.2 — Sous-bloc de l'étape 3 du formulaire de programmation.
 * Décisions Val 2026-10-16 : sans pack actif (ou sans crédit), la collecte AG est
 * facturée à l'unité — une information, jamais une erreur ; à moins de 24 h de
 * la collecte, on demande d'appeler l'équipe Savr (ex-alerte 48 h).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SousBlocCollecte } from './sous-bloc-collecte';

const INFO =
  "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";

const donnees = {
  type: 'ag' as const,
  date_collecte: '',
  heure_collecte: '',
  informations_supplementaires: '',
};

function rendre(pack: {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_restants?: number;
}) {
  render(
    <SousBlocCollecte
      type="ag"
      data={donnees}
      onChange={vi.fn()}
      pack={pack}
    />,
  );
}

describe('M1.2 — sous-bloc AG : état du pack (facturation à l’unité sans pack)', () => {
  it('aucun pack actif : information « facturée à l’unité », jamais une erreur', () => {
    rendre({ pack_actif: false });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('pack actif avec crédits : jauge des crédits, aucune information', () => {
    rendre({ pack_actif: true, credits_initiaux: 10, credits_restants: 3 });

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.queryByText(INFO)).toBeNull();
  });

  it('pack actif sans crédit restant : même information que sans pack', () => {
    rendre({ pack_actif: true, credits_initiaux: 10, credits_restants: 0 });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('M1.2 / formulaire_simplifie — alerte programmation à moins de 24 h', () => {
  // Texte propre du message ; le numéro est dans le lien qu'il contient.
  const MESSAGE =
    /^Programmation à moins de 24h — Nous vous demandons de nous appeler pour valider la faisabilité —$/;

  afterEach(() => vi.useRealTimers());

  function rendreA(maintenant: string, date: string, heure: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(maintenant));
    render(
      <SousBlocCollecte
        type="zd"
        data={{
          type: 'zd',
          date_collecte: date,
          heure_collecte: heure,
          informations_supplementaires: '',
        }}
        onChange={vi.fn()}
      />,
    );
  }

  // 2026-10-16 08:00 UTC = 10:00 à Paris (heure d'été).
  const MAINTENANT = '2026-10-16T08:00:00Z';

  it('collecte dans moins de 24 h : message et numéro à appeler, cliquable', () => {
    rendreA(MAINTENANT, '2026-10-17', '08:30');

    expect(screen.getByText(MESSAGE)).toHaveTextContent(
      /faisabilité — 07 61 91 29 97$/,
    );
    expect(
      screen.getByRole('link', { name: '07 61 91 29 97' }),
    ).toHaveAttribute('href', 'tel:0761912997');
    expect(screen.queryByText(/48h/)).toBeNull();
  });

  it('collecte dans plus de 24 h, même le lendemain : aucun message', () => {
    rendreA(MAINTENANT, '2026-10-17', '11:00');

    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('warning_24h_borne — à 23 h 59 de la collecte : message', () => {
    rendreA(MAINTENANT, '2026-10-17', '09:59');
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it('warning_24h_borne — à 24 h 01 de la collecte : aucun message', () => {
    rendreA(MAINTENANT, '2026-10-17', '10:01');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('heure non choisie : message seulement pour une collecte le jour même', () => {
    rendreA(MAINTENANT, '2026-10-16', '');
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it('heure non choisie, collecte le lendemain : aucun message', () => {
    rendreA(MAINTENANT, '2026-10-17', '');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
