'use client';

import { useEffect, useState } from 'react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BORNES_TEXTE_LIBRE } from '@/lib/champs-texte-libre-bornes';
import { TimePicker } from '@/components/ui/time-picker';
import { Textarea } from '@/components/ui/textarea';
import { instantParis } from '@savr/shared/src/temps/index.js';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormActions } from '@/components/ui/form-actions';

interface TypeEvenement {
  id: string;
  libelle: string;
}

// Décision produit Val 2026-06-26 : depuis la fiche collecte, un rôle programmateur
// édite TOUS les champs métier de l'événement parent ET de la collecte (§06.04 l.444,
// §05 §4). lieu / type = verrouillés (§05 l.314). L'enregistrement appelle 2 endpoints :
//   • événement → PATCH /api/v1/programmation/evenements/:id (unifié 4 rôles, émet E2)
//   • collecte  → PATCH {collecteEndpoint} (par espace : traiteur/agence/gestionnaire)

export interface EvenementEditData {
  id: string;
  nom_evenement: string | null;
  pax: number | null;
  type_evenement_id: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
}

export interface CollecteEditData {
  id: string;
  type: string;
  statut: string;
  // Fourni par le pop-up client commun (3 espaces) : arme l'avertissement de
  // reconfirmation du créneau. Optionnel pour les appelants qui ne l'ont pas.
  statut_tms?: string;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  lieu_nom: string | null;
  evenement: EvenementEditData;
}

const STATUTS_EDITABLES = ['programmee', 'validee'];

