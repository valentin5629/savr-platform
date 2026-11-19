/**
 * M5.2 — transformation des collectes et des packs, garde « base locale »,
 * écriture idempotente, coupure des déclencheurs. Fixtures inventées.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BaseRefusee,
  DECLENCHEURS_COUPES,
  DECLENCHEURS_LAISSES,
  basculerDeclencheurs,
  connecter,
  ecrireTable,
  exigerBaseJetable,
  exigerBaseLocale,
  exigerDeclencheursActifs,
  dossiersDeTravail,
  exigerHorsDepot,
  verifierInventaireDeclencheurs,
  type ClientBase,
  type Requeteur,
} from '../src/base';
import { identifiantCible } from '../src/identifiants';
import { TABLES_SANS_EFFET, ecrirePlan } from '../src/importer';
import { TABLES_CIBLES, planVide } from '../src/plan';
import { TMS_BUBBLE_CAMION } from '../src/referentiel-tms';
import {
  BRANCHE_MIGRATION,
  CONTACT_INCONNU,
  MOTIF_PAS_D_EXCEDENTS,
  MOTIF_SANS_POIDS,
  TELEPHONE_INCONNU,
} from '../src/transformations/collectes';
import {
  NOM_ASSOCIATION_HISTORIQUE,
  NOM_TRANSPORTEUR_HISTORIQUE,
} from '../src/transformations/referentiels';
import {
  LIEU_SITUE,
  abonnement,
  agence,
  collecte,
  contact,
  contexte,
  entreprise,
  monde,
  pack,
  poids,
  pointDepot,
  seule,
  transporteur,
  utilisateur,
} from './fixtures';

const ASSO = 'PARIS / Association Epsilon';

describe('M5.2 / collectes — statuts, événement, lieu', () => {
  it('statut Bubble → statut cible : terminée avec ou sans poids, sans excédent, annulée, à venir, jamais soldée', () => {
    const plan = monde({
      collectes_ag: [
        collecte({ Identifiant: 'A', 'Poids total': '5' }),
        collecte({ Identifiant: 'B', "Pas d'excédents": 'oui' }),
        collecte({ Identifiant: 'G' }),
        collecte({ Identifiant: 'H', 'Poids total': '0' }),
        collecte({ Identifiant: 'C', Statut: 'Annulée' }),
        collecte({
          Identifiant: 'D',
          Statut: 'Programmée',
          'Heure du pickup': 'Nov 15, 2026 6:00 pm',
        }),
        collecte({
          Identifiant: 'E',
          Statut: 'Créée',
          'Heure du pickup': 'Nov 14, 2026 6:00 pm',
        }),
      ],
      collectes_zd: [
        collecte({
          Identifiant: 'F',
          Type: 'DECHET',
          "Pas d'excédents": 'oui',
        }),
      ],
    });
    const parRef = new Map(
      plan.tables.evenements.map((e) => [e.id, e.reference_affaire]),
    );
    const statuts = Object.fromEntries(
      plan.tables.collectes.map((c) => [
        parRef.get(c.evenement_id),
        [c.type, c.statut, c.motif_incident],
      ]),
    );
    expect(statuts).toEqual({
      A: ['anti_gaspi', 'cloturee', null],
      B: ['anti_gaspi', 'realisee_sans_collecte', null],
      // Terminée sans poids ni mention « pas d'excédents » : « sans excédent » (Val 2026-11-16).
      G: ['anti_gaspi', 'realisee_sans_collecte', null],
      H: ['anti_gaspi', 'realisee_sans_collecte', null],
      C: [
        'anti_gaspi',
        'annulee',
        'Migration Bubble — annulée (motif non tracé)',
      ],
      D: ['anti_gaspi', 'programmee', null],
      E: ['anti_gaspi', 'annulee', 'Migration Bubble — collecte non soldée'],
      F: ['zero_dechet', 'cloturee', null],
    });
    expect(
      plan.listings['collectes-non-soldees']!.map((l) => l.identifiant),
    ).toEqual(['E']);
    // Le motif dit d'où vient le « sans excédent » : la mention Bubble, ou le poids manquant.
    expect(
      Object.fromEntries(
        plan.tables.collectes
          .filter((c) => c.aucun_repas_motif !== null)
          .map((c) => [parRef.get(c.evenement_id), c.aucun_repas_motif]),
      ),
    ).toEqual({
      B: MOTIF_PAS_D_EXCEDENTS,
      G: MOTIF_SANS_POIDS,
      H: MOTIF_SANS_POIDS,
    });
    expect(MOTIF_PAS_D_EXCEDENTS).toBe('Migration Bubble — pas d’excédents');
    expect(plan.listings['ag-sans-poids']!.map((l) => l.identifiant)).toEqual([
      'G',
      'H',
    ]);
    // Aucune attribution, donc aucune fiche « historique non renseigné », sans poids.
    expect(plan.tables.attributions_antgaspi.map((a) => a.collecte_id)).toEqual(
      [plan.tables.collectes[0]!.id],
    );
  });

  it('1 collecte Bubble = 1 événement à 1 collecte, nommé « Client - Lieu » ; client vide → nom du lieu', () => {
    const a = collecte();
    const b = collecte({ 'Nom du client': '  ' });
    const plan = monde({ collectes_ag: [a, b] });
    expect(plan.tables.evenements).toHaveLength(2);
    expect(plan.tables.collectes.map((c) => c.evenement_id)).toEqual(
      plan.tables.evenements.map((e) => e.id),
    );
    expect(plan.tables.evenements.map((e) => e.nom_evenement)).toEqual([
      'Client Oméga - Salon Delta',
      'Salon Delta',
    ]);
    const [e] = plan.tables.evenements;
    expect(e).toMatchObject({
      id: identifiantCible('evenement', a['unique id']!),
      created_by: seule(plan.tables.users).id,
      type_evenement_id: contexte().typeEvenementAutreId,
      lieu_id: seule(plan.tables.lieux).id,
      pax: 120,
      nom_client_organisateur: 'Client Oméga',
      reference_affaire: '#1406ALP2330',
      created_at: '2026-06-01 09:00:00 Europe/Paris',
    });
    expect(e).not.toHaveProperty('code_affaire_viparis');
    expect(e).not.toHaveProperty('date_evenement');
    expect(plan.tables.collectes[0]).toMatchObject({
      id: identifiantCible('collecte', a['unique id']!),
      date_collecte: '2026-06-14',
      heure_collecte: '23:30',
      realisee_at: '2026-06-14 23:30:00 Europe/Paris',
      pax: 120,
    });
    expect(plan.tables.collectes[0]).not.toHaveProperty('type_evenement_id');
  });

  it('collecte passée par une agence : l’agence porte l’événement, le traiteur est opérationnel et son entité facture', () => {
    const gamma = agence();
    const plan = monde({
      agences: [gamma],
      collectes_ag: [collecte({ Agence: gamma['unique id']! })],
    });
    const org = (nom: string) =>
      seule(plan.tables.organisations.filter((o) => o.nom === nom)).id;
    expect(seule(plan.tables.evenements)).toMatchObject({
      organisation_id: org('Agence Gamma'),
      traiteur_operationnel_organisation_id: org('Traiteur Alpha'),
      entite_facturation_id: seule(plan.tables.entites_facturation).id,
    });
  });

  it('historique jamais transmis : statut prestataire « non_envoye », aucun prestataire ; la référence de l’ancien logiciel n’est pas posée sur une collecte à venir', () => {
    const plan = monde({
      collectes_ag: [
        collecte({
          MTS_1_tour_or_customer_order_id: 'REF-1',
          Everest_mission_ref: 'M-9',
        }),
        collecte({
          MTS_1_tour_or_customer_order_id: 'REF-2',
          Statut: 'Programmée',
          'Heure du pickup': 'Dec 1, 2026 6:00 pm',
        }),
      ],
    });
    const [passee, aVenir] = plan.tables.collectes;
    expect(
      plan.tables.collectes.every((c) => c.statut_tms === 'non_envoye'),
    ).toBe(true);
    expect(
      plan.tables.collectes.every((c) => !('prestataire_logistique_id' in c)),
    ).toBe(true);
    expect(passee!.tms_reference).toBe('REF-1');
    expect(passee!.notes_internes).toBe(
      'Migration Bubble\nIdentifiant: #1406ALP2330\nMTS-1: REF-1\nEverest: M-9',
    );
    expect(aVenir).toMatchObject({
      statut: 'programmee',
      tms_reference: null,
      realisee_at: null,
    });
  });

  it('lignes illisibles rejetées avec leur motif, jamais abandonnées en silence', () => {
    const plan = monde({
      collectes_ag: [
        collecte({ Type: 'AUTRE' }),
        collecte({ 'Heure du pickup': '14/10/2025' }),
        collecte({ Lieu: ' ' }),
        collecte({ Statut: 'En pause' }),
      ],
    });
    expect(plan.tables.collectes).toHaveLength(0);
    expect(plan.rejets.map((r) => r.motif)).toEqual([
      'type inconnu « AUTRE »',
      'date de collecte illisible',
      'adresse du lieu vide',
      'statut inconnu « En pause »',
    ]);
  });
});

describe('M5.2 / collectes — pesées, attribution, historique partiel', () => {
  it('flux Bubble → référentiel : DIB = déchet résiduel, plastique = emballage ; une ligne par poids strictement positif', () => {
    const p = poids({
      'Biodéchets (kg)': '12,5',
      'Carton (kg)': '0',
      'DIB (kg)': '3',
      'Plastique (kg)': '1,25',
      'Verre (kg)': '',
    });
    const orphelin = poids({ 'Biodéchets (kg)': '99' });
    const c = collecte({
      Type: 'DECHET',
      'Poids déchets': p['unique id']!,
      'Point de dépot': 'Exutoire Lambda',
      formule: '6m3',
    });
    const plan = monde(
      { collectes_zd: [c], poids_zd: [p, orphelin] },
      { geocodes: LIEU_SITUE },
    );
    const flux = contexte().fluxParCode;
    expect(
      plan.tables.collecte_flux.map((f) => [f.flux_id, f.poids_reel_kg]),
    ).toEqual([
      [flux.biodechet, 12.5],
      [flux.dechet_residuel, 3],
      [flux.emballage, 1.25],
    ]);
    expect(plan.tables.collecte_flux[1]!.id).toBe(
      identifiantCible('flux', `${c['unique id']}:dechet_residuel`),
    );
    const col = seule(plan.tables.collectes);
    expect(col.historique_partiel).toBe(false);
    // L'exutoire n'a pas de colonne : il est gardé dans les notes internes.
    expect(col.notes_internes).toBe(
      'Migration Bubble\nIdentifiant: #1406ALP2330\nExutoire: Exutoire Lambda\nFormule: 6m3',
    );
    expect(plan.tables.attributions_antgaspi).toHaveLength(0);
  });

  it('pesées d’une collecte non terminée : non reprises, listées', () => {
    const p = poids({ 'Biodéchets (kg)': '5' });
    const plan = monde({
      collectes_zd: [
        collecte({
          Type: 'DECHET',
          Statut: 'Annulée',
          'Poids déchets': p['unique id']!,
        }),
      ],
      poids_zd: [p],
    });
    expect(plan.tables.collecte_flux).toHaveLength(0);
    expect(plan.listings['poids-non-repris']).toHaveLength(1);
  });

  it('attribution de tout don clôturé : association et transporteur de Bubble, sinon les fiches inactives « historique non renseigné » ; repas = poids ÷ 0,45 arrondi au supérieur', () => {
    const t = transporteur();
    const complete = collecte({
      Transporteur: t['unique id']!,
      'Point de dépot': ASSO,
      'Poids total': '12,6',
    });
    const sansTransporteur = collecte({
      'Point de dépot': ASSO,
      'Poids total': '8',
    });
    const exutoire = collecte({
      Transporteur: t['unique id']!,
      'Point de dépot': 'Exutoire Lambda',
      'Poids total': '3',
    });
    const sansRien = collecte({ 'Poids total': '2' });
    const sansPoids = collecte({
      Transporteur: t['unique id']!,
      'Point de dépot': ASSO,
    });
    const lignes = {
      transporteurs: [t],
      points_depot: [
        pointDepot(),
        pointDepot({ Nom: 'Exutoire Lambda', Type: '' }),
      ],
    };
    // Rien ne manque : aucune fiche historique n'est créée.
    const sansManque = monde({ ...lignes, collectes_ag: [complete] });
    expect(sansManque.tables.associations).toHaveLength(1);
    expect(sansManque.tables.transporteurs).toHaveLength(1);
    expect(sansManque.listings['ag-attribution-historique']).toBeUndefined();

    const plan = monde({
      ...lignes,
      collectes_ag: [complete, sansTransporteur, exutoire, sansRien, sansPoids],
    });
    // Une seule fiche historique de chaque sorte, inactive, quel que soit le nombre de dons portés.
    const [association, associationHistorique] = plan.tables.associations;
    const [transporteurBubble, transporteurHistorique] =
      plan.tables.transporteurs;
    expect(plan.tables.associations).toHaveLength(2);
    expect(plan.tables.transporteurs).toHaveLength(2);
    expect(associationHistorique).toMatchObject({
      id: identifiantCible('association', 'historique-non-renseignee'),
      nom: NOM_ASSOCIATION_HISTORIQUE,
      actif: false,
      habilitee_attestation_fiscale: false,
    });
    expect(transporteurHistorique).toMatchObject({
      id: identifiantCible('transporteur', 'historique-non-renseigne'),
      nom: NOM_TRANSPORTEUR_HISTORIQUE,
      actif: false,
      type_tms: 'autre',
    });
    expect(
      plan.correspondances
        .filter((c) => c.sourceType === 'systeme')
        .map((c) => [c.bubbleId, c.cibleId]),
    ).toEqual(
      expect.arrayContaining([
        ['association-historique', associationHistorique!.id],
        ['transporteur-historique', transporteurHistorique!.id],
      ]),
    );
    expect(
      plan.tables.attributions_antgaspi.map((a) => [
        a.association_id,
        a.transporteur_id,
        a.poids_repas_kg,
        a.volume_repas_realise,
      ]),
    ).toEqual([
      [association!.id, transporteurBubble!.id, 12.6, 28],
      [association!.id, transporteurHistorique!.id, 8, 18],
      [associationHistorique!.id, transporteurBubble!.id, 3, 7],
      [associationHistorique!.id, transporteurHistorique!.id, 2, 5],
    ]);
    const attribution = plan.tables.attributions_antgaspi[0]!;
    expect(attribution).toMatchObject({
      id: identifiantCible('attribution', complete['unique id']!),
      collecte_id: identifiantCible('collecte', complete['unique id']!),
      branche_attribution: BRANCHE_MIGRATION,
      mode_validation: 'manuel_top1',
      poids_repas_kg: 12.6,
      volume_repas_realise: 28,
      valide_at: '2026-06-14 23:30:00 Europe/Paris',
    });
    expect(BRANCHE_MIGRATION).toBe('migration_bubble');
    expect(
      plan.listings['ag-attribution-historique']!.map((l) => [
        l.manque,
        l.poids_total_kg,
      ]),
    ).toEqual([
      ['transporteur', 8],
      ['association', 3],
      ['association et transporteur', 2],
    ]);
    // Un don porté par une fiche historique reste « historique partiel ».
    expect(plan.tables.collectes.map((c) => c.statut)).toEqual([
      'cloturee',
      'cloturee',
      'cloturee',
      'cloturee',
      'realisee_sans_collecte',
    ]);
    // Ce que Bubble nomme sans que l'attribution le porte reste lisible dans les notes.
    const notes = plan.tables.collectes.map((c) => c.notes_internes as string);
    expect(notes[0]).not.toMatch(/Point de dépôt|Transporteur:/);
    expect(notes[2]).toContain('Point de dépôt: Exutoire Lambda');
    expect(notes[2]).not.toContain('Transporteur:');
    expect(notes[4]).toContain(`Point de dépôt: ${ASSO}`);
    expect(notes[4]).toContain('Transporteur: Coursiers Zêta');
  });

  it('« historique partiel » : convives absents, don sans association ou transporteur, déchets sans pesée, lieu non situé', () => {
    const t = transporteur();
    const ag = (v: Record<string, string>) =>
      collecte({
        Transporteur: t['unique id']!,
        'Point de dépot': ASSO,
        'Poids total': '10',
        ...v,
      });
    const p = poids({ 'Verre (kg)': '4' });
    const vide = poids({});
    const adresse = '10 avenue des tests, 75008 paris';
    const situe = new Map([
      [
        adresse,
        {
          latitude: 48.87,
          longitude: 2.31,
          score: 0.9,
          precis: true,
          codePostal: '75008',
          ville: 'Paris',
        },
      ],
    ]);
    const lignes = {
      transporteurs: [t],
      poids_zd: [p, vide],
      collectes_ag: [
        ag({ Identifiant: 'complete' }),
        ag({ Identifiant: 'sans convives', 'Nombre de convives': '' }),
        ag({ Identifiant: 'convives négatifs', 'Nombre de convives': '-99' }),
        ag({ Identifiant: 'sans poids', 'Poids total': '0' }),
        ag({ Identifiant: 'sans transporteur', Transporteur: '' }),
        ag({ Identifiant: 'annulée', Statut: 'Annulée', 'Poids total': '' }),
      ],
      collectes_zd: [
        collecte({
          Identifiant: 'pesée',
          Type: 'DECHET',
          'Poids déchets': p['unique id']!,
        }),
        collecte({
          Identifiant: 'sans pesée',
          Type: 'DECHET',
          'Poids déchets': vide['unique id']!,
        }),
      ],
    };
    const partiels = (plan: ReturnType<typeof monde>) => {
      const parRef = new Map(
        plan.tables.evenements.map((e) => [e.id, e.reference_affaire]),
      );
      return plan.tables.collectes
        .filter((c) => c.historique_partiel)
        .map((c) => parRef.get(c.evenement_id));
    };
    const plan = monde(lignes, { geocodes: situe });
    // « sans poids » est importée « sans excédent » : rien ne lui manque.
    expect(partiels(plan)).toEqual([
      'sans convives',
      'convives négatifs',
      'sans transporteur',
      'sans pesée',
    ]);
    expect(
      plan.tables.collectes
        .filter((c) => c.historique_partiel)
        .slice(0, 2)
        .map((c) => c.pax),
    ).toEqual([0, 0]);
    expect(plan.tables.evenements[1]!.pax).toBe(0);
    // Sans position du lieu, toutes les collectes le sont.
    expect(partiels(monde(lignes))).toHaveLength(8);
  });
});

describe('M5.2 / collectes — données personnelles', () => {
  it('contacts sur place portés par la collecte et recopiés sur l’événement ; téléphone inconnu « - »', () => {
    const plan = monde({
      collectes_ag: [
        collecte({
          'mail du commercial': 'Vente@Traiteur-Alpha.example',
          'numero du commercial': '0600000007',
        }),
      ],
    });
    const contacts = {
      contact_principal_nom: 'Alex Surplace',
      contact_principal_telephone: TELEPHONE_INCONNU,
      contact_secours_nom: 'Charlie Secours',
      contact_secours_telephone: null,
    };
    expect(seule(plan.tables.collecte_contacts)).toEqual({
      collecte_id: seule(plan.tables.collectes).id,
      ...contacts,
    });
    expect(seule(plan.tables.evenements)).toMatchObject({
      ...contacts,
      notes_internes:
        'Migration Bubble — commercial: vente@traiteur-alpha.example 0600000007',
    });
  });

  it('téléphone des contacts sur place : celui du contact repris sous le même nom chez le même traiteur, même sous un ancien nom ; sinon « - » (principal) ou vide (secours) ; jamais celui d’un autre traiteur ni d’un nom qui désigne deux numéros', () => {
    const beta = entreprise({
      'Raison sociale': 'Traiteur Bêta',
      'Email de contact': 'contact@traiteur-beta.example',
      SIRET: '22222222200022',
      Identifiant: 'BET',
    });
    const plan = monde({
      entreprises: [entreprise(), beta],
      contacts: [
        // Même numéro, renommé depuis : l'ancien nom retrouve le numéro.
        contact({
          PrenomNom: 'alex  surplace',
          Numero: '0600000011',
          'Creation Date': 'Jan 1, 2025 8:00 am',
        }),
        contact({
          PrenomNom: 'Alex S.',
          Numero: '06 00 00 00 11',
          'Creation Date': 'Feb 1, 2025 8:00 am',
        }),
        // Même nom chez un autre traiteur : jamais pris.
        contact({
          PrenomNom: 'Charlie Secours',
          Numero: '0600000012',
          'Entreprise liée': 'Traiteur Bêta',
        }),
        // Un ancien nom porté par deux numéros : ambigu.
        contact({
          PrenomNom: 'Dana Double',
          Numero: '0600000013',
          'Creation Date': 'Jan 1, 2025 8:00 am',
        }),
        contact({ PrenomNom: 'Dana Un', Numero: '0600000013' }),
        contact({
          PrenomNom: 'Dana Double',
          Numero: '0600000014',
          'Creation Date': 'Jan 1, 2025 8:00 am',
        }),
        contact({ PrenomNom: 'Dana Deux', Numero: '0600000014' }),
        contact({ PrenomNom: 'Morgan Ici', Numero: '0600000015' }),
      ],
      collectes_ag: [
        collecte(),
        collecte({
          Identifiant: 'deux',
          'Contact 1': 'Dana Double',
          'Contact 2': 'Morgan Ici',
        }),
      ],
    });
    expect(
      plan.tables.contacts_traiteurs.find((c) => c.nom === 'Secours'),
    ).toMatchObject({ telephone: '+33600000012' });
    const [premiere, seconde] = plan.tables.collecte_contacts;
    expect(premiere).toMatchObject({
      contact_principal_nom: 'Alex Surplace',
      contact_principal_telephone: '+33600000011',
      contact_secours_nom: 'Charlie Secours',
      contact_secours_telephone: null,
    });
    expect(seconde).toMatchObject({
      contact_principal_nom: 'Dana Double',
      contact_principal_telephone: TELEPHONE_INCONNU,
      contact_secours_nom: 'Morgan Ici',
      contact_secours_telephone: '+33600000015',
    });
    // L'événement porte les mêmes numéros que sa collecte.
    expect(plan.tables.evenements[0]).toMatchObject({
      contact_principal_telephone: '+33600000011',
      contact_secours_telephone: null,
    });
    expect(plan.tables.evenements[1]).toMatchObject({
      contact_principal_telephone: TELEPHONE_INCONNU,
      contact_secours_telephone: '+33600000015',
    });
  });

  it('collecte de plus de 5 ans : ni nom de contact, ni commercial, ni consigne libre ; poids et lieu gardés', () => {
    const t = transporteur();
    const commun = {
      Transporteur: t['unique id']!,
      'Point de dépot': ASSO,
      'Poids total': '9',
      'Instruction lieu': 'Demander Alex au 06 00 00 00 08',
      'mail du commercial': 'vente@traiteur-alpha.example',
      Commentaires_interne: 'Rappeler Charlie',
    };
    const plan = monde({
      transporteurs: [t],
      // Contact repris au référentiel : son numéro ne va pas sur la collecte ancienne.
      contacts: [contact({ PrenomNom: 'Alex Surplace' })],
      collectes_ag: [
        collecte({
          ...commun,
          Identifiant: 'ancienne',
          'Heure du pickup': 'Nov 14, 2021 6:00 pm',
        }),
        collecte({
          ...commun,
          Identifiant: 'limite',
          'Heure du pickup': 'Nov 15, 2021 6:00 pm',
        }),
      ],
    });
    const [ancienne, limite] = plan.tables.collectes;
    const aucunContact = {
      contact_principal_nom: CONTACT_INCONNU,
      contact_principal_telephone: TELEPHONE_INCONNU,
      contact_secours_nom: null,
      contact_secours_telephone: null,
    };
    expect(plan.tables.evenements[0]).toMatchObject({
      ...aucunContact,
      notes_internes: 'Migration Bubble',
    });
    expect(plan.tables.collecte_contacts[0]).toMatchObject(aucunContact);
    expect(ancienne).toMatchObject({
      informations_supplementaires: null,
      notes_internes: 'Migration Bubble\nIdentifiant: ancienne',
    });
    expect(plan.tables.attributions_antgaspi[0]!.poids_repas_kg).toBe(9);
    // Exactement 5 ans : encore reprise, avec le numéro du contact.
    expect(plan.tables.evenements[1]).toMatchObject({
      contact_principal_nom: 'Alex Surplace',
      contact_principal_telephone: '+33600000002',
    });
    expect(limite!.informations_supplementaires).toBe(
      'Demander Alex au 06 00 00 00 08',
    );
    expect(limite!.notes_internes).toContain('Commentaire: Rappeler Charlie');
    // La consigne d'une collecte ancienne ne nourrit pas non plus la fiche du lieu.
    expect(seule(plan.tables.lieux).acces_details).toBe('Entrée par la cour');
  });

  it('email gardé à part, par événement, pour rendre son historique au commercial : le sien, sinon le contact du traiteur, avec sa provenance', () => {
    const avecCommercial = collecte({
      'mail du commercial': ' Vente@Traiteur-Alpha.example ',
    });
    const sansCommercial = collecte({ 'mail du commercial': '' });
    const illisible = collecte({ 'mail du commercial': 'pas un email' });
    const sansClient = collecte({
      'User entreprise': 'Inconnu',
      User: 'personne@ailleurs.example',
    });
    const plan = monde({
      collectes_ag: [avecCommercial, sansCommercial, illisible, sansClient],
    });
    const id = (c: Record<string, string>) =>
      identifiantCible('evenement', c['unique id']!);
    expect(plan.auteursEvenements).toEqual([
      {
        evenement_id: id(avecCommercial),
        email: 'vente@traiteur-alpha.example',
        provenance: 'commercial',
      },
      {
        evenement_id: id(sansCommercial),
        email: 'contact@traiteur-alpha.example',
        provenance: 'contact_traiteur',
      },
      {
        evenement_id: id(illisible),
        email: 'contact@traiteur-alpha.example',
        provenance: 'contact_traiteur',
      },
    ]);
    // L'auteur en base reste le compte système : la réattribution est un lot du produit.
    expect(new Set(plan.tables.evenements.map((e) => e.created_by))).toEqual(
      new Set([seule(plan.tables.users).id]),
    );
  });

  it('toute collecte importée porte la marque « migration_bubble »', () => {
    const plan = monde({
      collectes_ag: [collecte(), collecte({ Statut: 'Annulée' })],
      collectes_zd: [collecte({ Type: 'DECHET' })],
    });
    expect(plan.tables.collectes.map((c) => c.origine)).toEqual([
      'migration_bubble',
      'migration_bubble',
      'migration_bubble',
    ]);
  });

  it('collecte « sans excédent » qui porte pourtant un poids : poids non repris, listé', () => {
    const plan = monde({
      collectes_ag: [
        collecte({ "Pas d'excédents": 'oui', 'Poids total': '1' }),
      ],
    });
    expect(seule(plan.tables.collectes).statut).toBe('realisee_sans_collecte');
    expect(plan.tables.attributions_antgaspi).toHaveLength(0);
    expect(seule(plan.listings['poids-non-repris']!).motif).toBe(
      'collecte « sans excédent » qui porte un poids',
    );
  });

  it('bornes de la base respectées avant écriture : contact long ou multi-lignes, consigne de plus de 1 000 caractères', () => {
    const plan = monde({
      collectes_ag: [
        collecte({
          'Contact 1': `Alex\nSurplace ${'x'.repeat(200)}`,
          'Contact 2': '\t',
          'Instruction lieu': 'y'.repeat(1500),
        }),
      ],
    });
    const e = seule(plan.tables.evenements);
    expect((e.contact_principal_nom as string).length).toBe(120);
    expect(e.contact_principal_nom).toMatch(/^Alex Surplace x+$/);
    expect(e.contact_secours_nom).toBeNull();
    expect(
      (seule(plan.tables.collectes).informations_supplementaires as string)
        .length,
    ).toBe(1000);
  });

  it('nom du point de dépôt recopié dans les notes internes : borné à 200 caractères, sans caractère de contrôle', () => {
    const long = `Point\tinconnu ${'z'.repeat(400)}`;
    const plan = monde({
      collectes_ag: [collecte({ 'Point de dépot': long })],
      collectes_zd: [collecte({ Type: 'DECHET', 'Point de dépot': long })],
    });
    const lignes = plan.tables.collectes.flatMap((c) =>
      (c.notes_internes as string)
        .split('\n')
        .filter((n) => /^(Point de dépôt|Exutoire): /.test(n)),
    );
    expect(lignes).toHaveLength(2);
    for (const ligne of lignes) {
      const nom = ligne.replace(/^(Point de dépôt|Exutoire): /, '');
      expect(nom).toHaveLength(200);
      expect(nom).toMatch(/^Point inconnu z+$/);
    }
  });
});

describe('M5.2 / packs — crédits recomptés, jamais débités par déclencheur', () => {
  const lier = (p: Record<string, string>, v: Record<string, string> = {}) =>
    collecte({ 'pack lié': p['unique id']!, ...v });

  it('taille → type et crédits ; crédits consommés = collectes rattachées et débitées ; une annulée ne compte que si le pack la liste encore', () => {
    const p = pack({ Type: '10' });
    const terminee = lier(p, { 'Poids total': '4' });
    const sansExcedent = lier(p, { "Pas d'excédents": 'oui' });
    const aVenir = lier(p, {
      Statut: 'Programmée',
      'Heure du pickup': 'Dec 1, 2026 6:00 pm',
    });
    const annuleeRendue = lier(p, { Statut: 'Annulée' });
    const annuleeGardee = lier(p, { Statut: 'Annulée' });
    const dechets = collecte({ Type: 'DECHET', 'pack lié': p['unique id']! });
    p['Collectes liées'] = [terminee, sansExcedent, aVenir, annuleeGardee]
      .map((c) => c['unique id'])
      .join(' , ');
    const plan = monde({
      packs: [p],
      collectes_ag: [
        terminee,
        sansExcedent,
        aVenir,
        annuleeRendue,
        annuleeGardee,
      ],
      collectes_zd: [dechets],
    });
    const cible = seule(plan.tables.packs_antgaspi);
    expect(cible).toMatchObject({
      id: identifiantCible('pack', p['unique id']!),
      type_pack: 'pack_10',
      credits_initiaux: 10,
      credits_consommes: 4,
      statut: 'actif',
      mode_facturation: 'par_collecte',
      date_achat: '2026-01-10',
      commentaires: 'Migration Bubble — Status source: Actif',
    });
    expect(
      plan.tables.collectes.map((c) => [
        c.statut,
        c.pack_antgaspi_id === cible.id,
        c.annulation_tardive,
      ]),
    ).toEqual([
      ['cloturee', true, null],
      ['realisee_sans_collecte', true, null],
      ['programmee', true, null],
      ['annulee', false, false],
      ['annulee', true, true],
      ['cloturee', false, null],
    ]);
    expect(
      plan.listings['packs-liens-a-verifier']!.map((l) => l.motif),
    ).toEqual([
      'annulée mais encore comptée par le pack : crédit conservé',
      'pack cité par une collecte zéro déchet : ignoré',
    ]);
  });

  it('consommation bornée aux crédits initiaux ; pack entièrement consommé = épuisé ; taille hors grille = personnalisé', () => {
    const p = pack({ Type: '5' });
    const collectes = Array.from({ length: 6 }, () => lier(p));
    p['Collectes liées'] = collectes.map((c) => c['unique id']).join(',');
    const plan = monde({
      packs: [
        p,
        pack({
          Type: '60',
          Status: 'Consommé',
          'Creation Date': 'Jan 1, 2024 8:00 am',
        }),
      ],
      collectes_ag: collectes,
    });
    expect(
      plan.tables.packs_antgaspi.map((x) => [
        x.type_pack,
        x.credits_initiaux,
        x.credits_consommes,
        x.statut,
      ]),
    ).toEqual([
      ['personnalise', 5, 5, 'epuise'],
      ['pack_60', 60, 0, 'epuise'],
    ]);
    expect(seule(plan.listings['packs-a-arbitrer']!).motif).toBe(
      '6 collectes rattachées pour 5 crédits : consommation bornée',
    );
  });

  it('un seul pack actif par organisation : le plus récent le reste, l’autre est listé pour arbitrage', () => {
    const plan = monde({
      packs: [
        pack({ 'Creation Date': 'Jan 10, 2025 8:00 am' }),
        pack({ Type: '30' }),
        pack({ Status: 'En attente', 'Creation Date': 'Jan 10, 2024 8:00 am' }),
      ],
    });
    expect(
      plan.tables.packs_antgaspi.map((p) => [p.type_pack, p.statut]),
    ).toEqual([
      ['pack_10', 'epuise'],
      ['pack_30', 'actif'],
      ['pack_10', 'epuise'],
    ]);
    expect(plan.listings['packs-a-arbitrer']!.map((l) => l.motif)).toEqual([
      'statut Bubble « En attente » : importé actif, à confirmer',
      'plusieurs packs actifs pour la même organisation : importé épuisé avec 10 crédit(s) restant(s)',
      'plusieurs packs actifs pour la même organisation : importé épuisé avec 10 crédit(s) restant(s)',
    ]);
  });

  it('abonnements = packs historiques : terminé → épuisé par convention ; en cours et non échu → actif, collectes de la période rattachées', () => {
    const termine = abonnement();
    const vivant = abonnement({
      en_cours: 'oui',
      'Date début': 'Jan 1, 2026 12:00 am',
      'Date fin': 'Dec 31, 2026 12:00 am',
      'Nombre de collectes': '24',
    });
    const echu = abonnement({
      en_cours: 'oui',
      'Date début': 'Jan 1, 2025 12:00 am',
      'Date fin': 'Dec 31, 2025 12:00 am',
      'Nombre de collectes': '5',
    });
    const dedans = collecte();
    const avant = collecte({ 'Heure du pickup': 'Dec 20, 2025 6:00 pm' });
    const plan = monde({
      abonnements: [termine, vivant, echu],
      collectes_ag: [dedans, avant],
    });
    expect(
      plan.tables.packs_antgaspi.map((p) => [
        p.type_pack,
        p.credits_initiaux,
        p.credits_consommes,
        p.statut,
        p.date_achat,
      ]),
    ).toEqual([
      ['personnalise', 30, 30, 'epuise', '2023-06-01'],
      ['personnalise', 24, 1, 'actif', '2026-01-01'],
      ['personnalise', 5, 5, 'epuise', '2025-01-01'],
    ]);
    expect(plan.tables.packs_antgaspi[0]!.commentaires).toBe(
      'Migration Bubble Abonnement 2023-06-01→2024-05-31',
    );
    expect(plan.tables.collectes.map((c) => c.pack_antgaspi_id)).toEqual([
      identifiantCible('abonnement', vivant['unique id']!),
      null,
    ]);
    expect(seule(plan.listings['packs-a-arbitrer']!).motif).toBe(
      'abonnement « en cours » dans Bubble mais échu : importé épuisé',
    );
  });

  it('pack dont l’acheteur n’est rattaché à aucune entreprise : rejeté et listé', () => {
    const plan = monde({
      packs: [pack({ User: 'inconnu@ailleurs.example' })],
      utilisateurs: [utilisateur()],
    });
    expect(plan.tables.packs_antgaspi).toHaveLength(0);
    expect(seule(plan.rejets)).toMatchObject({
      sourceType: 'pack',
      motif: 'organisation de l’acheteur non retrouvée',
    });
  });
});

describe('M5.2 / garde — l’import ne tourne que sur la base locale jetable', () => {
  it('accepte une adresse de cette machine et rend ses paramètres un par un', () => {
    expect(
      exigerBaseLocale('postgresql://postgres:secret@127.0.0.1:56322/postgres'),
    ).toEqual({
      host: '127.0.0.1',
      port: 56322,
      user: 'postgres',
      password: 'secret',
      database: 'postgres',
    });
    expect(exigerBaseLocale('postgres://u:p@localhost/base').host).toBe(
      'localhost',
    );
    expect(exigerBaseLocale('postgresql://u:p@[::1]:5432/base').host).toBe(
      '::1',
    );
  });

  it.each([
    [
      'projet hébergé',
      'postgresql://postgres:x@db.abcdefghijklmnop.supabase.co:5432/postgres',
    ],
    [
      'pooler hébergé',
      'postgresql://postgres.abcdefghijklmnop:x@aws-0-eu-west-3.pooler.supabase.com:6543/postgres',
    ],
    [
      'autre machine du réseau',
      'postgresql://postgres:x@192.168.1.20:5432/postgres',
    ],
    [
      'nom qui commence comme localhost',
      'postgresql://postgres:x@localhost.exemple.test:5432/postgres',
    ],
    [
      'hôte détourné par une option',
      'postgresql://postgres:x@127.0.0.1:5432/postgres?host=db.exemple.test',
    ],
    ['autre protocole', 'https://127.0.0.1/postgres'],
    ['adresse illisible', 'pas une adresse'],
    ['adresse absente', undefined],
  ])('refuse : %s', (_cas, adresse) => {
    expect(() => exigerBaseLocale(adresse)).toThrow(BaseRefusee);
  });

  it('refuse une base, même locale, qui ne porte pas le marqueur posé par base-jetable.sh', async () => {
    const client = (presente: boolean): Requeteur => ({
      query: async () => ({ rows: [{ presente }], rowCount: 1 }),
    });
    await expect(exigerBaseJetable(client(true))).resolves.toBeUndefined();
    await expect(exigerBaseJetable(client(false))).rejects.toThrow(
      /marqueur migration\.base_jetable/,
    );
  });
});

describe('M5.2 / garde — rien n’est exécuté sur une base sans marqueur ; aucune sortie dans le dépôt', () => {
  const faux = (presente: boolean) => {
    const appels: string[] = [];
    const client: ClientBase = {
      connect: async () => appels.push('connect'),
      end: async () => appels.push('end'),
      query: async (texte) => {
        appels.push(texte.replace(/\s+/g, ' ').trim().slice(0, 40));
        return { rows: [{ presente }], rowCount: 1 };
      },
    };
    return { client, appels };
  };
  const adresse = 'postgresql://postgres:secret@127.0.0.1:56322/postgres';

  it('base sans marqueur : une seule requête (la lecture du marqueur), puis connexion fermée — le schéma technique n’est jamais posé', async () => {
    const { client, appels } = faux(false);
    await expect(connecter(adresse, () => client)).rejects.toThrow(BaseRefusee);
    expect(appels).toHaveLength(3);
    expect(appels[0]).toBe('connect');
    expect(appels[1]).toContain('SELECT to_regclass($1) IS NOT NULL');
    expect(appels[2]).toBe('end');
  });

  it('base jetable : marqueur lu d’abord, schéma technique posé ensuite', async () => {
    const { client, appels } = faux(true);
    await expect(connecter(adresse, () => client)).resolves.toBe(client);
    expect(appels).toHaveLength(3);
    expect(appels[1]).toContain('to_regclass');
    expect(appels[2]).toContain('CREATE SCHEMA IF NOT EXISTS migration');
  });

  it('adresse non locale : aucun client n’est même créé', async () => {
    let crees = 0;
    const creer = () => {
      crees++;
      return faux(true).client;
    };
    await expect(
      connecter('postgresql://postgres:x@db.exemple.test:5432/postgres', creer),
    ).rejects.toThrow(BaseRefusee);
    expect(crees).toBe(0);
  });

  it('refuse un dossier de travail placé dans le dépôt, accepte un dossier voisin ou extérieur', () => {
    const depot = '/tmp/depot-invente';
    for (const dedans of [
      depot,
      `${depot}/`,
      `${depot}/sorties`,
      `${depot}/apps/../sorties`,
    ])
      expect(() => exigerHorsDepot(dedans, depot)).toThrow(
        /dans le dépôt, qui est public/,
      );
    for (const dehors of [
      '/tmp/ailleurs',
      `${depot}-voisin`,
      `${depot}/../sorties`,
    ])
      expect(() => exigerHorsDepot(dehors, depot)).not.toThrow();
  });

  it('compare les chemins réels : un lien symbolique vers le dépôt et un sous-dossier nommé « ..x » sont refusés', () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'garde-depot-')));
    const depot = join(racine, 'depot');
    mkdirSync(join(depot, '..cache'), { recursive: true });
    symlinkSync(depot, join(racine, 'raccourci'));
    for (const dedans of [
      join(depot, '..cache'),
      join(depot, '..cache', 'repetition-2'),
      join(racine, 'raccourci'),
      // Dossier pas encore créé, sous un lien vers le dépôt.
      join(racine, 'raccourci', 'repetition-2'),
    ])
      expect(() => exigerHorsDepot(dedans, depot)).toThrow(
        /dans le dépôt, qui est public/,
      );
    // Un lien vers le dépôt, donné comme racine, est résolu de même.
    expect(() =>
      exigerHorsDepot(join(depot, 'sorties'), join(racine, 'raccourci')),
    ).toThrow(/dans le dépôt, qui est public/);
    expect(() =>
      exigerHorsDepot(join(racine, 'ailleurs', 'repetition-2'), depot),
    ).not.toThrow();
  });

  it('refuse un dossier écrit dans une autre casse que le dépôt, ou placé dans un autre dépôt git (le clone principal vu d’un worktree)', () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'garde-git-')));
    const depot = join(racine, 'Depot');
    const clone = join(racine, 'Clone');
    mkdirSync(join(clone, 'sous', 'dossier'), { recursive: true });
    mkdirSync(depot);
    writeFileSync(join(depot, '.git'), 'gitdir: ailleurs\n');
    mkdirSync(join(clone, '.git'));
    const refus = /dans le dépôt, qui est public/;
    // Disque insensible à la casse (cas du Mac) : « depot » désigne « Depot ».
    if (existsSync(join(racine, 'depot')))
      expect(() =>
        exigerHorsDepot(join(racine, 'depot', 'sorties'), depot),
      ).toThrow(refus);
    expect(() => exigerHorsDepot(join(clone, 'sorties'), depot)).toThrow(refus);
    expect(() =>
      exigerHorsDepot(join(clone, 'sous', 'dossier'), depot),
    ).toThrow(refus);
    expect(() =>
      exigerHorsDepot(join(racine, 'ailleurs'), depot),
    ).not.toThrow();
  });

  it('contrôle aussi le sous-dossier de la répétition et le dossier des décisions désignés par l’environnement', () => {
    const racine = realpathSync(mkdtempSync(join(tmpdir(), 'garde-env-')));
    const depot = join(racine, 'depot');
    const travail = join(racine, 'travail');
    mkdirSync(depot);
    const refus = /dans le dépôt, qui est public/;
    expect(dossiersDeTravail({}, travail, depot)).toEqual({
      dossier: travail,
      sortie: join(travail, 'repetition-1'),
      decisions: join(travail, 'repetition-1'),
    });
    expect(() =>
      dossiersDeTravail(
        { MIGRATION_BUBBLE_REPETITION: '../depot/repetition-2' },
        travail,
        depot,
      ),
    ).toThrow(refus);
    expect(() =>
      dossiersDeTravail(
        { MIGRATION_BUBBLE_DECISIONS: join(depot, 'decisions') },
        travail,
        depot,
      ),
    ).toThrow(refus);
    expect(() =>
      dossiersDeTravail({ MIGRATION_BUBBLE_DOSSIER: depot }, travail, depot),
    ).toThrow(refus);
  });
});

/** Faux client : rejoue des réponses par motif de requête et garde la trace des requêtes. */
function fauxClient(
  reponses: [
    RegExp,
    Record<string, unknown>[] | (() => Record<string, unknown>[]),
  ][],
) {
  const requetes: string[] = [];
  const client: Requeteur = {
    query: async (texte) => {
      requetes.push(texte.replace(/\s+/g, ' ').trim());
      const trouve = reponses.find(([motif]) => motif.test(texte));
      const rows = trouve
        ? typeof trouve[1] === 'function'
          ? trouve[1]()
          : trouve[1]
        : [];
      return { rows, rowCount: rows.length };
    },
  };
  return { client, requetes };
}

