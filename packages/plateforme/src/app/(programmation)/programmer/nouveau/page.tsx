'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Save,
  CheckCircle,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { FormStepIndicator } from '@/components/programmation/form-step-indicator';
import {
  LieuCombobox,
  type LieuOption,
} from '@/components/programmation/lieu-combobox';
import { LieuManuelForm } from '@/components/programmation/lieu-manuel-form';
import {
  ContactCombobox,
  type ContactOption,
} from '@/components/programmation/contact-combobox';
import {
  SousBlocCollecte,
  type CollecteFormData,
} from '@/components/programmation/sous-bloc-collecte';

const STEPS = [
  { label: 'Événement' },
  { label: 'Lieu & contacts' },
  { label: 'Collecte(s)' },
];

interface TypeEvenement {
  id: string;
  code: string;
  libelle: string;
}

interface TraiteurOption {
  id: string;
  raison_sociale: string;
  nom_commercial: string | null;
  ville: string | null;
}

interface PackInfo {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_consommes?: number;
  credits_restants?: number;
}

// Source de pré-remplissage « Dupliquer » (?from=) — sous-ensemble du GET
// /api/v1/traiteur/collectes/:id.
interface SourceLieu {
  id: string;
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface SourceEvenement {
  pax: number | null;
  type_evenement_id: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  lieu: SourceLieu | SourceLieu[] | null;
}
interface SourceCollecte {
  type: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  evenement: SourceEvenement | SourceEvenement[] | null;
}

const emptyCollecte = (type: 'zd' | 'ag'): CollecteFormData => ({
  type,
  date_collecte: '',
  heure_collecte: '',
  informations_supplementaires: '',
});

function parseJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function NouveauProgrammationPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rôle courant (nécessaire pour UI agence/gestionnaire)
  const [role, setRole] = useState<string>('');
  const needsTraiteurSelector =
    role === 'agence' || role === 'gestionnaire_lieux';

  // Traiteur opérant (agence / gestionnaire_lieux uniquement)
  const [traiteurOperationnelId, setTraiteurOperationnelId] = useState('');
  const [traiteurs, setTraiteurs] = useState<TraiteurOption[]>([]);

  // Étape 1
  const [nomClient, setNomClient] = useState('');
  const [pax, setPax] = useState('');
  const [typeEvenementId, setTypeEvenementId] = useState('');
  const [typesEvenements, setTypesEvenements] = useState<TypeEvenement[]>([]);
  const [typesCollecte, setTypesCollecte] = useState<{
    zd: boolean;
    ag: boolean;
  }>({ zd: false, ag: false });
  const [referenceAffaire, setReferenceAffaire] = useState('');
  const [packAg, setPackAg] = useState<PackInfo | null>(null);
  const [agBloque, setAgBloque] = useState(false);