export function EditerCollecteForm({
  collecte,
  collecteEndpoint,
  onSaved,
  onCancel,
  onConfirmOpenChange,
}: {
  collecte: CollecteEditData;
  collecteEndpoint: string;
  onSaved?: () => void;
  onCancel?: () => void;
  // Signale l'ouverture de la confirmation : un conteneur modal (fiche traiteur
  // en pop-up) ne doit pas se fermer sur l'Échap destiné à cette confirmation.
  onConfirmOpenChange?: (open: boolean) => void;
}) {
  const e = collecte.evenement;
  // État formulaire — événement
  const [nomEvenement, setNomEvenement] = useState(e.nom_evenement ?? '');
  const [pax, setPax] = useState(e.pax != null ? String(e.pax) : '');
  const [typeEvtId, setTypeEvtId] = useState(e.type_evenement_id ?? '');
  const [types, setTypes] = useState<TypeEvenement[]>([]);
  const [nomClient, setNomClient] = useState(e.nom_client_organisateur ?? '');
  const [refAffaire, setRefAffaire] = useState(e.reference_affaire ?? '');
  const [cpNom, setCpNom] = useState(e.contact_principal_nom ?? '');
  const [cpTel, setCpTel] = useState(e.contact_principal_telephone ?? '');
  const [csNom, setCsNom] = useState(e.contact_secours_nom ?? '');
  const [csTel, setCsTel] = useState(e.contact_secours_telephone ?? '');
  // État formulaire — collecte
  const [dateCollecte, setDateCollecte] = useState(collecte.date_collecte);
  const [heureCollecte, setHeureCollecte] = useState(
    collecte.heure_collecte?.slice(0, 5) ?? '',
  );
  const [controleAcces, setControleAcces] = useState(
    collecte.controle_acces_requis,
  );
  const [infosSuppl, setInfosSuppl] = useState(
    collecte.informations_supplementaires ?? '',
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    onConfirmOpenChange?.(confirmOpen);
    // Démontage confirmation ouverte : la garde du conteneur ne doit pas rester bloquée.
    return () => onConfirmOpenChange?.(false);
  }, [confirmOpen, onConfirmOpenChange]);

  // Types d'événement éditables (§06.04 l.446 « type d'événement »).
  useEffect(() => {
    fetch('/api/v1/programmation/types-evenements')
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setTypes(Array.isArray(j) ? (j as TypeEvenement[]) : []))
      .catch(() => setTypes([]));
  }, []);

  const editable = STATUTS_EDITABLES.includes(collecte.statut);

  // Créneau < 12h → avertissement priorité (§05 l.316, §06.04 l.483).
  const creneau = instantParis(dateCollecte, `${heureCollecte || '00:00'}:00`);
  const urgence = creneau.getTime() - Date.now() < 12 * 3600 * 1000;
  // Réacceptation prestataire (§06.04 l.505) : modif de créneau sur collecte
  // acceptée → le prestataire devra re-confirmer.
  const dateHeureModifiee =
    dateCollecte !== collecte.date_collecte ||
    heureCollecte !== (collecte.heure_collecte?.slice(0, 5) ?? '');
  const reacceptation = dateHeureModifiee && collecte.statut_tms === 'acceptee';

  // Confirmation (§06.04 l.501-507) : modal unique empilant les avertissements
  // applicables (priorité urgence < 12h + réacceptation prestataire). Si aucun
  // avertissement → sauvegarde directe sans modal.
  function onSubmitClick() {
    if (urgence || reacceptation) setConfirmOpen(true);
    else void save();
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // 1. Champs ÉVÉNEMENT modifiés.
      const evtUpdates: Record<string, unknown> = {};
      if (nomEvenement !== (e.nom_evenement ?? ''))
        evtUpdates.nom_evenement = nomEvenement || null;
      if (pax !== (e.pax != null ? String(e.pax) : ''))
        evtUpdates.pax = pax === '' ? null : Number(pax);
      if (typeEvtId && typeEvtId !== (e.type_evenement_id ?? ''))
        evtUpdates.type_evenement_id = typeEvtId;
      if (nomClient !== (e.nom_client_organisateur ?? ''))
        evtUpdates.nom_client_organisateur = nomClient || null;
      if (refAffaire !== (e.reference_affaire ?? ''))
        evtUpdates.reference_affaire = refAffaire || null;
      if (cpNom !== (e.contact_principal_nom ?? ''))
        evtUpdates.contact_principal_nom = cpNom;
      if (cpTel !== (e.contact_principal_telephone ?? ''))
        evtUpdates.contact_principal_telephone = cpTel;
      if (csNom !== (e.contact_secours_nom ?? ''))
        evtUpdates.contact_secours_nom = csNom || null;
      if (csTel !== (e.contact_secours_telephone ?? ''))
        evtUpdates.contact_secours_telephone = csTel || null;

      if (Object.keys(evtUpdates).length > 0) {
        const res = await fetch(
          `/api/v1/programmation/evenements/${encodeURIComponent(e.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(evtUpdates),
          },
        );
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Échec de l'édition de l'événement");
        }
      }

      // 2. Champs COLLECTE modifiés.
      const colUpdates: Record<string, unknown> = {};
      if (dateCollecte !== collecte.date_collecte)
        colUpdates.date_collecte = dateCollecte;
      if (heureCollecte !== (collecte.heure_collecte?.slice(0, 5) ?? ''))
        colUpdates.heure_collecte = heureCollecte
          ? `${heureCollecte}:00`
          : null;
      if (controleAcces !== collecte.controle_acces_requis)
        colUpdates.controle_acces_requis = controleAcces;
      if (infosSuppl !== (collecte.informations_supplementaires ?? ''))
        colUpdates.informations_supplementaires = infosSuppl || null;

      if (Object.keys(colUpdates).length > 0) {
        const res = await fetch(collecteEndpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(colUpdates),
        });
        if (!res.ok) {
          const j = (await res.json()) as { error?: string };
          throw new Error(j.error ?? "Échec de l'édition de la collecte");
        }
      }

      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <Card data-testid="editer-collecte-verrou">
        <CardContent className="pt-6 text-sm text-savr-neutral-500">
          Cette collecte n&apos;est plus modifiable (statut {collecte.statut}).
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="editer-collecte-form">
      <CardHeader>
        <CardTitle>Éditer la collecte et l&apos;événement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Champs événement ──────────────────────────────────────── */}
        <section className="space-y-4">
          <Heading level={3} size="sm">
            Événement
          </Heading>
          <FormField label="Nom de l'événement" htmlFor="edit-evt-nom">
            <Input
              id="edit-evt-nom"
              value={nomEvenement}
              onChange={(ev) => setNomEvenement(ev.target.value)}
            />
          </FormField>
          <FormGrid>
            <FormField label="Nombre de convives (pax)" htmlFor="edit-evt-pax">
              <Input
                id="edit-evt-pax"
                type="number"
                min={0}
                value={pax}
                onChange={(ev) => setPax(ev.target.value)}
              />
            </FormField>
            <FormField label="Client final" htmlFor="edit-evt-client">
              <Input
                id="edit-evt-client"
                value={nomClient}
                onChange={(ev) => setNomClient(ev.target.value)}
              />
            </FormField>
          </FormGrid>
          <FormField label="Type d'événement" htmlFor="edit-evt-type">
            <Combobox
              id="edit-evt-type"
              icon={null}
              placeholder="Choisir un type"
              searchPlaceholder="Rechercher un type…"
              options={
                types.length === 0 && typeEvtId
                  ? [{ value: typeEvtId, label: '—' }]
                  : types.map((t) => ({ value: t.id, label: t.libelle }))
              }
              value={typeEvtId}
              onChange={setTypeEvtId}
            />
          </FormField>
          <FormField label="Référence affaire" htmlFor="edit-evt-ref-affaire">
            <Input
              id="edit-evt-ref-affaire"
              value={refAffaire}
              onChange={(ev) => setRefAffaire(ev.target.value)}
            />
          </FormField>
          {/* Contact principal (sous-bloc) */}
          <div className="space-y-3 rounded-savr-md border border-savr-neutral-200 p-3">
            <Text tone="strong" className="font-semibold">
              Contact principal
            </Text>
            <FormGrid>
              <FormField label="Prénom et nom" htmlFor="edit-cp-nom">
                <Input
                  id="edit-cp-nom"
                  value={cpNom}
                  onChange={(ev) => setCpNom(ev.target.value)}
                />
              </FormField>
              <FormField label="Numéro de téléphone" htmlFor="edit-cp-tel">
                <Input
                  id="edit-cp-tel"
                  value={cpTel}
                  onChange={(ev) => setCpTel(ev.target.value)}
                />
              </FormField>
            </FormGrid>
          </div>
          {/* Contact de secours (sous-bloc) */}
          <div className="space-y-3 rounded-savr-md border border-savr-neutral-200 p-3">
            <Text tone="strong" className="font-semibold">
              Contact de secours
            </Text>
            <FormGrid>
              <FormField label="Prénom et nom" htmlFor="edit-cs-nom">
                <Input
                  id="edit-cs-nom"
                  value={csNom}
                  onChange={(ev) => setCsNom(ev.target.value)}
                />
              </FormField>
              <FormField label="Numéro de téléphone" htmlFor="edit-cs-tel">
                <Input
                  id="edit-cs-tel"
                  value={csTel}
                  onChange={(ev) => setCsTel(ev.target.value)}
                />
              </FormField>
            </FormGrid>
          </div>
        </section>

        {/* ── Champs collecte ───────────────────────────────────────── */}
        <section className="space-y-4">
          <Heading level={3} size="sm">
            Collecte
          </Heading>
          <FormGrid>
            <FormField label="Date de collecte" htmlFor="edit-date-collecte">
              <DatePicker
                id="edit-date-collecte"
                value={dateCollecte}
                onChange={setDateCollecte}
              />
            </FormField>
            <FormField label="Heure de collecte" htmlFor="edit-heure-collecte">
              <TimePicker
                id="edit-heure-collecte"
                value={heureCollecte}
                onChange={setHeureCollecte}
              />
            </FormField>
          </FormGrid>
          <Label variant="choice" className="flex items-center gap-3">
            <Checkbox
              checked={controleAcces}
              onCheckedChange={(v) => setControleAcces(v === true)}
            />
            <span>Contrôle d&apos;accès requis</span>
          </Label>
          <FormField
            label="Informations supplémentaires"
            htmlFor="edit-infos-suppl"
          >
            <Textarea
              id="edit-infos-suppl"
              rows={3}
              maxLength={BORNES_TEXTE_LIBRE.informations_supplementaires.max}
              value={infosSuppl}
              onChange={(ev) => setInfosSuppl(ev.target.value)}
            />
          </FormField>
        </section>

        {/* ── Champs verrouillés (§05 l.314 / §06.04 l.460) ─────────── */}
        <section className="space-y-2 rounded-savr-md bg-savr-neutral-50 p-3">
          <Text variant="hint">
            Lieu : <strong>{collecte.lieu_nom ?? '—'}</strong> · Type :{' '}
            <strong>{libelleTypeCollecte(collecte.type)}</strong>
          </Text>
          <Text variant="faint">
            Pour changer le lieu ou le type de collecte, annulez cette collecte
            et programmez-en une nouvelle.
          </Text>
        </section>

        {urgence && (
          <AlertBar variant="warn">
            Cette modification a lieu moins de 12h avant la collecte. Notre
            équipe Ops sera alertée en urgence.
          </AlertBar>
        )}
        {error && (
          <AlertBar variant="err" role="alert">
            {error}
          </AlertBar>
        )}

        <FormActions
          cancel={
            onCancel
              ? { label: 'Annuler', variant: 'ghost', onClick: onCancel }
              : undefined
          }
          submit={{
            label: 'Confirmer la modification',
            type: 'button',
            onClick: onSubmitClick,
          }}
          loading={saving}
          loadingText="Enregistrement…"
        />

        {/* Modal de confirmation unique (§06.04 l.501-507) — empile les
            avertissements applicables avant la sauvegarde. */}
        <ConfirmDialog
          open={confirmOpen}
          title="Confirmer la modification"
          confirmLabel="Confirmer la modification"
          cancelLabel="Annuler"
          variant="primary"
          loading={saving}
          onConfirm={() => {
            setConfirmOpen(false);
            void save();
          }}
          onCancel={() => setConfirmOpen(false)}
        >
          <ul className="list-disc space-y-2 pl-5 text-sm text-savr-neutral-700">
            {urgence && (
              <li>
                Cette modification a lieu moins de 12h avant la collecte. Notre
                équipe Ops sera alertée en urgence.
              </li>
            )}
            {reacceptation && (
              <li>
                Ce nouveau créneau devra être reconfirmé par notre équipe
                logistique.
              </li>
            )}
          </ul>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}