describe('M5.2 / écriture idempotente', () => {
  const lignes = [
    { id: 'a', nom: 'Un', created_at: 'x' },
    { id: 'b', nom: 'Deux', created_at: 'x' },
  ];

  it('ne modifie que les lignes qui diffèrent, n’insère que les absentes, sans INSERT … ON CONFLICT', async () => {
    const { client, requetes } = fauxClient([
      [/modifiees AS/, [{ modifiees: [], inserees: ['a', 'b'] }]],
      [/AS ecarts/, [{ ecarts: 0 }]],
    ]);
    const bilan = await ecrireTable(client, 'plateforme.lieux', lignes);
    expect(bilan).toEqual({
      table: 'plateforme.lieux',
      lues: 2,
      inserees: 2,
      modifiees: 0,
      inchangees: 0,
      touchees: ['a', 'b'],
    });
    const [ecriture, controle] = requetes;
    expect(ecriture).toContain(
      'WHERE t.id = d.id AND (t.nom) IS DISTINCT FROM (d.nom)',
    );
    expect(ecriture).toContain(
      'WHERE NOT EXISTS (SELECT 1 FROM plateforme.lieux t WHERE t.id = d.id)',
    );
    expect(ecriture).not.toMatch(/ON CONFLICT/i);
    // Les horodatages sont posés à l'insertion seulement : jamais comparés, jamais réécrits.
    expect(ecriture).toContain(
      'INSERT INTO plateforme.lieux (id, nom, created_at)',
    );
    expect(ecriture).toContain('SET nom = d.nom FROM donnees d');
    expect(controle).toContain(
      'WHERE t.id IS NULL OR (t.nom) IS DISTINCT FROM (d.nom)',
    );
  });

  it('rejeu : rien d’inséré, rien de modifié', async () => {
    const { client } = fauxClient([
      [/modifiees AS/, [{ modifiees: [], inserees: [] }]],
      [/AS ecarts/, [{ ecarts: 0 }]],
    ]);
    expect(await ecrireTable(client, 'plateforme.lieux', lignes)).toMatchObject(
      { inserees: 0, modifiees: 0, inchangees: 2, touchees: [] },
    );
  });

  it('contrôle de fin positif : une écriture filtrée en silence fait échouer', async () => {
    const { client } = fauxClient([
      [/modifiees AS/, [{ modifiees: [], inserees: [] }]],
      [/AS ecarts/, [{ ecarts: 2 }]],
    ]);
    await expect(
      ecrireTable(client, 'plateforme.lieux', lignes),
    ).rejects.toThrow(/2 ligne\(s\) du plan absentes ou différentes/);
  });

  it('refuse un nom de table ou de colonne inattendu, et des lignes de formes différentes', async () => {
    const { client } = fauxClient([]);
    await expect(
      ecrireTable(client, 'plateforme.lieux; --', lignes),
    ).rejects.toThrow(/Identifiant SQL inattendu/);
    await expect(
      ecrireTable(client, 'plateforme.lieux', [{ id: 'a', 'nom"': 1 }]),
    ).rejects.toThrow(/Identifiant SQL inattendu/);
    await expect(
      ecrireTable(client, 'plateforme.lieux', [
        { id: 'a', nom: 1 },
        { id: 'b' },
      ]),
    ).rejects.toThrow(/mêmes colonnes/);
  });
});

