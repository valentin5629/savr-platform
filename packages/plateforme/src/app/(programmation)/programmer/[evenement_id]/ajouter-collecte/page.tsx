'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import {
  CarteCollecte,
  type TypeEvenementOption,
} from '@/components/programmation/carte-collecte';
import type { ContactOption } from '@/components/programmation/contact-combobox';
import { usePackAg } from '@/components/programmation/use-pack-ag';
import { useSignalZdSelection } from '@/components/layout/logo-context';
import { PageHeader } from '@/components/ui/page-header';
import { FormActions } from '@/components/ui/form-actions';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import {
  libelleTypeCollecte,
  normaliserTypeCollecte,
} from '@/lib/libelles/type-collecte';
import { Heading } from '@/components/ui/heading';
import { InfoItem } from '@/components/ui/info-item';
import { textClasses } from '@/components/ui/text';
import { formatJourLong, isoVersDate } from '@/lib/date-iso';
import {
  carteComplete,
  carteVersCorps,
  carteVide,
  clesEnDoublon,
  contactDepuis,
  type CarteSaisie,
} from '@/lib/programmation/cartes-saisie';

// Valeur du niveau événement : texte courant neutral-900, comme le
// récapitulatif de l'écran de confirmation.
const VALEUR_EVENEMENT = textClasses({ tone: 'ink' });

type LieuEvenement = {
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
};

type ContactsCollecte = {
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
};

type CollecteExistante = {
  type: string;
  statut?: string | null;
  date_collecte: string | null;
  heure_collecte: string | null;
  pax: number | null;
  type_evenement_id?: string | null;
  contacts?: ContactsCollecte | null;
  created_at?: string | null;
};

// Événement tel que le rend GET /api/v1/programmation/evenements/[id].
type EvenementExistant = {
  organisation_id?: string;
  nom_evenement?: string | null;
  nom_client_organisateur?: string | null;
  date_evenement?: string | null;
  controle_acces_requis?: boolean;
  // Relation to-one : PostgREST renvoie un objet, on tolère le tableau.
  lieux?: LieuEvenement | LieuEvenement[] | null;
  collectes?: CollecteExistante[];
};

