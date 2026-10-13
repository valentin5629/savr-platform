/**
 * M1.5a — frein de débit des écritures des espaces clients (décision Val
 * 2026-10-13) : les deux compteurs, la fenêtre glissante, ce qui est compté.
 * Le branchement dans chaque route est prouvé par
 * tests/api/admin/envoi-immediat-routes.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FENETRE_FREIN_MS,
  MAX_ECRITURES_PAR_ORGANISATION,
  MAX_MODIFICATIONS_PAR_OBJET,
  MESSAGE_FREIN,
  _reinitialiserFreinEcritures,
  freinerEcritureCliente,
  type EcritureCliente,
} from './frein-ecritures-client.js';

const T0 = 1_700_000_000_000;
const ORG = 'org-1';

/** `nombre` écritures à l'instant `quand`, toutes attendues acceptées. */
function accepter(nombre: number, ecriture: EcritureCliente, quand = T0): void {
  for (let i = 0; i < nombre; i++) {
    expect(freinerEcritureCliente(ecriture, quand)).toBeNull();
  }
}

describe('M1.5a / frein de débit des écritures clientes', () => {
  beforeEach(() => {
    _reinitialiserFreinEcritures();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('M1.5a/frein_ecritures_seuils — cent écritures par organisation et dix modifications par objet, par fenêtre de dix minutes', () => {
    // Valeurs décidées par Val le 2026-10-13.
    expect([
      MAX_ECRITURES_PAR_ORGANISATION,
      MAX_MODIFICATIONS_PAR_OBJET,
      FENETRE_FREIN_MS,
    ]).toEqual([100, 10, 10 * 60 * 1000]);
  });

  it('M1.5a/frein_ecritures_par_organisation — la cent-unième écriture de la fenêtre est refusée en 429, une autre organisation ne l’est pas', async () => {
    accepter(100, { organisationId: ORG });

    const refus = freinerEcritureCliente({ organisationId: ORG }, T0);

    expect(refus?.status).toBe(429);
    expect(await refus!.json()).toEqual({ error: MESSAGE_FREIN });
    expect(MESSAGE_FREIN).toBe(
      'Trop de modifications en peu de temps. Réessayez dans quelques minutes.',
    );
    expect(freinerEcritureCliente({ organisationId: 'org-2' }, T0)).toBeNull();
  });

  it('M1.5a/frein_ecritures_par_objet — la onzième modification d’une collecte est refusée ; une autre collecte, ou un événement de même identifiant, ne l’est pas', () => {
    const modification = { collecte: 'col-1' };
    accepter(10, { organisationId: ORG, modification });

    expect(
      freinerEcritureCliente({ organisationId: ORG, modification }, T0)?.status,
    ).toBe(429);
    // Le compteur est celui de l'objet, pas de l'organisation qui le modifie.
    expect(
      freinerEcritureCliente({ organisationId: 'org-2', modification }, T0)
        ?.status,
    ).toBe(429);
    accepter(1, { organisationId: ORG, modification: { collecte: 'col-2' } });
    accepter(1, { organisationId: ORG, modification: { evenement: 'col-1' } });
    // Une écriture sans objet (création, annulation) ne lit pas ce compteur.
    accepter(1, { organisationId: ORG });
  });

  it('M1.5a/frein_ecritures_fenetre_glissante — une écriture sort du compte dix minutes après avoir été acceptée, et l’attente annoncée est celle-là', () => {
    accepter(1, { organisationId: ORG }, T0);
    accepter(99, { organisationId: ORG }, T0 + 60_000);

    // Neuf minutes après la première : encore pleine, il reste une minute.
    const refus = freinerEcritureCliente(
      { organisationId: ORG },
      T0 + 9 * 60_000,
    );
    expect(refus?.status).toBe(429);
    expect(refus!.headers.get('Retry-After')).toBe('60');

    // Une milliseconde avant dix minutes : la première compte encore.
    expect(
      freinerEcritureCliente({ organisationId: ORG }, T0 + FENETRE_FREIN_MS - 1)
        ?.status,
    ).toBe(429);
    // À dix minutes, elle est sortie : une écriture passe, pas deux.
    accepter(1, { organisationId: ORG }, T0 + FENETRE_FREIN_MS);
    expect(
      freinerEcritureCliente({ organisationId: ORG }, T0 + FENETRE_FREIN_MS)
        ?.status,
    ).toBe(429);
  });

  it('M1.5a/frein_ecritures_refus_non_compte — une écriture refusée par un compteur n’est comptée dans aucun des deux', () => {
    const modification = { collecte: 'col-1' };
    accepter(10, { organisationId: ORG, modification });

    // Cinq refus par le compteur de la collecte…
    for (let i = 0; i < 5; i++) {
      expect(
        freinerEcritureCliente({ organisationId: ORG, modification }, T0)
          ?.status,
      ).toBe(429);
    }
    // … n'ont rien pris à l'organisation : il lui reste 90 écritures, pas 85.
    accepter(90, { organisationId: ORG });
    expect(freinerEcritureCliente({ organisationId: ORG }, T0)?.status).toBe(
      429,
    );

    // Et l'inverse : refusée par l'organisation, la modification d'une autre
    // collecte n'entame pas le compteur de cette collecte.
    const autre = { collecte: 'col-2' };
    for (let i = 0; i < 12; i++) {
      expect(
        freinerEcritureCliente({ organisationId: ORG, modification: autre }, T0)
          ?.status,
      ).toBe(429);
    }
    accepter(10, { organisationId: 'org-2', modification: autre });
  });

  it('M1.5a/frein_ecritures_equipe_savr_non_comptee — l’équipe Savr n’est ni freinée ni comptée', () => {
    const support = { organisationId: ORG, equipeSavr: true };
    accepter(250, support);
    accepter(100, { organisationId: ORG });

    // Même organisation au plafond : l'équipe Savr passe toujours.
    accepter(1, support);
    expect(freinerEcritureCliente({ organisationId: ORG }, T0)?.status).toBe(
      429,
    );
  });

  it('un refus est journalisé avec l’organisation et le compteur atteint, sans autre donnée', () => {
    accepter(100, { organisationId: ORG });
    const journal = vi.mocked(console.log);
    journal.mockClear();

    freinerEcritureCliente({ organisationId: ORG }, T0 + 1_000);

    const refus = journal.mock.calls
      .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .find((l) => l.event === 'frein_ecritures_client.refus');
    expect(refus?.level).toBe('warn');
    expect(refus?.payload).toEqual({
      organisation_id: ORG,
      compteur: `organisation:${ORG}`,
      attente_s: 599,
    });
  });

  it('M1.5a/frein_ecritures_cle_active_gardee — un compteur dont les écritures sont acceptées n’est pas oublié tant qu’il sert', () => {
    accepter(1, { organisationId: ORG });

    // Dix mille autres organisations écrivent ; la nôtre aussi, de temps en temps.
    for (let i = 0; i < 10_000; i++) {
      accepter(1, { organisationId: `org-autre-${i}` });
      if (i % 1_000 === 0) accepter(1, { organisationId: ORG });
    }

    // Ses onze écritures sont toujours comptées : il lui en reste 89, pas 100.
    accepter(89, { organisationId: ORG });
    expect(freinerEcritureCliente({ organisationId: ORG }, T0)?.status).toBe(
      429,
    );
  });

  it('M1.5a/frein_ecritures_memoire_bornee — au-delà de dix mille clés suivies, les plus anciennes sont oubliées, jamais un compteur saturé encore sollicité', () => {
    accepter(100, { organisationId: ORG });

    // Dix mille autres organisations écrivent ; l'organisation au plafond
    // continue d'être sollicitée (et refusée) pendant ce temps.
    for (let i = 0; i < 10_000; i++) {
      accepter(1, { organisationId: `org-autre-${i}` });
      if (i % 1_000 === 0) {
        expect(
          freinerEcritureCliente({ organisationId: ORG }, T0)?.status,
        ).toBe(429);
      }
    }

    // Son compteur n'a pas été oublié…
    expect(freinerEcritureCliente({ organisationId: ORG }, T0)?.status).toBe(
      429,
    );
    // … celui de la plus ancienne des autres, si : elle repart de zéro.
    accepter(100, { organisationId: 'org-autre-0' });
  });
});