describe('M5.2 / déclencheurs — coupés par leur nom, rétablis, inventaire fermé', () => {
  const tous = [
    ...DECLENCHEURS_COUPES.map((d) => ({
      table: d.table,
      nom: d.nom,
      actif: true,
    })),
    ...Object.entries(DECLENCHEURS_LAISSES).flatMap(([table, noms]) =>
      noms.map((nom) => ({ table, nom, actif: true })),
    ),
  ];

  it('coupe les déclencheurs qui débitent un pack, écrivent un ordre, un document ou une alerte ; laisse les recopies événement ↔ collecte', () => {
    const coupes = DECLENCHEURS_COUPES.map((d) => `${d.table}.${d.nom}`);
    expect(coupes).toEqual(
      expect.arrayContaining([
        'collectes.trg_pack_debit_programmation',
        'collectes.trg_pack_debit_annulation_tardive',
        'collectes.trg_pack_debit_realisee',
        'collectes.trg_pack_recredit',
        'collectes.trg_co2_ag_cloture',
        'collectes.trg_co2_zd_cloture',
        'collecte_flux.trg_co2_zd_pesees',
        'attributions_antgaspi.trg_co2_ag_repas',
        'attributions_antgaspi.trg_regenerer_attestation',
        'lieux.trg_lieu_champ_critique_e5',
      ]),
    );
    expect(new Set(coupes).size).toBe(coupes.length);
    expect(DECLENCHEURS_COUPES.every((d) => d.raison.length > 20)).toBe(true);
    expect(DECLENCHEURS_LAISSES.collectes).toEqual(
      expect.arrayContaining([
        'trg_collectes_evenement_suit_n1',
        'trg_set_date_evenement',
        'trg_collecte_contacts_par_defaut',
      ]),
    );
    expect(Object.keys(DECLENCHEURS_LAISSES).sort()).toEqual(
      [...TABLES_CIBLES].sort(),
    );
  });

  it('laisse actives les gardes rôle ↔ type d’organisation : invariant de la plateforme, sans effet de bord', () => {
    const coupes = DECLENCHEURS_COUPES.map((d) => `${d.table}.${d.nom}`);
    expect(DECLENCHEURS_LAISSES.users).toContain(
      'trg_users_role_suit_type_organisation',
    );
    expect(DECLENCHEURS_LAISSES.organisations).toContain(
      'trg_organisations_type_reecrit_roles',
    );
    expect(coupes).not.toContain('users.trg_users_role_suit_type_organisation');
    expect(coupes).not.toContain(
      'organisations.trg_organisations_type_reecrit_roles',
    );
  });

  it('s’arrête si la base porte un déclencheur non classé, ou s’il en manque un', async () => {
    await expect(
      verifierInventaireDeclencheurs(fauxClient([[/pg_trigger/, tous]]).client),
    ).resolves.toBeUndefined();
    const nouveau = [
      ...tous,
      { table: 'collectes', nom: 'trg_nouveau', actif: true },
    ];
    await expect(
      verifierInventaireDeclencheurs(
        fauxClient([[/pg_trigger/, nouveau]]).client,
      ),
    ).rejects.toThrow(/Non classés : collectes\.trg_nouveau/);
    await expect(
      verifierInventaireDeclencheurs(
        fauxClient([[/pg_trigger/, tous.slice(1)]]).client,
      ),
    ).rejects.toThrow(/Disparus : collectes\.trg_pack_debit_programmation/);
  });

  it('coupe et rétablit chaque déclencheur par son nom ; échoue si l’un reste coupé', async () => {
    const { client, requetes } = fauxClient([]);
    await basculerDeclencheurs(client, 'DISABLE');
    expect(requetes).toHaveLength(DECLENCHEURS_COUPES.length);
    expect(requetes[0]).toBe(
      'ALTER TABLE plateforme.collectes DISABLE TRIGGER trg_pack_debit_programmation',
    );
    const reste = tous.map((d, i) => (i === 0 ? { ...d, actif: false } : d));
    await expect(
      exigerDeclencheursActifs(fauxClient([[/pg_trigger/, reste]]).client),
    ).rejects.toThrow(
      /restés coupés : collectes\.trg_pack_debit_programmation/,
    );
    await expect(
      exigerDeclencheursActifs(fauxClient([[/pg_trigger/, tous]]).client),
    ).resolves.toBeUndefined();
  });
});

