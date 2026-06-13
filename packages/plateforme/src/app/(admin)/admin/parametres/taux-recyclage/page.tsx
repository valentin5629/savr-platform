'use client';

import { useEffect, useState } from 'react';
import { Recycle, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface TauxRecyclage {
  id: string;
  code_filiere: string;
  nom_filiere: string;
  taux_captation: number;
  prestataire: string | null;
  source_donnee: string | null;
  actif: boolean;
}

interface ModalState {
  open: boolean;
  filiere: TauxRecyclage | null;
  taux: string;
  commentaire: string;
  saving: boolean;
  error: string | null;
}

export default function TauxRecyclagePage() {
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

  const handleSave = async () => {
    if (!modal.filiere) return;
    setModal((m) => ({ ...m, saving: true, error: null }));

    const taux = parseFloat(modal.taux) / 100;
    const res = await fetch(
      `/api/v1/admin/parametres/taux-recyclage/${modal.filiere.id}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
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
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openModal(f)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Modifier
                </Button>
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
    </div>
  );
}
