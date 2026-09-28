/**
 * M0.6 — Quick-add lieu hors référentiel (BL-P1-BOA-03, §06.01).
 * Extension aux 7 champs avec colonne DB réelle (nom, adresse_acces, code_postal,
 * ville, stationnement, type_vehicule_max, acces_office). « Contact sur place »
 * volontairement absent — divergence _Divergences/BOA-LIEUX_20260702.md (pas de
 * colonne DB correspondante, ni V1 ni DDL cible V2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LieuManuelForm } from './lieu-manuel-form';
import { Modal } from '@/components/ui/modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

describe('M0.6 — quick-add lieu manuel (BL-P1-BOA-03)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — rend les 3 champs optionnels supplémentaires (véhicule max, stationnement, accès office)', () => {
    render(<LieuManuelForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Type de véhicule max/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stationnement/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Accès office/)).toBeInTheDocument();
    // Champ orphelin CDC non implémenté (divergence)
    expect(screen.queryByLabelText(/Contact sur place/)).toBeNull();
  });

  it(
    'M0.6 — envoie les champs optionnels renseignés, omet ceux laissés vides',
    async () => {
      const onSave = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'l-1', nom: 'X', adresse_acces: 'Y' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<LieuManuelForm onSave={onSave} onCancel={vi.fn()} />);

      fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
        target: { value: 'Château de Saint-Cloud' },
      });
      fireEvent.change(screen.getByLabelText(/Adresse d'accès livraison/), {
        target: { value: '1 avenue de Paris' },
      });
      fireEvent.change(screen.getByLabelText(/Code postal/), {
        target: { value: '92210' },
      });
      fireEvent.change(screen.getByLabelText(/Ville/), {
        target: { value: 'Saint-Cloud' },
      });
      fireEvent.change(screen.getByLabelText(/Type de véhicule max/), {
        target: { value: 'fourgon' },
      });
      // stationnement et acces_office laissés vides

      fireEvent.click(screen.getByRole('button', { name: /Ajouter ce lieu/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/programmation/lieux',
      ) as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<
        string,
        unknown
      >;
      expect(body.type_vehicule_max).toBe('fourgon');
      expect(body.stationnement).toBeUndefined();
      expect(body.acces_office).toBeUndefined();
      await waitFor(() => expect(onSave).toHaveBeenCalled(), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M0.6 — choisir une suggestion BAN remplit adresse, code postal et ville, envoyés au POST',
    async () => {
      const onSave = vi.fn();
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url.startsWith('/api/v1/programmation/adresses?')
            ? {
                ok: true,
                json: async () => [
                  {
                    id: '75117_9933_00039',
                    label: '39 Avenue de Wagram 75017 Paris',
                    adresse: '39 Avenue de Wagram',
                    codePostal: '75017',
                    ville: 'Paris',
                  },
                ],
              }
            : { ok: true, json: async () => ({ id: 'l-1', nom: 'X' }) },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      render(<LieuManuelForm onSave={onSave} onCancel={vi.fn()} />);

      fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
        target: { value: 'Salle Wagram' },
      });
      fireEvent.change(screen.getByLabelText(/Adresse d'accès livraison/), {
        target: { value: '39 avenue de wagram' },
      });

      const option = await screen.findByRole(
        'option',
        { name: '39 Avenue de Wagram 75017 Paris' },
        ATTENTE_UI,
      );
      fireEvent.mouseDown(option);

      expect(screen.getByLabelText(/Adresse d'accès livraison/)).toHaveValue(
        '39 Avenue de Wagram',
      );
      expect(screen.getByLabelText(/Code postal/)).toHaveValue('75017');
      expect(screen.getByLabelText(/Ville/)).toHaveValue('Paris');
      expect(screen.queryByRole('listbox')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Ajouter ce lieu/ }));

      await waitFor(() => expect(onSave).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls.find(
        ([url]) => url === '/api/v1/programmation/lieux',
      ) as unknown as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        adresse_acces: '39 Avenue de Wagram',
        code_postal: '75017',
        ville: 'Paris',
      });
    },
    ATTENTE_CAS_MS,
  );

  describe('suggestions BAN — clavier et modale', () => {
    const SUGGESTION = {
      id: '75117_9933_00039',
      label: '39 Avenue de Wagram 75017 Paris',
      adresse: '39 Avenue de Wagram',
      codePostal: '75017',
      ville: 'Paris',
    };
    const stubBan = () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [SUGGESTION],
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };
    const saisir = async () => {
      const champ = screen.getByLabelText(/Adresse d'accès livraison/);
      fireEvent.change(champ, { target: { value: '39 avenue de wagram' } });
      await screen.findByRole('listbox', {}, ATTENTE_UI);
      return champ;
    };

    it(
      'M0.6 — flèche bas + Entrée remplit CP et ville, sans relancer de recherche',
      async () => {
        const fetchMock = stubBan();
        render(<LieuManuelForm onSave={vi.fn()} onCancel={vi.fn()} />);
        const champ = await saisir();

        fireEvent.keyDown(champ, { key: 'ArrowDown' });
        fireEvent.keyDown(champ, { key: 'Enter' });

        expect(champ).toHaveValue('39 Avenue de Wagram');
        expect(screen.getByLabelText(/Code postal/)).toHaveValue('75017');
        expect(screen.getByLabelText(/Ville/)).toHaveValue('Paris');
        // La valeur posée par la sélection ne redéclenche pas le debounce (250 ms).
        await new Promise((r) => setTimeout(r, 400));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Relais serveur uniquement : aucun appel direct navigateur → IGN.
        const [url] = fetchMock.mock.calls[0] as unknown as [string];
        expect(url).toBe(
          '/api/v1/programmation/adresses?q=39%20avenue%20de%20wagram',
        );
        expect(screen.queryByRole('listbox')).toBeNull();
      },
      ATTENTE_CAS_MS,
    );

    it(
      'M0.6 — Échap ferme la liste sans fermer la modale ; quitter le champ la ferme aussi',
      async () => {
        stubBan();
        const onClose = vi.fn();
        render(
          <Modal open onClose={onClose} title="Ajouter un lieu manuellement">
            <LieuManuelForm onSave={vi.fn()} onCancel={vi.fn()} />
          </Modal>,
        );
        const champ = await saisir();

        fireEvent.keyDown(champ, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();

        // Liste fermée : Échap retrouve son rôle normal (fermer la modale).
        fireEvent.keyDown(champ, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.focus(champ);
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        fireEvent.blur(champ);
        expect(screen.queryByRole('listbox')).toBeNull();
      },
      ATTENTE_CAS_MS,
    );
  });
});
