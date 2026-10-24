/**
 * M1.2 — Carte d'une collecte (refonte du formulaire, lot B2 ; §06.01 § 3.a),
 * utilisée par le formulaire de programmation et par « Ajouter une collecte ».
 * Elle remplace le sous-bloc de l'ancienne étape 3 et en garde les règles.
 * Décisions Val 2026-10-16 : sans pack actif (ou sans crédit), la collecte AG est
 * facturée à l'unité — une information, jamais une erreur ; à moins de 24 h de
 * la collecte, on demande d'appeler l'équipe Savr (ex-alerte 48 h).
 * Décisions Val 2026-10-22 : les cartes autres que la collecte n°1 en reprennent
 * les champs (C5) ; deux collectes du même type au même moment déclenchent un
 * avertissement non bloquant (C4).
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CarteCollecte } from './carte-collecte';
import {
  carteVide,
  paxSaisiValide,
  type CarteSaisie,
} from '@/lib/programmation/cartes-saisie';
import type { PackInfo } from './use-pack-ag';

const INFO =
  "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";
const REPRISE = /reprennent ceux de la collecte n°1/;
const DOUBLON =
  "Pour un gros volume, une seule collecte suffit : l'équipe Savr fixe le nombre de camions.";

function rendre({
  carte = {},
  suffixe = 'zd-1',
  estModele = true,
  pack,
  doublon = false,
}: {
  carte?: Partial<CarteSaisie>;
  suffixe?: string;
  estModele?: boolean;
  pack?: PackInfo | null;
  doublon?: boolean;
} = {}) {
  const type = carte.type ?? 'zd';
  render(
    <CarteCollecte
      carte={{ ...carteVide(type), ...carte }}
      libelle="Collecte de test"
      suffixe={suffixe}
      estModele={estModele}
      typesEvenements={[{ id: 'te-1', libelle: 'Repas assis' }]}
      pack={pack}
      doublon={doublon}
      onChange={vi.fn()}
      onAjouterContact={vi.fn()}
    />,
  );
}

describe('M1.2 — sous-bloc AG : état du pack (facturation à l’unité sans pack)', () => {
  const rendreAg = (pack: PackInfo) =>
    rendre({ carte: { type: 'ag' }, suffixe: 'ag-1', pack });

  it('aucun pack actif : information « facturée à l’unité », jamais une erreur', () => {
    rendreAg({ pack_actif: false });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('pack actif avec crédits : jauge des crédits, aucune information', () => {
    rendreAg({ pack_actif: true, credits_initiaux: 10, credits_restants: 3 });

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.queryByText(INFO)).toBeNull();
  });

  it('pack actif sans crédit restant : même information que sans pack', () => {
    rendreAg({ pack_actif: true, credits_initiaux: 10, credits_restants: 0 });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('carte Zéro Déchet : aucun état de pack, même si un pack est passé', () => {
    rendre({ pack: { pack_actif: false } });

    expect(screen.queryByText(INFO)).toBeNull();
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
    rendre({ carte: { date_collecte: date, heure_collecte: heure } });
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

describe('M1.2/pax_par_collecte — paxSaisiValide : entier de 1 à 100 000 (plafond métier)', () => {
  it.each(['1', '80', ' 80 ', '100000'])('accepte « %s »', (v) => {
    expect(paxSaisiValide(v)).toBe(true);
  });

  it.each(['', '0', '-5', '12.5', '1e3', 'abc', '100001'])(
    'refuse « %s »',
    (v) => {
      expect(paxSaisiValide(v)).toBe(false);
    },
  );
});

describe('M1.2 — carte d’une collecte : identifiants, reprise de la collecte n°1, doublon', () => {
  it('identifiants des champs suffixés par la carte, uniques dans la page', () => {
    rendre({ suffixe: 'zd-1' });
    rendre({ carte: { type: 'ag' }, suffixe: 'ag-2', estModele: false });

    const zd = screen.getByTestId('carte-zd-1');
    const ag = screen.getByTestId('carte-ag-2');
    for (const [carte, suffixe] of [
      [zd, 'zd-1'],
      [ag, 'ag-2'],
    ] as const) {
      expect(within(carte).getByTestId(`date-${suffixe}`)).toBeInTheDocument();
      expect(within(carte).getByTestId(`heure-${suffixe}`)).toBeInTheDocument();
      expect(within(carte).getByLabelText(/Nombre de convives/)).toBe(
        within(carte).getByTestId(`pax-${suffixe}`),
      );
      expect(carte.querySelector(`#type-evenement-${suffixe}`)).not.toBeNull();
      expect(
        within(carte).getByLabelText(/Informations supplémentaires/),
      ).toHaveAttribute('id', `infos-${suffixe}`);
    }
  });

  it('collecte n°1 : aucune mention de reprise', () => {
    rendre({ estModele: true });
    expect(screen.queryByText(REPRISE)).toBeNull();
  });

  it('autre carte : convives, type d’événement, contacts et informations reprennent ceux de la collecte n°1', () => {
    rendre({ suffixe: 'zd-2', estModele: false });
    expect(screen.getByText(REPRISE)).toBeInTheDocument();
  });

  it('même type, même date et même heure qu’une autre collecte : avertissement non bloquant', () => {
    rendre({ doublon: true });

    expect(screen.getByRole('status')).toHaveTextContent(DOUBLON);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sans doublon : aucun avertissement', () => {
    rendre({ doublon: false });
    expect(screen.queryByText(DOUBLON)).toBeNull();
  });
});
