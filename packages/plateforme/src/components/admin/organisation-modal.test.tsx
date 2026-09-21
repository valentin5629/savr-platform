/**
 * §06.06 liste Clients — modale « Nouvelle organisation » (ajout CDC 2026-09-16).
 * 7 champs = allowlist de POST /api/v1/admin/organisations ; obligatoires :
 * nom, raison sociale, type, email principal. Aucun champ admin-only ni système.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Espion AUTOUR de l'implémentation réelle : prouve que la modale délègue au
// helper partagé avec POST/PATCH /admin/organisations (pas une copie locale).
vi.mock('@/lib/siret-organisation', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('@/lib/siret-organisation')>();
  return {
    ...reel,
    normaliserSiretOrganisation: vi.fn(reel.normaliserSiretOrganisation),
  };
});
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

import { OrganisationModal } from '@/components/admin/organisation-modal';
import * as siretOrganisation from '@/lib/siret-organisation';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

function renderModal(
  props: Partial<React.ComponentProps<typeof OrganisationModal>> = {},
) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <OrganisationModal
      open
      onClose={onClose}
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onClose, onCreated };
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^Nom/), {
    target: { value: '  Fleur de Mets  ' },
  });
  fireEvent.change(screen.getByLabelText(/^Raison sociale/), {
    target: { value: 'Fleur de Mets SAS' },
  });
  fireEvent.change(screen.getByLabelText(/^Type/), {
    target: { value: 'traiteur' },
  });
  fireEvent.change(screen.getByLabelText(/^Email principal/), {
    target: { value: 'contact@fleurdemets.fr' },
  });
}

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: /Créer l.organisation/ }));

describe('M1.1b — Modale Nouvelle organisation (§06.06)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('titre « Nouvelle organisation » et exactement les 7 champs de l’allowlist', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Nouvelle organisation'),
    ).toBeInTheDocument();
    const ids = Array.from(
      dialog.querySelectorAll<HTMLElement>('input, select, textarea'),
    )
      .map((el) => el.id)
      .sort();
    expect(ids).toEqual(
      [
        'om_adresse',
        'om_email_principal',
        'om_nom',
        'om_raison_sociale',
        'om_siret',
        'om_telephone',
        'om_type',
      ].sort(),
    );
    // Les 4 types de l'enum organisation_type, aucun autre.
    const options = Array.from(
      (screen.getByLabelText(/^Type/) as HTMLSelectElement).options,
    )
      .map((o) => o.value)
      .filter(Boolean);
    expect(options).toEqual([
      'traiteur',
      'agence',
      'gestionnaire_lieux',
      'client_organisateur',
    ]);
  });

  it(
    'bloque la soumission tant que nom, raison sociale, type et email manquent',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderModal();

      submit();

      expect(
        await screen.findByText('Nom obligatoire', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Raison sociale obligatoire'),
      ).toBeInTheDocument();
      expect(screen.getByText('Type obligatoire')).toBeInTheDocument();
      expect(
        screen.getByText('Email principal obligatoire'),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refuse un SIRET renseigné qui ne fait pas 14 chiffres',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderModal();

      fillRequired();
      fireEvent.change(screen.getByLabelText(/^SIRET/), {
        target: { value: '1234' },
      });
      submit();

      expect(
        await screen.findByText('SIRET : 14 chiffres', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'délègue le contrôle SIRET au helper serveur : son verdict fait foi',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      // 14 chiffres, valide pour une regex locale — refusé ici par le helper.
      vi.mocked(
        siretOrganisation.normaliserSiretOrganisation,
      ).mockReturnValueOnce({
        valide: false,
      });
      renderModal();

      fillRequired();
      fireEvent.change(screen.getByLabelText(/^SIRET/), {
        target: { value: '43219876500012' },
      });
      submit();

      expect(
        await screen.findByText('SIRET : 14 chiffres', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        siretOrganisation.normaliserSiretOrganisation,
      ).toHaveBeenCalledWith('43219876500012');
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'POST les champs saisis (trimés), omet les optionnels vides, puis notifie et ferme',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'org-new' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const { onClose, onCreated } = renderModal();

      fillRequired();
      fireEvent.change(screen.getByLabelText(/^SIRET/), {
        target: { value: '432 198 765 00012' },
      });
      submit();

      await waitFor(
        () => expect(onCreated).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      expect(onClose).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/v1/admin/organisations');
      expect(init.method).toBe('POST');
      // Ensemble EXACT : téléphone et adresse vides ne partent pas.
      expect(JSON.parse(init.body as string)).toEqual({
        nom: 'Fleur de Mets',
        raison_sociale: 'Fleur de Mets SAS',
        type: 'traiteur',
        siret: '43219876500012',
        email_principal: 'contact@fleurdemets.fr',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'n’envoie jamais de colonne hors allowlist, même tous champs remplis',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'org-new' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      const { onCreated } = renderModal();

      fillRequired();
      fireEvent.change(screen.getByLabelText(/^SIRET/), {
        target: { value: '43219876500012' },
      });
      fireEvent.change(screen.getByLabelText(/^Téléphone/), {
        target: { value: '0102030405' },
      });
      fireEvent.change(screen.getByLabelText(/^Adresse/), {
        target: { value: '1 rue de Paris' },
      });
      submit();

      await waitFor(() => expect(onCreated).toHaveBeenCalled(), ATTENTE_UI);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(Object.keys(JSON.parse(init.body as string)).sort()).toEqual(
        [
          'adresse',
          'email_principal',
          'nom',
          'raison_sociale',
          'siret',
          'telephone',
          'type',
        ].sort(),
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'affiche l’erreur serveur et reste ouverte si la création échoue',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'type invalide' }),
        }),
      );
      const { onClose, onCreated } = renderModal();

      fillRequired();
      submit();

      expect(
        await screen.findByText('type invalide', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    ['fetch rejeté (réseau)', () => Promise.reject(new Error('offline'))],
    [
      'erreur au corps illisible',
      () =>
        Promise.resolve({
          ok: false,
          json: async () => {
            throw new SyntaxError('pas du JSON');
          },
        }),
    ],
  ])(
    'message neutre et modale ouverte si %s',
    async (_cas, reponse) => {
      vi.stubGlobal('fetch', vi.fn(reponse));
      const { onClose, onCreated } = renderModal();

      fillRequired();
      submit();

      expect(
        await screen.findByText(
          'Erreur lors de la création',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'création réussie même si le corps de succès est illisible',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => {
            throw new SyntaxError('pas du JSON');
          },
        }),
      );
      const { onClose, onCreated } = renderModal();

      fillRequired();
      submit();

      await waitFor(
        () => expect(onCreated).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'pendant l’envoi, Échap ne ferme pas la modale',
    async () => {
      let resoudre: (v: unknown) => void = () => {};
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise((r) => (resoudre = r))),
      );
      const { onClose } = renderModal();

      fillRequired();
      submit();
      expect(
        await screen.findByRole('button', { name: 'Création…' }, ATTENTE_UI),
      ).toBeDisabled();

      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
      expect(onClose).not.toHaveBeenCalled();

      resoudre({ ok: true, json: async () => ({}) });
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'à la réouverture, le formulaire est vierge',
    async () => {
      const props = { onClose: vi.fn(), onCreated: vi.fn() };
      const { rerender } = render(<OrganisationModal open {...props} />);
      fireEvent.change(screen.getByLabelText(/^Nom/), {
        target: { value: 'Brouillon' },
      });
      rerender(<OrganisationModal open={false} {...props} />);
      rerender(<OrganisationModal open {...props} />);
      expect(
        (await screen.findByLabelText(
          /^Nom/,
          undefined,
          ATTENTE_UI,
        )) as HTMLInputElement,
      ).toHaveValue('');
    },
    ATTENTE_CAS_MS,
  );
});
