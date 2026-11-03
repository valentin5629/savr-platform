'use client';

// Choix des photos du livreur à garder (décision Val 2026-11-03) : la fenêtre
// relit les photos chez le transporteur de la collecte, l'Admin coche celles
// qu'il garde, elles sont importées non cochées « Visible du client ».

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { AlertBar } from '@/components/ui/alert-bar';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';

interface PhotoLivreur {
  id: string;
  url: string;
  prise_le: string | null;
  course: number;
  deja_importee: boolean;
}

interface Props {
  open: boolean;
  collecteId: string;
  onClose: () => void;
  /** Après un import réussi (au moins une photo) : recharger la galerie. */
  onImported: (message: string) => void | Promise<void>;
}

function heure(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PhotosTransporteurModal({
  open,
  collecteId,
  onClose,
  onImported,
}: Props) {
  const [photos, setPhotos] = useState<PhotoLivreur[] | null>(null);
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const url = `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/photos/transporteur`;

  useEffect(() => {
    if (!open) return;
    let annule = false;
    setPhotos(null);
    setChoix(new Set());
    setErreur(null);
    void (async () => {
      const res = await fetch(url).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as {
        photos?: PhotoLivreur[];
        error?: string;
      };
      if (annule) return;
      if (res?.ok && body.photos) setPhotos(body.photos);
      else {
        setPhotos([]);
        setErreur(body?.error ?? 'Photos du livreur indisponibles');
      }
    })();
    return () => {
      annule = true;
    };
  }, [open, url]);

  const basculer = (id: string, coche: boolean) =>
    setChoix((prev) => {
      const next = new Set(prev);
      if (coche) next.add(id);
      else next.delete(id);
      return next;
    });

  const importer = async () => {
    setEnvoi(true);
    setErreur(null);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...choix] }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as {
      importees?: number;
      echecs?: number;
      error?: string;
    };
    setEnvoi(false);
    if (!res?.ok || !body.importees) {
      setErreur(body?.error ?? 'Import des photos impossible, réessayez');
      return;
    }
    const n = body.importees;
    const echecs = body.echecs ?? 0;
    await onImported(
      `${n} photo${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}` +
        (echecs > 0 ? `, ${echecs} en échec` : ''),
    );
    onClose();
  };

  const n = choix.size;
  const plusieursCourses =
    new Set((photos ?? []).map((p) => p.course)).size > 1;

  return (
    <Modal
      open={open}
      wide
      title="Photos du livreur"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={envoi}>
            Annuler
          </Button>
          <Button
            onClick={() => void importer()}
            disabled={n === 0 || envoi}
            loading={envoi}
          >
            {n === 0 ? 'Importer' : `Importer ${n} photo${n > 1 ? 's' : ''}`}
          </Button>
        </>
      }
    >
      {erreur && (
        <AlertBar variant="err" className="mb-4">
          {erreur}
        </AlertBar>
      )}
      {photos === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : photos.length === 0 ? (
        !erreur && (
          <EmptyState
            size="inline"
            title="Le livreur n'a pris aucune photo pour le moment."
          />
        )
      ) : (
        <>
          <Text variant="hint" className="mb-3">
            Cochez les photos à garder. Elles ne sont pas visibles du client
            tant que vous ne les cochez pas dans la galerie.
          </Text>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p) => {
              const legende = [
                plusieursCourses ? `Course ${p.course}` : null,
                heure(p.prise_le),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <Label
                  key={p.id}
                  variant="choice"
                  className="block space-y-1.5"
                >
                  <img
                    src={p.url}
                    alt={
                      legende
                        ? `Photo du livreur, ${legende}`
                        : 'Photo du livreur'
                    }
                    className="h-32 w-full object-cover rounded-savr-md border border-savr-neutral-200"
                  />
                  <span className="flex min-h-11 items-center gap-2">
                    <Checkbox
                      checked={p.deja_importee || choix.has(p.id)}
                      disabled={p.deja_importee || envoi}
                      onCheckedChange={(v) => basculer(p.id, v === true)}
                    />
                    <span>
                      {p.deja_importee ? 'Déjà importée' : legende || 'Garder'}
                    </span>
                  </span>
                </Label>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
