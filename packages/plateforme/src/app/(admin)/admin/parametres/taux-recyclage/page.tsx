'use client';

import { useEffect, useState } from 'react';
import { Recycle, Edit, History, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/lib/use-user-role';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';

interface TauxRecyclage {
  id: string;
  code_filiere: string;
  nom_filiere: string;
  taux_captation: number;
  prestataire: string | null;
  source_donnee: string | null;
  actif: boolean;
}

interface HistoryRow {
  id: string;
  taux_captation_avant: number;
  taux_captation_apres: number;
  prestataire_avant: string | null;
  prestataire_apres: string | null;
  source_donnee_avant: string | null;
  source_donnee_apres: string | null;
  commentaire_modif: string;
  modifie_par_nom: string;
  modifie_le: string;
}

interface ModalState {
  open: boolean;
  filiere: TauxRecyclage | null;
  taux: string;
  commentaire: string;
  saving: boolean;
  error: string | null;
}

interface HistState {
  open: boolean;
  filiere: TauxRecyclage | null;
  rows: HistoryRow[];
  loading: boolean;
}

const pct = (v: number) => `${(v * 100).toFixed(2)} %`;

export default function TauxRecyclagePage() {
  const role = useUserRole();
  const canEdit = role === 'admin_savr';

  const [filieres, setFilieres] = useState<TauxRecyclage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({
    open: false,
    filiere: null,
    taux: '',
    commentaire: '',
    saving: false,
    error: null,
  });
  const [hist, setHist] = useState<HistState>({
    open: false,
    filiere: null,
    rows: [],
    loading: false,
  });

  useEffect(() => {
    fetch('/api/v1/admin/parametres/taux-recyclage')
      .then((r) => r.json())
      .then((d: { data: TauxRecyclage[] }) => setFilieres(d.data))
      .finally(() => setLoading(false));
  }, []);

  const openModal = (filiere: TauxRecyclage) => {
    setModal({
      open: true,
      filiere,
      taux: String(filiere.taux_captation * 100),
      commentaire: '',
      saving: false,
      error: null,
    });
  };

  const closeModal = () =>
    setModal((m) => ({ ...m, open: false, filiere: null }));

  const openHistory = (filiere: TauxRecyclage) => {
    setHist({ open: true, filiere, rows: [], loading: true });
    fetch(`/api/v1/admin/parametres/taux-recyclage/${filiere.id}`)
      .then((r) => r.json())
      .then((d: { data: HistoryRow[] }) =>
        setHist((h) => ({ ...h, rows: d.data ?? [], loading: false })),
      )
      .catch(() => setHist((h) => ({ ...h, loading: false })));
  };

  const closeHistory = () =>
    setHist((h) => ({ ...h, open: false, filiere: null }));

  const handleSave = async () => {
    if (!modal.filiere) return;
    setModal((m) => ({ ...m, saving: true, error: null }));

    const taux = parseFloat(modal.taux) / 100;
    const res = await fetch(
      `/api/v1/admin/parametres/taux-recyclage/${modal.filiere.id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          // CDC §9 l.783 : Idempotency-Key UUID v4 généré côté front.
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          taux_captation: taux,
          commentaire_modif: modal.commentaire,
        }),
      },
    );

    if (res.ok) {
      const updated = (await res.json()) as TauxRecyclage;
      setFilieres((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f)),
      );
      closeModal();
    } else {
      const body = (await res.json()) as { error: string };
      setModal((m) => ({ ...m, saving: false, error: body.error }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Recycle className="h-6 w-6 text-savr-neutral-600" />
        <h1 className="text-2xl font-bold text-savr-neutral-900">
          Paramètres — Taux de recyclage
        </h1>
      </div>

      {!canEdit && <OpsReadOnlyBanner />}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filieres.map((f) => (
            <Card key={f.id} className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-savr-neutral-800">
                  {f.nom_filiere}
                </h3>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openHistory(f)}
                  >
                    <History className="h-4 w-4 mr-1" />
                    Historique
                  </Button>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openModal(f)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Modifier
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-savr-neutral-900">
                  {(f.taux_captation * 100).toFixed(1)} %
                </span>
                <span className="text-sm text-savr-neutral-500 mb-1">
                  taux de captation
                </span>
              </div>
              {f.prestataire && (
                <p className="text-sm text-savr-neutral-500">
                  Prestataire : {f.prestataire}
                </p>
              )}
              {f.source_donnee && (
                <p className="text-xs text-savr-neutral-400">
                  Source : {f.source_donnee}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Modal modification */}
      {modal.open && modal.filiere && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h2 className="font-semibold text-savr-neutral-900">
              Modifier — {modal.filiere.nom_filiere}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-savr-neutral-600 block mb-1">
                  Taux de captation (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
                  value={modal.taux}
                  onChange={(e) =>
                    setModal((m) => ({ ...m, taux: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-sm text-savr-neutral-600 block mb-1">
                  Commentaire de modification (obligatoire)
                </label>
                <textarea
                  className="w-full border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm resize-none"
                  rows={3}
                  placeholder="Motif de la modification…"
                  value={modal.commentaire}
                  onChange={(e) =>
                    setModal((m) => ({ ...m, commentaire: e.target.value }))
                  }
                />
              </div>
              {modal.error && (
                <p className="text-savr-error-600 text-sm">{modal.error}</p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal}>
                Annuler
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={modal.saving || modal.commentaire.length < 5}
              >
                {modal.saving ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historique (lecture seule — CDC §9 l.796-800) */}
      {hist.open && hist.filiere && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-savr-neutral-100 px-6 py-4">
              <h2 className="font-semibold text-savr-neutral-900">
                Historique — {hist.filiere.nom_filiere}
              </h2>
              <button onClick={closeHistory} aria-label="Fermer">
                <X className="h-5 w-5 text-savr-neutral-400" />
              </button>
            </div>
            <div className="p-6">
              {hist.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : hist.rows.length === 0 ? (
                <p className="text-sm text-savr-neutral-500">
                  Aucune modification enregistrée.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-savr-neutral-500 text-left">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Modifié par</th>
                      <th className="py-2 pr-3 font-medium">Taux</th>
                      <th className="py-2 pr-3 font-medium">Prestataire</th>
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 font-medium">Commentaire</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-savr-neutral-100 align-top">
                    {hist.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 text-savr-neutral-600 whitespace-nowrap">
                          {new Date(r.modifie_le).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="py-2 pr-3 text-savr-neutral-700">
                          {r.modifie_par_nom}
                        </td>
                        <td className="py-2 pr-3 text-savr-neutral-700 whitespace-nowrap">
                          {pct(r.taux_captation_avant)} →{' '}
                          {pct(r.taux_captation_apres)}
                        </td>
                        <td className="py-2 pr-3 text-savr-neutral-600">
                          {r.prestataire_avant !== r.prestataire_apres
                            ? `${r.prestataire_avant ?? '—'} → ${r.prestataire_apres ?? '—'}`
                            : (r.prestataire_apres ?? '—')}
                        </td>
                        <td className="py-2 pr-3 text-savr-neutral-600">
                          {r.source_donnee_avant !== r.source_donnee_apres
                            ? `${r.source_donnee_avant ?? '—'} → ${r.source_donnee_apres ?? '—'}`
                            : (r.source_donnee_apres ?? '—')}
                        </td>
                        <td className="py-2 text-savr-neutral-600">
                          {r.commentaire_modif}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