describe('M5.2 / import — une transaction, aucun effet de bord', () => {
  const tous = [
    ...DECLENCHEURS_COUPES.map((d) => ({
      table: d.table,
      nom: d.nom,
      actif: true,
    })),
    ...Object.entries(DECLENCHEURS_LAISSES).flatMap(([table, noms]) =>
      noms.map((nom) => ({ table, nom, actif: true })),
    ),
  ];
  const reponses = (effet: () => number): Parameters<typeof fauxClient>[0] => [
    [/pg_trigger/, tous],
    [
      /count\(\*\)::int AS n FROM plateforme\.outbox_events/,
      () => [{ n: effet() }],
    ],
    [/count\(\*\)::int AS n/, [{ n: 0 }]],
    [/modifiees AS/, [{ modifiees: [], inserees: [] }]],
    [/AS ecarts/, [{ ecarts: 0 }]],
    [/AS disparues/, [{ inserees: 0, modifiees: 0, disparues: 0 }]],
  ];
  const plan = () => {
    const t = transporteur({ TmsType: TMS_BUBBLE_CAMION });
    return monde({
      transporteurs: [t],
      collectes_ag: [
        collecte({
          Transporteur: t['unique id']!,
          'Point de dépot': ASSO,
          'Poids total': '4',
        }),
      ],
    });
  };

  it('écrit les tables dans l’ordre des dépendances, déclencheurs coupés puis rétablis, et valide', async () => {
    const { client, requetes } = fauxClient(reponses(() => 0));
    const bilan = await ecrirePlan(client, plan());
    expect(bilan.ecritures.map((e) => e.table)).toEqual(
      TABLES_CIBLES.map((t) => `plateforme.${t}`),
    );
    const rang = (motif: RegExp) => requetes.findIndex((r) => motif.test(r));
    expect(requetes[0]).toBe('BEGIN');
    expect(requetes.at(-1)).toBe('COMMIT');
    expect(rang(/DISABLE TRIGGER/)).toBeLessThan(
      rang(/INSERT INTO plateforme\.organisations/),
    );
    expect(rang(/INSERT INTO plateforme\.evenements/)).toBeLessThan(
      rang(/INSERT INTO plateforme\.collectes/),
    );
    expect(rang(/INSERT INTO plateforme\.collectes /)).toBeLessThan(
      rang(/fn_calculer_co2_ag/),
    );
    expect(rang(/fn_calculer_co2_zd/)).toBeLessThan(rang(/ENABLE TRIGGER/));
    // Le type de logiciel d'un transporteur est immuable : jamais dans une mise à jour.
    const transporteurs = requetes.find((r) =>
      /UPDATE plateforme\.transporteurs/.test(r),
    )!;
    expect(transporteurs).not.toMatch(/SET[^;]*type_tms = d\.type_tms/);
    expect(TABLES_SANS_EFFET).toEqual(
      expect.arrayContaining([
        'plateforme.outbox_events',
        'plateforme.jobs_pdf',
        'plateforme.emails_envoyes',
        'plateforme.factures',
        'plateforme.audit_log',
      ]),
    );
  });

  it('annule tout si une table d’ordres, de documents ou d’emails a reçu une ligne', async () => {
    let lectures = 0;
    const { client, requetes } = fauxClient(reponses(() => lectures++));
    await expect(ecrirePlan(client, plan())).rejects.toThrow(
      /Effet de bord interdit : plateforme\.outbox_events 0 → 1/,
    );
    expect(requetes.at(-1)).toBe('ROLLBACK');
    expect(requetes).not.toContain('COMMIT');
  });

  it('un plan vide n’écrit dans aucune table métier', async () => {
    const { client, requetes } = fauxClient(reponses(() => 0));
    await ecrirePlan(client, planVide());
    expect(requetes.some((r) => /INSERT INTO plateforme\./.test(r))).toBe(
      false,
    );
  });

  it('aucune facture, aucun document, aucun fichier dans le plan : ces tables ne font pas partie des cibles', () => {
    expect(TABLES_CIBLES).not.toEqual(
      expect.arrayContaining([
        'factures',
        'attestations_don',
        'bordereaux_savr',
        'jobs_pdf',
      ]),
    );
    const p = plan();
    expect(p.tables.organisations.every((o) => o.logo_url === null)).toBe(true);
    expect(p.listings['logos-non-repris']).toBeUndefined();
    const avecLogo = monde({
      entreprises: [entreprise({ logo: '//cdn.example/logo.png' })],
    });
    expect(
      seule(
        avecLogo.tables.organisations.filter((o) => o.nom === 'Traiteur Alpha'),
      ).logo_url,
    ).toBeNull();
    expect(avecLogo.listings['logos-non-repris']).toHaveLength(1);
  });
});