function formatLieu(lieux: EvenementExistant['lieux']): string {
  const lieu = Array.isArray(lieux) ? (lieux[0] ?? null) : lieux;
  if (!lieu) return '—';
  const adresse = [
    lieu.adresse_acces,
    [lieu.code_postal, lieu.ville].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [lieu.nom, adresse].filter(Boolean).join(' — ') || '—';
}

function formatDateEvenement(iso: string | null | undefined): string {
  const d = isoVersDate(iso);
  return d ? formatJourLong(d) : '—';
}

const typeCarte = (type: string): 'zd' | 'ag' =>
  normaliserTypeCollecte(type) === 'zero_dechet' ? 'zd' : 'ag';

// Collectes non annulées de l'événement, de la plus ancienne à la plus
// tardive : par date, heure, puis création.
function nonAnnuleesDansLOrdre(
  collectes: readonly CollecteExistante[],
): CollecteExistante[] {
  const cle = (c: CollecteExistante) =>
    `${c.date_collecte ?? ''}|${(c.heure_collecte ?? '').slice(0, 5)}|${c.created_at ?? ''}`;
  return collectes
    .filter((c) => c.statut !== 'annulee')
    .sort((a, b) => cle(a).localeCompare(cle(b)));
}

const CONTACT_VIDE = { prenom: '', nom: '', telephone: '', fonction: '' };

export default function AjouterCollectePage() {
  const { evenement_id } = useParams<{ evenement_id: string }>();
  const router = useRouter();
  // Carte de la nouvelle collecte (§06.01 « Ajouter une collecte à un
  // événement existant », § 3.a) : une seule, Zéro Déchet par défaut.
  const [carte, setCarte] = useState<CarteSaisie>(() => carteVide('zd'));
  // Logo Savr vert tant que l'onglet ZD est actif ; orange sur Anti-Gaspi.
  useSignalZdSelection(carte.type === 'zd');
  const [typesEvenements, setTypesEvenements] = useState<TypeEvenementOption[]>(
    [],
  );
  const [contactCible, setContactCible] = useState<
    'principal' | 'secours' | null
  >(null);
  const [newContact, setNewContact] = useState(CONTACT_VIDE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Niveau événement figé (§06.01) : nom, client, date de l'événement, lieu et
  // contrôle d'accès, affichés en lecture seule, jamais renvoyés par la page.
  // La route d'ajout relit l'événement, contrôle d'accès compris.
  const [evenement, setEvenement] = useState<EvenementExistant | null>(null);
  useEffect(() => {
    let ignore = false;
    fetch(
      `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}`,
    )
      .then((res) =>
        res.ok ? (res.json() as Promise<EvenementExistant>) : null,
      )
      .then((evt) => {
        if (ignore) return;
        setEvenement(evt);
        // Convives, type d'événement et contacts pré-remplis avec ceux de la
        // dernière collecte non annulée (décisions Val 2026-10-20 et
        // 2026-10-22), modifiables ; la date reste vide. Le pax est celui de la
        // dernière collecte non annulée au pax connu (même règle que le défaut
        // en base) : un pax à 0 (inconnu, reprise Bubble) ne se pré-remplit
        // pas. Un champ déjà saisi n'est jamais écrasé.
        const ordre = nonAnnuleesDansLOrdre(evt?.collectes ?? []);
        const derniere = ordre[ordre.length - 1];
        const derniereAuPax = ordre
          .filter((c) => c.pax != null && c.pax > 0)
          .pop();
        setCarte((c) => ({
          ...c,
          pax:
            c.pax === '' && derniereAuPax ? String(derniereAuPax.pax) : c.pax,
          type_evenement_id:
            c.type_evenement_id || (derniere?.type_evenement_id ?? ''),
          contact_principal:
            c.contact_principal ??
            contactDepuis(
              derniere?.contacts?.contact_principal_nom,
              derniere?.contacts?.contact_principal_telephone,
            ),
          contact_secours:
            c.contact_secours ??
            contactDepuis(
              derniere?.contacts?.contact_secours_nom,
              derniere?.contacts?.contact_secours_telephone,
            ),
        }));
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [evenement_id]);

  useEffect(() => {
    void fetch('/api/v1/programmation/types-evenements')
      .then((r) => r.json() as Promise<TypeEvenementOption[]>)
      .then((t) => setTypesEvenements(Array.isArray(t) ? t : []))
      .catch(() => {});
  }, []);

  // Organisation de l'événement, celle qui paie et dont on lit les contacts.
  // Le paramètre `organisation_id` n'est honoré que pour le staff ; un rôle
  // client lit toujours son propre pack et ses propres contacts, qui sont ceux
  // de l'événement (la route d'ajout l'impose).
  const orgEvenement = evenement?.organisation_id ?? null;
  // Pack AG : sans pack actif, la collecte AG ajoutée sera facturée à l'unité,
  // information affichée dans la carte (décision Val 2026-10-16).
  const pack = usePackAg(carte.type === 'ag' ? orgEvenement : null);

  // Même type, même date et même heure qu'une collecte non annulée de
  // l'événement : avertissement non bloquant (décision Val 2026-10-22, C4).
  const existantes = useMemo(
    () =>
      nonAnnuleesDansLOrdre(evenement?.collectes ?? []).map((c) => ({
        ...carteVide(typeCarte(c.type)),
        date_collecte: c.date_collecte ?? '',
        heure_collecte: c.heure_collecte ?? '',
      })),
    [evenement],
  );
  const doublon = clesEnDoublon([...existantes, carte]).has(carte.cle);

  const changerCarte = <K extends keyof CarteSaisie>(
    champ: K,
    valeur: CarteSaisie[K],
  ) => setCarte((c) => ({ ...c, [champ]: valeur }));

  const handleAddContactInline = async () => {
    if (!contactCible) return;
    if (!newContact.prenom || !newContact.nom || !newContact.telephone) return;
    const res = await fetch('/api/v1/programmation/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        orgEvenement
          ? { ...newContact, organisation_id: orgEvenement }
          : newContact,
      ),
    });
    if (!res.ok) return;
    const created = (await res.json()) as ContactOption;
    changerCarte(
      contactCible === 'principal' ? 'contact_principal' : 'contact_secours',
      created,
    );
    setContactCible(null);
    setNewContact(CONTACT_VIDE);
  };

  const valid = carteComplete(carte);

  const handleSubmit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}/collectes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(carteVersCorps(carte)),
        },
      );
      const result = (await res.json().catch(() => ({}))) as {
        collecte_id?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(result.error ?? 'Erreur');
        return;
      }
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Ajouter une collecte" tone="neutral" size="xl" />

      {evenement && (
        <section aria-labelledby="niveau-evenement" className="space-y-3">
          <Heading
            level={2}
            size="sm"
            tone="faint"
            overline
            id="niveau-evenement"
          >
            Événement
          </Heading>
          <dl className="grid gap-4 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3 sm:grid-cols-2">
            <InfoItem
              variant="hint"
              label="Nom de l’événement"
              pleineLargeur
              className="space-y-0.5"
              valueClassName={VALEUR_EVENEMENT}
            >
              {evenement.nom_evenement || '—'}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Client"
              className="space-y-0.5"
              valueClassName={VALEUR_EVENEMENT}
            >
              {evenement.nom_client_organisateur || '—'}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Date de l’événement"
              className="space-y-0.5"
              valueClassName={VALEUR_EVENEMENT}
            >
              {formatDateEvenement(evenement.date_evenement)}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Lieu"
              pleineLargeur
              className="space-y-0.5"
              valueClassName={VALEUR_EVENEMENT}
            >
              {formatLieu(evenement.lieux)}
            </InfoItem>
            <InfoItem
              variant="hint"
              label="Contrôle d’accès"
              pleineLargeur
              className="space-y-0.5"
              valueClassName={VALEUR_EVENEMENT}
            >
              {evenement.controle_acces_requis
                ? 'Plaque et nom du chauffeur requis'
                : 'Non requis'}
            </InfoItem>
          </dl>
        </section>
      )}

      <ToggleTypeCollecte
        value={carte.type === 'zd' ? 'zero_dechet' : 'anti_gaspi'}
        onChange={(v) =>
          changerCarte('type', v === 'zero_dechet' ? 'zd' : 'ag')
        }
        className="w-full [&>*]:flex-1"
      />

      <CarteCollecte
        carte={carte}
        libelle={`Collecte ${libelleTypeCollecte(carte.type)}`}
        suffixe={`${carte.type}-1`}
        estModele
        typesEvenements={typesEvenements}
        pack={carte.type === 'ag' ? pack : undefined}
        doublon={doublon}
        organisationId={orgEvenement ?? undefined}
        onChange={changerCarte}
        onAjouterContact={setContactCible}
      />

      <Modal
        open={contactCible !== null}
        title="Nouveau contact"
        onClose={() => setContactCible(null)}
        footer={
          <FormActions
            cancel={{
              label: 'Annuler',
              onClick: () => setContactCible(null),
            }}
            submit={{
              label: 'Ajouter',
              onClick: () => void handleAddContactInline(),
              disabled:
                !newContact.prenom || !newContact.nom || !newContact.telephone,
            }}
          />
        }
      >
        <div className="space-y-4">
          <FormGrid>
            <FormField label="Prénom" htmlFor="contact-prenom" required>
              <Input
                id="contact-prenom"
                required
                value={newContact.prenom}
                onChange={(e) =>
                  setNewContact((p) => ({ ...p, prenom: e.target.value }))
                }
                placeholder="Prénom"
              />
            </FormField>
            <FormField label="Nom" htmlFor="contact-nom" required>
              <Input
                id="contact-nom"
                required
                value={newContact.nom}
                onChange={(e) =>
                  setNewContact((p) => ({ ...p, nom: e.target.value }))
                }
                placeholder="Nom"
              />
            </FormField>
          </FormGrid>
          <FormField label="Téléphone" htmlFor="contact-tel" required>
            <Input
              id="contact-tel"
              type="tel"
              required
              value={newContact.telephone}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, telephone: e.target.value }))
              }
              placeholder="06 12 34 56 78"
            />
          </FormField>
          <FormField label="Fonction (optionnel)" htmlFor="contact-fonction">
            <Input
              id="contact-fonction"
              value={newContact.fonction}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, fonction: e.target.value }))
              }
              placeholder="Ex : Responsable salle"
            />
          </FormField>
        </div>
      </Modal>

      {error && (
        <AlertBar variant="err" role="alert" icon={<AlertTriangle />}>
          {error}
        </AlertBar>
      )}

      <FormActions
        cancel={{ label: 'Annuler', onClick: () => router.back() }}
        submit={{
          label: (
            <>
              <CheckCircle /> Ajouter la collecte
            </>
          ),
          onClick: () => void handleSubmit(),
          disabled: !valid || submitting,
        }}
        className="gap-3"
      />
    </div>
  );
}