  // Étape 2
  const [lieu, setLieu] = useState<LieuOption | null>(null);
  const [controleAcces, setControleAcces] = useState(false);
  const [contactPrincipal, setContactPrincipal] =
    useState<ContactOption | null>(null);
  const [contactSecours, setContactSecours] = useState<ContactOption | null>(
    null,
  );
  const [showLieuManuel, setShowLieuManuel] = useState(false);
  const [showContactForm, setShowContactForm] = useState<
    'principal' | 'secours' | null
  >(null);
  const [newContact, setNewContact] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    fonction: '',
  });

  // Étape 3
  const [collectes, setCollectes] = useState<CollecteFormData[]>([]);

  useEffect(() => {
    void fetch('/api/v1/programmation/types-evenements')
      .then((r) => r.json() as Promise<TypeEvenement[]>)
      .then(setTypesEvenements);
  }, []);

  // Pré-remplissage « Dupliquer » (?from=<collecteId>) — décision Val 2026-07-05.
  // Charge la collecte source et pré-remplit le formulaire ; la date reste vide
  // (nouvelle date à choisir). Rien n'est créé tant que l'utilisateur ne valide
  // pas. Le sync-effect typesCollecte→collectes conserve la ligne pré-remplie
  // (même type). Erreur/absence = formulaire vierge (dégradation gracieuse).
  useEffect(() => {
    const from =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('from')
        : null;
    if (!from) return;
    void fetch(`/api/v1/traiteur/collectes/${from}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data?: SourceCollecte }>) : null,
      )
      .then((j) => {
        const d = j?.data;
        if (!d) return;
        const evt = Array.isArray(d.evenement) ? d.evenement[0] : d.evenement;
        if (!evt) return;
        const lieuSrc = Array.isArray(evt.lieu) ? evt.lieu[0] : evt.lieu;
        const isZd = d.type === 'zero_dechet';
        setNomClient(evt.nom_client_organisateur ?? '');
        setPax(evt.pax != null ? String(evt.pax) : '');
        setTypeEvenementId(evt.type_evenement_id ?? '');
        setReferenceAffaire(evt.reference_affaire ?? '');
        setControleAcces(Boolean(d.controle_acces_requis));
        if (lieuSrc) {
          setLieu({
            id: lieuSrc.id,
            nom: lieuSrc.nom ?? '',
            adresse_acces: lieuSrc.adresse_acces ?? '',
            ville: lieuSrc.ville ?? '',
            code_postal: lieuSrc.code_postal ?? '',
            controle_acces_requis_default: false,
          });
        }
        if (evt.contact_principal_nom) {
          setContactPrincipal({
            id: '',
            prenom: '',
            nom: evt.contact_principal_nom,
            telephone: evt.contact_principal_telephone ?? '',
          });
        }
        if (evt.contact_secours_nom) {
          setContactSecours({
            id: '',
            prenom: '',
            nom: evt.contact_secours_nom,
            telephone: evt.contact_secours_telephone ?? '',
          });
        }
        setTypesCollecte({ zd: isZd, ag: !isZd });
        setCollectes([
          {
            type: isZd ? 'zd' : 'ag',
            date_collecte: '',
            heure_collecte: (d.heure_collecte ?? '').slice(0, 5),
            informations_supplementaires: d.informations_supplementaires ?? '',
          },
        ]);
      })
      .catch(() => {});
  }, []);

  // Lecture du rôle + chargement des traiteurs si agence/gestionnaire
  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      const claims = parseJwt(token);
      const r = claims['user_role'] as string | undefined;
      if (r) {
        setRole(r);
        if (r === 'agence' || r === 'gestionnaire_lieux') {
          void fetch('/api/v1/programmation/organisations/traiteurs')
            .then((res) => res.json() as Promise<TraiteurOption[]>)
            .then(setTraiteurs);
        }
      }
    });
  }, []);

  // Sync collectes array when type selection changes
  useEffect(() => {
    setCollectes((prev) => {
      const next: CollecteFormData[] = [];
      if (typesCollecte.zd) {
        next.push(prev.find((c) => c.type === 'zd') ?? emptyCollecte('zd'));
      }
      if (typesCollecte.ag) {
        next.push(prev.find((c) => c.type === 'ag') ?? emptyCollecte('ag'));
      }
      return next;
    });
  }, [typesCollecte]);

  // Pré-cocher contrôle accès si lieu l'impose
  useEffect(() => {
    if (lieu?.controle_acces_requis_default) setControleAcces(true);
  }, [lieu]);

  const checkPackAg = useCallback(async (): Promise<boolean> => {
    const res = await fetch('/api/v1/programmation/pack-ag');
    const data = (await res.json()) as PackInfo;
    setPackAg(data);
    const bloque = !data.pack_actif || (data.credits_restants ?? 0) <= 0;
    setAgBloque(bloque);
    if (bloque) setTypesCollecte((prev) => ({ ...prev, ag: false }));
    return bloque;
  }, []);

  const handleAgCheck = async (checked: boolean) => {
    if (checked) {
      const bloque = await checkPackAg();
      if (!bloque) setTypesCollecte((prev) => ({ ...prev, ag: true }));
    } else {
      setTypesCollecte((prev) => ({ ...prev, ag: false }));
    }
  };

  const step1Valid =
    nomClient.trim() !== '' &&
    parseInt(pax) > 0 &&
    typeEvenementId !== '' &&
    (typesCollecte.zd || typesCollecte.ag) &&
    (!needsTraiteurSelector || traiteurOperationnelId !== '');

  const step2Valid = lieu !== null && contactPrincipal !== null;

  const step3Valid = collectes.every(
    (c) => c.date_collecte !== '' && c.heure_collecte !== '',
  );

  const handleAddContactInline = async (target: 'principal' | 'secours') => {
    if (!newContact.prenom || !newContact.nom || !newContact.telephone) return;
    const res = await fetch('/api/v1/programmation/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newContact),
    });
    if (!res.ok) return;
    const created = (await res.json()) as ContactOption;
    if (target === 'principal') setContactPrincipal(created);
    else setContactSecours(created);
    setShowContactForm(null);
    setNewContact({ prenom: '', nom: '', telephone: '', fonction: '' });
  };

  const handleSubmit = async (confirmer: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        nom_evenement: nomClient.trim() || undefined,
        nom_client_organisateur: nomClient.trim() || undefined,
        pax: parseInt(pax),
        type_evenement_id: typeEvenementId,
        reference_affaire: referenceAffaire || undefined,
        lieu_id: lieu!.id,
        controle_acces_requis: controleAcces,
        contact_principal_nom:
          `${contactPrincipal!.prenom} ${contactPrincipal!.nom}`.trim(),
        contact_principal_telephone: contactPrincipal!.telephone,
        contact_secours_nom: contactSecours
          ? `${contactSecours.prenom} ${contactSecours.nom}`.trim()
          : undefined,
        contact_secours_telephone: contactSecours?.telephone,
        collectes: collectes.map((c) => ({
          type: c.type,
          date_collecte: c.date_collecte,
          heure_collecte: c.heure_collecte,
          informations_supplementaires:
            c.informations_supplementaires || undefined,
        })),
        confirmer,
        ...(needsTraiteurSelector && traiteurOperationnelId
          ? { traiteur_operationnel_organisation_id: traiteurOperationnelId }
          : {}),
      };

      const res = await fetch('/api/v1/programmation/evenements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        evenement_id?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la programmation');
        return;
      }

      router.push(
        confirmer
          ? `/programmer/confirmation?id=${data.evenement_id}`
          : '/brouillons',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <FormStepIndicator steps={STEPS} current={step} />

      {/* ── Étape 1 : Événement ── */}
      {step === 0 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Informations sur l'événement
          </h2>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Nom du client final <span className="text-savr-error">*</span>
            </label>
            <input
              type="text"
              value={nomClient}
              onChange={(e) => setNomClient(e.target.value)}
              placeholder="Ex : Entreprise Dupont"
              className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-savr-neutral-700">
                Nombre de convives <span className="text-savr-error">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={pax}
                onChange={(e) => setPax(e.target.value)}
                placeholder="Ex : 80"
                className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-savr-neutral-700">
                Type d'événement <span className="text-savr-error">*</span>
              </label>
              <select
                value={typeEvenementId}
                onChange={(e) => setTypeEvenementId(e.target.value)}
                className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500 bg-savr-white"
              >
                <option value="">Choisir…</option>
                {typesEvenements.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.libelle}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-savr-neutral-700">
              Type(s) de collecte <span className="text-savr-error">*</span>
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700"
                  checked={typesCollecte.zd}
                  onChange={(e) =>
                    setTypesCollecte((p) => ({ ...p, zd: e.target.checked }))
                  }
                />
                <span className="text-sm">
                  <span className="font-medium">Zéro Déchet (ZD)</span>
                  <span className="text-savr-neutral-500 ml-1">
                    — compostage / méthanisation
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 mt-0.5 rounded border-savr-neutral-300 text-savr-primary-700"
                  checked={typesCollecte.ag}
                  onChange={(e) => void handleAgCheck(e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium">Anti-Gaspi (AG)</span>
                  <span className="text-savr-neutral-500 ml-1">
                    — don à association
                  </span>
                  {agBloque && (
                    <span className="block text-savr-error text-xs mt-0.5">
                      Aucun pack AG actif — décchez cette option pour continuer.
                    </span>
                  )}
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Référence client{' '}
              <span className="text-xs font-normal text-savr-neutral-400">
                (optionnel)
              </span>
            </label>
            <input
              type="text"
              value={referenceAffaire}
              onChange={(e) => setReferenceAffaire(e.target.value)}
              placeholder="Ex : CMD-2026-042"
              className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
            />
          </div>

          {needsTraiteurSelector && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-savr-neutral-700">
                Traiteur opérant <span className="text-savr-error">*</span>
              </label>
              <select
                value={traiteurOperationnelId}
                onChange={(e) => setTraiteurOperationnelId(e.target.value)}
                className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500 bg-savr-white"
              >
                <option value="">Choisir un traiteur…</option>
                {traiteurs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom_commercial ?? t.raison_sociale}
                    {t.ville ? ` — ${t.ville}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!step1Valid}>
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 2 : Lieu & contacts ── */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Lieu et contacts
          </h2>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Lieu de collecte <span className="text-savr-error">*</span>
            </label>
            <LieuCombobox
              value={lieu}
              onChange={setLieu}
              onAddManuel={() => setShowLieuManuel(true)}
            />
            {lieu && (
              <p className="text-xs text-savr-neutral-500 mt-1">
                {lieu.adresse_acces}, {lieu.code_postal} {lieu.ville}
              </p>
            )}
          </div>

          {/* Lieu manuel — dialog */}
          <Dialog.Root open={showLieuManuel} onOpenChange={setShowLieuManuel}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-savr-neutral-900/40 z-40" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-savr-lg bg-savr-white p-6 shadow-xl space-y-4">
                <Dialog.Title className="font-semibold text-savr-neutral-900">
                  Ajouter un lieu manuellement
                </Dialog.Title>
                <LieuManuelForm
                  onSave={(l) => {
                    setLieu(l);
                    setShowLieuManuel(false);
                  }}
                  onCancel={() => setShowLieuManuel(false)}
                />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Contrôle d'accès
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700"
                checked={controleAcces}
                onChange={(e) => setControleAcces(e.target.checked)}
              />
              <span className="text-sm">
                Plaque d'immatriculation et nom du chauffeur requis pour ce lieu
              </span>
            </label>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Contact principal sur place{' '}
              <span className="text-savr-error">*</span>
            </label>
            <ContactCombobox
              value={contactPrincipal}
              onChange={setContactPrincipal}
              onAddInline={() => setShowContactForm('principal')}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-savr-neutral-700">
              Contact secours{' '}
              <span className="text-xs font-normal text-savr-neutral-400">
                (optionnel)
              </span>
            </label>
            <ContactCombobox
              value={contactSecours}
              onChange={setContactSecours}
              onAddInline={() => setShowContactForm('secours')}
              label="Ajouter un contact secours…"
            />
          </div>

          {/* Contact inline form — dialog */}
          <Dialog.Root
            open={showContactForm !== null}
            onOpenChange={(v) => !v && setShowContactForm(null)}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-savr-neutral-900/40 z-40" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-savr-lg bg-savr-white p-6 shadow-xl space-y-4">
                <Dialog.Title className="font-semibold text-savr-neutral-900">
                  Nouveau contact
                </Dialog.Title>
                <div className="space-y-3">
                  <input
                    placeholder="Prénom *"
                    value={newContact.prenom}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, prenom: e.target.value }))
                    }
                    className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
                  />
                  <input
                    placeholder="Nom *"
                    value={newContact.nom}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, nom: e.target.value }))
                    }
                    className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
                  />
                  <input
                    placeholder="Téléphone *"
                    type="tel"
                    value={newContact.telephone}
                    onChange={(e) =>
                      setNewContact((p) => ({
                        ...p,
                        telephone: e.target.value,
                      }))
                    }
                    className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
                  />
                  <input
                    placeholder="Fonction (optionnel)"
                    value={newContact.fonction}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, fonction: e.target.value }))
                    }
                    className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="secondary"
                    onClick={() => setShowContactForm(null)}
                  >
                    Annuler
                  </Button>
                  <Button
                    onClick={() =>
                      void handleAddContactInline(showContactForm!)
                    }
                    disabled={
                      !newContact.prenom ||
                      !newContact.nom ||
                      !newContact.telephone
                    }
                  >
                    Ajouter
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Button>
            <Button onClick={() => setStep(2)} disabled={!step2Valid}>
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Collectes + récapitulatif ── */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Détails de la collecte
          </h2>

          {collectes.map((c, i) => (
            <SousBlocCollecte
              key={c.type}
              type={c.type}
              data={c}
              onChange={(updated) =>
                setCollectes((prev) =>
                  prev.map((item, idx) => (idx === i ? updated : item)),
                )
              }
              pack={c.type === 'ag' ? packAg : undefined}
            />
          ))}

          {/* Récapitulatif */}
          <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-neutral-50 p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-savr-neutral-900">
              Récapitulatif
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-savr-neutral-700">
              <span className="text-savr-neutral-500">Client</span>
              <span>{nomClient}</span>
              <span className="text-savr-neutral-500">Convives</span>
              <span>{pax}</span>
              <span className="text-savr-neutral-500">Lieu</span>
              <span>
                {lieu?.nom} — {lieu?.ville}
              </span>
              <span className="text-savr-neutral-500">Contact principal</span>
              <span>
                {contactPrincipal?.prenom} {contactPrincipal?.nom}
              </span>
            </div>
          </div>

          <p className="text-xs text-savr-neutral-500">
            Toute collecte annulée à moins de 12h de l'heure de collecte donne
            lieu à facturation plein tarif — pour une collecte Anti-Gaspi sous
            pack, un crédit est décompté (cf. CGV).
          </p>

          {error && (
            <div className="flex items-center gap-2 rounded-savr-md bg-red-50 border border-savr-error px-3 py-2 text-sm text-savr-error">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Button>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleSubmit(false)}
                disabled={!step3Valid || submitting}
              >
                <Save className="h-4 w-4" />
                Enregistrer en brouillon
              </Button>
              <Button
                onClick={() => void handleSubmit(true)}
                disabled={!step3Valid || submitting}
              >
                <CheckCircle className="h-4 w-4" />
                Confirmer la programmation
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
