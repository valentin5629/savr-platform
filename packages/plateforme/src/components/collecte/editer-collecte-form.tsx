'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';

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
  notes_internes: string | null;
}

export interface CollecteEditData {
  id: string;
  type: string;
  statut: string;
  // Optionnel : seule la fiche traiteur le fournit en V1 (BL-P1-TRAIT-03) →
  // l'avertissement de réacceptation prestataire ne s'affiche que là. Les fiches
  // agence/gestionnaire conservent le modal (urgence seule) sans régression.
  statut_tms?: string;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  notes_internes: string | null;
  lieu_nom: string | null;
  evenement: EvenementEditData;
}

const INPUT_CLS =
  'w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500';
const LABEL_CLS = 'text-sm font-medium text-savr-neutral-700';

const STATUTS_EDITABLES = ['programmee', 'validee'];

export function EditerCollecteForm({
  collecte,
  collecteEndpoint,
  onSaved,
  onCancel,
}: {
  collecte: CollecteEditData;
  collecteEndpoint: string;
  onSaved?: () => void;
  onCancel?: () => void;
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
  const [notesCollecte, setNotesCollecte] = useState(
    collecte.notes_internes ?? '',
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Types d'événement éditables (§06.04 l.446 « type d'événement »).
  useEffect(() => {
    fetch('/api/v1/programmation/types-evenements')
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setTypes(Array.isArray(j) ? (j as TypeEvenement[]) : []))
      .catch(() => setTypes([]));
  }, []);

  const editable = STATUTS_EDITABLES.includes(collecte.statut);

  // Créneau < 12h → avertissement priorité (§05 l.316, §06.04 l.483).
  const creneau = new Date(`${dateCollecte}T${heureCollecte || '00:00'}:00`);
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
        const res = await fetch(`/api/v1/programmation/evenements/${e.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(evtUpdates),
        });
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
      if (notesCollecte !== (collecte.notes_internes ?? ''))
        colUpdates.notes_internes = notesCollecte || null;

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
          <h3 className="text-sm font-semibold text-savr-neutral-900">
            Événement
          </h3>
          <div className="space-y-1">
            <label className={LABEL_CLS}>Nom de l&apos;événement</label>
            <input
              className={INPUT_CLS}
              value={nomEvenement}
              onChange={(ev) => setNomEvenement(ev.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={LABEL_CLS}>Nombre de convives (pax)</label>
              <input
                type="number"
                min={0}
                className={INPUT_CLS}
                value={pax}
                onChange={(ev) => setPax(ev.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL_CLS}>Client final</label>
              <input
                className={INPUT_CLS}
                value={nomClient}
                onChange={(ev) => setNomClient(ev.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className={LABEL_CLS}>Type d&apos;événement</label>
            <select
              className={`${INPUT_CLS} bg-savr-white`}
              value={typeEvtId}
              onChange={(ev) => setTypeEvtId(ev.target.value)}
            >
              {types.length === 0 && typeEvtId && (
                <option value={typeEvtId}>—</option>
              )}
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.libelle}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL_CLS}>Référence affaire</label>
            <input
              className={INPUT_CLS}
              value={refAffaire}
              onChange={(ev) => setRefAffaire(ev.target.value)}
            />
          </div>
          {/* Contact principal (sous-bloc) */}
          <div className="space-y-3 rounded-savr-md border border-savr-neutral-200 p-3">
            <p className="text-sm font-semibold text-savr-neutral-800">
              Contact principal
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={LABEL_CLS}>Prénom et nom</label>
                <input
                  className={INPUT_CLS}
                  value={cpNom}
                  onChange={(ev) => setCpNom(ev.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL_CLS}>Numéro de téléphone</label>
                <input
                  className={INPUT_CLS}
                  value={cpTel}
                  onChange={(ev) => setCpTel(ev.target.value)}
                />
              </div>
            </div>
          </div>
          {/* Contact de secours (sous-bloc) */}
          <div className="space-y-3 rounded-savr-md border border-savr-neutral-200 p-3">
            <p className="text-sm font-semibold text-savr-neutral-800">
              Contact de secours
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={LABEL_CLS}>Prénom et nom</label>
                <input
                  className={INPUT_CLS}
                  value={csNom}
                  onChange={(ev) => setCsNom(ev.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className={LABEL_CLS}>Numéro de téléphone</label>
                <input
                  className={INPUT_CLS}
                  value={csTel}
                  onChange={(ev) => setCsTel(ev.target.value)}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Champs collecte ───────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-900">
            Collecte
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={LABEL_CLS}>Date de collecte</label>
              <input
                type="date"
                className={INPUT_CLS}
                value={dateCollecte}
                onChange={(ev) => setDateCollecte(ev.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className={LABEL_CLS}>Heure de collecte</label>
              <input
                type="time"
                className={INPUT_CLS}
                value={heureCollecte}
                onChange={(ev) => setHeureCollecte(ev.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700"
              checked={controleAcces}
              onChange={(ev) => setControleAcces(ev.target.checked)}
            />
            <span className="text-sm">Contrôle d&apos;accès requis</span>
          </label>
          <div className="space-y-1">
            <label className={LABEL_CLS}>Informations supplémentaires</label>
            <textarea
              className={INPUT_CLS}
              rows={3}
              maxLength={1000}
              value={infosSuppl}
              onChange={(ev) => setInfosSuppl(ev.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={LABEL_CLS}>Notes internes</label>
            <textarea
              className={INPUT_CLS}
              rows={2}
              value={notesCollecte}
              onChange={(ev) => setNotesCollecte(ev.target.value)}
            />
          </div>
        </section>

        {/* ── Champs verrouillés (§05 l.314 / §06.04 l.460) ─────────── */}
        <section className="space-y-2 rounded-savr-md bg-savr-neutral-50 p-3">
          <p className="text-xs text-savr-neutral-500">
            Lieu : <strong>{collecte.lieu_nom ?? '—'}</strong> · Type :{' '}
            <strong>{collecte.type}</strong>
          </p>
          <p className="text-xs text-savr-neutral-400">
            Pour changer le lieu ou le type de collecte, annulez cette collecte
            et programmez-en une nouvelle.
          </p>
        </section>

        {urgence && (
          <p className="rounded-savr-md bg-savr-warning-subtle px-3 py-2 text-sm text-savr-warning-strong">
            Cette modification a lieu moins de 12h avant la collecte. Notre
            équipe Ops sera alertée en urgence.
          </p>
        )}
        {error && <p className="text-sm text-savr-error">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={onSubmitClick} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Confirmer la modification'}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Annuler
            </Button>
          )}
        </div>

        {/* Modal de confirmation unique (§06.04 l.501-507) — empile les
            avertissements applicables avant la sauvegarde. */}
        <Modal
          open={confirmOpen}
          title="Confirmer la modification"
          onClose={() => setConfirmOpen(false)}
        >
          <div className="space-y-3">
            <ul className="list-disc space-y-2 pl-5 text-sm text-savr-neutral-700">
              {urgence && (
                <li>
                  Cette modification a lieu moins de 12h avant la collecte.
                  Notre équipe Ops sera alertée en urgence pour relayer au
                  prestataire si besoin.
                </li>
              )}
              {reacceptation && (
                <li>
                  Cette modification de créneau invalidera l’acceptation du
                  prestataire qui devra re-confirmer.
                </li>
              )}
            </ul>
            <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
              <Button
                variant="secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={saving}
              >
                Annuler
              </Button>
              <Button
                onClick={() => {
                  setConfirmOpen(false);
                  void save();
                }}
                disabled={saving}
              >
                Confirmer la modification
              </Button>
            </div>
          </div>
        </Modal>
      </CardContent>
    </Card>
  );
}
