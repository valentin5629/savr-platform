/**
 * DS « Mise en page des formulaires et filtres » — composants shadcn stylés
 * Savr : Combobox, DateRangePicker, ToggleGroup, FilterBar, filtres en ligne
 * (« Titre  valeur ▾ », décision Val 2026-09-30).
 * Épingle ce qui est régressable : hauteur unique des contrôles (h-11 sm:h-10),
 * sélection simple / multiple du Combobox, période appliquée seulement au clic
 * « Appliquer », réinitialisation visible seulement si un filtre est actif.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { Modal } from '@/components/ui/modal';
import { dateVersIso, isoVersDate } from '@/lib/date-iso';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

const OPTIONS = [
  { value: '', label: 'Tous les lieux' },
  { value: 'a', label: 'Pavillon Gabriel' },
  { value: 'b', label: 'Carreau du Temple' },
];

describe('Combobox', () => {
  it('ds/combobox_hauteur_controle_unique', () => {
    render(<Combobox aria-label="Lieu" options={OPTIONS} value="" />);
    const trigger = screen.getByRole('combobox', { name: 'Lieu' });
    expect(trigger.className).toContain('h-11');
    expect(trigger.className).toContain('sm:h-10');
    // Option vide sélectionnée = placeholder affiché.
    expect(trigger).toHaveTextContent('Sélectionner…');
  });

  it('ds/combobox_simple_emet_la_valeur_et_se_ferme', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        aria-label="Lieu"
        options={OPTIONS}
        value=""
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Lieu' }));
    fireEvent.click(screen.getByRole('option', { name: 'Carreau du Temple' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('ds/combobox_multiple_cumule_et_reste_ouvert', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        multiple
        icon={null}
        aria-label="Statut"
        placeholder="Tous"
        options={OPTIONS.slice(1)}
        value={['a']}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Statut' });
    expect(trigger).toHaveTextContent('Pavillon Gabriel');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Carreau du Temple' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    // « Tous » vide la sélection.
    fireEvent.click(screen.getByRole('option', { name: 'Tous' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('ds/combobox_name_rend_un_champ_de_formulaire', () => {
    const { container } = render(
      <Combobox name="lieu_id" options={OPTIONS} value="a" />,
    );
    expect(
      container.querySelector('input[type="hidden"][name="lieu_id"]'),
    ).toHaveValue('a');
  });
});

describe('DateRangePicker', () => {
  it('ds/periode_affichee_en_un_seul_champ', () => {
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Période' });
    expect(trigger).toHaveTextContent('1 sept. 2026 – 30 sept. 2026');
    expect(trigger.className).toContain('h-11');
  });

  it('ds/periode_effacer_vide_les_deux_bornes', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Période' }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
    expect(onChange).toHaveBeenCalledWith({ from: '', to: '' });
  });

  it('ds/periode_appliquee_seulement_au_clic_appliquer', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        aria-label="Période"
        value={{ from: '2026-09-01', to: '2026-09-30' }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Période' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});

describe('date-iso', () => {
  it('ds/iso_date_aller_retour_sans_decalage_de_fuseau', () => {
    expect(dateVersIso(isoVersDate('2026-03-29'))).toBe('2026-03-29');
    expect(isoVersDate('2026-13-01')).toBeDefined(); // normalisé par Date
    expect(isoVersDate('pas-une-date')).toBeUndefined();
    expect(dateVersIso(undefined)).toBe('');
  });
});

describe('ToggleGroup', () => {
  it('ds/toggle_actif_en_aplat_primary_700', () => {
    render(
      <ToggleGroup type="single" value="zd" aria-label="Type">
        <ToggleGroupItem value="zd">Zéro Déchet</ToggleGroupItem>
        <ToggleGroupItem value="ag">Anti-Gaspi</ToggleGroupItem>
      </ToggleGroup>,
    );
    const actif = screen.getByRole('radio', { name: 'Zéro Déchet' });
    expect(actif).toHaveAttribute('data-state', 'on');
    expect(actif.className).toContain('data-[state=on]:bg-savr-primary-700');
  });
});

describe('FilterBar', () => {
  it('ds/filterbar_reinitialiser_visible_seulement_si_actif', () => {
    const onReset = vi.fn();
    const { rerender } = render(
      <FilterBar
        data-testid="fb"
        count="3 résultats"
        actif={false}
        onReset={onReset}
      >
        <div>champ</div>
      </FilterBar>,
    );
    expect(screen.queryByTestId('fb-reset')).toBeNull();
    expect(screen.getByTestId('fb-count')).toHaveTextContent('3 résultats');
    rerender(
      <FilterBar data-testid="fb" count="3 résultats" actif onReset={onReset}>
        <div>champ</div>
      </FilterBar>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Réinitialiser les filtres' }),
    );
    expect(onReset).toHaveBeenCalled();
  });

  it('ds/filterbar_conteneur_et_ligne_de_filtres', () => {
    render(
      <FilterBar
        data-testid="fb"
        tabs={<div>onglets</div>}
        count={null}
        actif
        onReset={vi.fn()}
      >
        <div>champ</div>
      </FilterBar>,
    );
    const bloc = screen.getByTestId('fb');
    expect(bloc.className).toContain('rounded-savr-xl');
    expect(bloc.className).toContain('border-savr-neutral-200');
    // Filtres en ligne dans le bandeau gris, « Réinitialiser » dans la même ligne.
    const ligne = screen.getByText('champ').parentElement!;
    expect(ligne.className).toContain('bg-savr-neutral-50');
    expect(ligne).toContainElement(screen.getByTestId('fb-reset'));
  });
});

describe('Combobox dans une Modal', () => {
  it('ds/echap_ferme_la_liste_pas_la_modale', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Test" onClose={onClose}>
        <Combobox aria-label="Lieu" options={OPTIONS} value="" />
      </Modal>,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Lieu' }));
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(onClose).not.toHaveBeenCalled();
    // Liste fermée : Échap ferme maintenant la modale.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Filtres en ligne', () => {
  it('ds/filtre_choix_unique_nomme_par_son_titre_valeur_en_texte', () => {
    const onChange = vi.fn();
    render(
      <Combobox
        titre="Statut"
        options={[
          { value: '', label: 'Tous les statuts' },
          { value: 'actif', label: 'Actifs' },
          { value: 'inactif', label: 'Inactifs' },
        ]}
        value="actif"
        onChange={onChange}
      />,
    );
    // role=combobox : nom = titre (aria-labelledby), texte = valeur courante.
    const trigger = screen.getByRole('combobox', { name: 'Statut' });
    expect(trigger).toHaveTextContent('Actifs');
    expect(trigger.className).not.toContain('border-savr-neutral-300');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Inactifs' }));
    expect(onChange).toHaveBeenCalledWith('inactif');
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('ds/filtre_choix_unique_vide_affiche_tous', () => {
    render(<Combobox titre="Lieu" options={OPTIONS} value="" />);
    expect(screen.getByRole('combobox', { name: 'Lieu' })).toHaveTextContent(
      'Tous',
    );
  });

  it('ds/filtre_coches_cumule_et_resume_la_selection', () => {
    const onChange = vi.fn();
    const options = [
      { id: 'M', nom: 'M (500-749)', court: 'M' },
      { id: 'L', nom: 'Pavillon (Paris 8e)' },
      { id: 'XL', nom: 'XL (≥ 1000)', court: 'XL' },
    ];
    const { rerender } = render(
      <FiltreCoches
        label="Taille"
        options={options}
        selected={[]}
        onChange={onChange}
        testid="taille"
      />,
    );
    const trigger = screen.getByTestId('taille');
    expect(trigger).toHaveTextContent('Tous');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('checkbox', { name: 'M (500-749)' }));
    expect(onChange).toHaveBeenLastCalledWith(['M']);
    rerender(
      <FiltreCoches
        label="Taille"
        options={options}
        selected={['M']}
        onChange={onChange}
        testid="taille"
      />,
    );
    // Option unique : libellé court explicite (« M (500-749) » → « M »).
    expect(trigger).toHaveTextContent(/M$/);
    rerender(
      <FiltreCoches
        label="Taille"
        options={options}
        selected={['L']}
        onChange={onChange}
        testid="taille"
      />,
    );
    // Sans libellé court, le nom complet — jamais tronqué à la parenthèse.
    expect(trigger).toHaveTextContent('Pavillon (Paris 8e)');
    rerender(
      <FiltreCoches
        label="Taille"
        options={options}
        selected={['M', 'L']}
        onChange={onChange}
        testid="taille"
      />,
    );
    expect(trigger).toHaveTextContent('2 sélectionnés');
    rerender(
      <FiltreCoches
        label="Taille"
        options={options}
        selected={['M', 'L', 'XL']}
        onChange={onChange}
        testid="taille"
      />,
    );
    // Toutes les options cochées = « Tous ».
    expect(trigger).toHaveTextContent(/Tous$/);
  });

  it('ds/filtre_coches_case_tous_cochee_par_defaut_efface_la_selection', () => {
    const onChange = vi.fn();
    const options = [
      { id: 'a', nom: 'Alpha' },
      { id: 'b', nom: 'Bravo' },
      { id: 'c', nom: 'Charlie' },
    ];
    const { rerender } = render(
      <FiltreCoches
        label="Statut"
        options={options}
        selected={[]}
        onChange={onChange}
        testid="statut"
      />,
    );
    fireEvent.click(screen.getByTestId('statut'));
    // Sans sélection, « Tous » est cochée (= aucun filtre, décision Val
    // 2026-09-30) ; choisir une valeur ne garde que celle-ci.
    expect(screen.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bravo' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    rerender(
      <FiltreCoches
        label="Statut"
        options={options}
        selected={['b']}
        onChange={onChange}
        testid="statut"
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Tous' })).not.toBeChecked();
    // Recocher « Tous » efface la sélection.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tous' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('ds/filtre_coches_option_hors_liste_tout_cocher_n_est_pas_tous', () => {
    // Une valeur cochée que la liste ne proposait pas (lien reçu, option sortie
    // de la liste) : les options ne couvrent pas tout, donc les cocher toutes
    // n'est ni affiché « Tous », ni ramené à une sélection vide.
    const onChange = vi.fn();
    const options = [
      { id: 'a', nom: 'Alpha' },
      { id: 'z', nom: 'Sélectionné', horsListe: true },
    ];
    const { rerender } = render(
      <FiltreCoches
        label="Traiteur"
        options={options}
        selected={['z']}
        onChange={onChange}
        testid="traiteur"
      />,
    );
    fireEvent.click(screen.getByTestId('traiteur'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alpha' }));
    expect(onChange).toHaveBeenLastCalledWith(['z', 'a']);
    rerender(
      <FiltreCoches
        label="Traiteur"
        options={options}
        selected={['z', 'a']}
        onChange={onChange}
        testid="traiteur"
      />,
    );
    expect(screen.getByTestId('traiteur')).toHaveTextContent('2 sélectionnés');
    expect(screen.getByRole('checkbox', { name: 'Tous' })).not.toBeChecked();
  });

  it('ds/filtre_coches_toutes_options_cochees_revient_a_tous', () => {
    const onChange = vi.fn();
    render(
      <FiltreCoches
        label="Statut"
        options={[
          { id: 'a', nom: 'Alpha' },
          { id: 'b', nom: 'Bravo' },
          { id: 'c', nom: 'Charlie' },
        ]}
        selected={['a', 'b']}
        onChange={onChange}
        testid="statut"
      />,
    );
    fireEvent.click(screen.getByTestId('statut'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Charlie' }));
    // La dernière option cochée complète la liste → « Tous » (sélection vide).
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('ds/filtre_coches_recherche_au_dela_de_7_options', () => {
    const options = Array.from({ length: 8 }, (_, i) => ({
      id: `l${i}`,
      nom: i === 3 ? 'Pavillon Élysée' : `Lieu ${i}`,
    }));
    render(
      <FiltreCoches
        label="Lieux"
        options={options}
        selected={[]}
        onChange={() => {}}
        testid="lieux"
      />,
    );
    fireEvent.click(screen.getByTestId('lieux'));
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Rechercher dans Lieux' }),
      { target: { value: 'elysee' } },
    );
    // Recherche insensible aux accents et à la casse.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: 'Pavillon Élysée' }),
    ).toBeInTheDocument();
  });

  it('ds/filtre_recherche_loupe_sans_titre_au_dessus', () => {
    render(<FiltreRecherche value="" onChange={() => {}} />);
    expect(
      screen.getByRole('searchbox', { name: 'Rechercher' }),
    ).toHaveAttribute('placeholder', 'Rechercher…');
  });
});

describe('DateRangePicker — raccourcis + calendrier', () => {
  // Mercredi 30 septembre 2026, midi à Paris.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('ds/periode_filtre_affiche_le_nom_du_raccourci', () => {
    render(
      <DateRangePicker
        titre="Période"
        value={periodeDerniers(12, 'mois')!}
        data-testid="p"
      />,
    );
    expect(screen.getByTestId('p')).toHaveTextContent('12 derniers mois');
  });

  it('ds/periode_raccourci_reste_un_brouillon_jusqu_a_appliquer', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        onChange={onChange}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    const raccourci = screen.getByRole('button', { name: '7 derniers jours' });
    fireEvent.click(raccourci);
    expect(raccourci).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('p-resume')).toHaveTextContent(
      '23 sept. 2026 – 30 sept. 2026',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-09-23',
      to: '2026-09-30',
    });
  });

  it('ds/periode_annuler_n_emet_rien', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        onChange={onChange}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    fireEvent.click(screen.getByRole('button', { name: '30 derniers jours' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ds/periode_derniers_n_unites_hors_aujourd_hui', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        onChange={onChange}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    fireEvent.change(
      screen.getByRole('spinbutton', { name: "Nombre d'unités" }),
      {
        target: { value: '2' },
      },
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Unité' }));
    fireEvent.click(screen.getByRole('option', { name: 'semaines' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: "Inclure aujourd'hui" }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    // Hier (29/09) et 2 semaines avant.
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-09-15',
      to: '2026-09-29',
    });
  });

  it('ds/periode_derniers_n_egal_a_un_raccourci_le_surligne', () => {
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    fireEvent.change(
      screen.getByRole('spinbutton', { name: "Nombre d'unités" }),
      {
        target: { value: '7' },
      },
    );
    expect(
      screen.getByRole('button', { name: '7 derniers jours' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('ds/periode_apres_un_raccourci_deux_clics_font_une_nouvelle_periode', () => {
    const onChange = vi.fn();
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        onChange={onChange}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    fireEvent.click(screen.getByRole('button', { name: '12 derniers mois' }));
    const jour = (iso: string) =>
      document.querySelector(`[data-day="${iso}"] button`) as HTMLElement;
    fireEvent.click(jour('2026-09-01'));
    fireEvent.click(jour('2026-09-15'));
    // La ligne « Derniers N » ne reflète plus le brouillon : elle se vide.
    expect(
      screen.getByRole('spinbutton', { name: "Nombre d'unités" }),
    ).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('ds/periode_derniers_hors_bornes_bloque_appliquer', () => {
    render(
      <DateRangePicker
        titre="Période"
        value={{ from: '', to: '' }}
        data-testid="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p'));
    const n = screen.getByRole('spinbutton', { name: "Nombre d'unités" });
    fireEvent.change(n, { target: { value: '1000' } });
    expect(n).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    fireEvent.change(n, { target: { value: '10' } });
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeEnabled();
  });

  it('ds/periode_mode_champ_sans_raccourcis_ni_ligne_derniers', () => {
    render(
      <DateRangePicker aria-label="Période" value={{ from: '', to: '' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Période' }));
    expect(
      screen.queryByRole('list', { name: 'Raccourcis de période' }),
    ).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});
