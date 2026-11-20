'use client';

// Recadrage d'une photo de collecte (décisions Val 2026-11-20, C1 et C2) :
// l'éditeur part toujours de l'original, l'Admin trace le cadre, la version
// recadrée remplace la photo affichée partout, l'original est gardé.

import { useEffect, useRef, useState } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { AlertBar } from '@/components/ui/alert-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';

interface Props {
  /** Photo à recadrer ; null = fenêtre fermée. */
  photoId: string | null;
  collecteId: string;
  /** La photo est-elle déjà recadrée (propose « Revenir à l'original ») ? */
  recadree: boolean;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}

// Côté le plus long de la photo recadrée : sous le plafond de 5 Mo de l'API,
// et bien assez pour l'écran comme pour un rapport.
const COTE_MAX = 2400;

// Cadre de départ : toute l'image, en pourcentage.
const CADRE_ENTIER: Crop = { unit: '%', x: 0, y: 0, width: 100, height: 100 };

function decouper(image: HTMLImageElement, cadre: PixelCrop): Promise<Blob> {
  // Le cadre est en pixels AFFICHÉS : on le ramène aux pixels de l'original.
  const echelleX = image.naturalWidth / image.width;
  const echelleY = image.naturalHeight / image.height;
  const largeur = cadre.width * echelleX;
  const hauteur = cadre.height * echelleY;
  const reduction = Math.min(1, COTE_MAX / Math.max(largeur, hauteur));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(largeur * reduction));
  canvas.height = Math.max(1, Math.round(hauteur * reduction));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas indisponible'));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    cadre.x * echelleX,
    cadre.y * echelleY,
    largeur,
    hauteur,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('découpe impossible'))),
      'image/jpeg',
      0.9,
    ),
  );
}

export function PhotoRecadrageModal({
  photoId,
  collecteId,
  recadree,
  onClose,
  onSaved,
}: Props) {
  const [source, setSource] = useState<string | null>(null);
  const [cadre, setCadre] = useState<Crop>(CADRE_ENTIER);
  const [cadrePixels, setCadrePixels] = useState<PixelCrop | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<'recadrer' | 'original' | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const url = photoId
    ? `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/photos/${encodeURIComponent(photoId)}/recadrage`
    : null;

  // L'original est lu par Savr (même origine) : une image d'un autre site ne se
  // découpe pas dans le navigateur.
  useEffect(() => {
    if (!url) return;
    let annule = false;
    let objet: string | null = null;
    setSource(null);
    setCadre(CADRE_ENTIER);
    setCadrePixels(null);
    setErreur(null);
    void (async () => {
      const res = await fetch(url).catch(() => null);
      if (annule) return;
      if (!res?.ok) {
        setErreur("L'original de la photo est indisponible, réessayez");
        return;
      }
      const blob = await res.blob();
      if (annule) return;
      objet = URL.createObjectURL(blob);
      setSource(objet);
    })();
    return () => {
      annule = true;
      if (objet) URL.revokeObjectURL(objet);
    };
  }, [url]);

  const enregistrer = async () => {
    if (!url || !imageRef.current || !cadrePixels) return;
    if (cadrePixels.width < 1 || cadrePixels.height < 1) return;
    setEnvoi('recadrer');
    setErreur(null);
    let blob: Blob;
    try {
      blob = await decouper(imageRef.current, cadrePixels);
    } catch {
      setEnvoi(null);
      setErreur('Recadrage impossible dans ce navigateur');
      return;
    }
    const form = new FormData();
    form.append('fichier', blob, 'photo-recadree.jpg');
    const res = await fetch(url, { method: 'PUT', body: form }).catch(
      () => null,
    );
    setEnvoi(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string };
      setErreur(body?.error ?? 'Enregistrement impossible, réessayez');
      return;
    }
    await onSaved('Photo recadrée');
    onClose();
  };

  const revenir = async () => {
    if (!url) return;
    setEnvoi('original');
    setErreur(null);
    const res = await fetch(url, { method: 'DELETE' }).catch(() => null);
    setEnvoi(null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string };
      setErreur(body?.error ?? "Retour à l'original impossible, réessayez");
      return;
    }
    await onSaved("Photo remise à l'original");
    onClose();
  };

  const cadreValide =
    cadrePixels !== null && cadrePixels.width >= 1 && cadrePixels.height >= 1;

  return (
    <Modal
      open={photoId !== null}
      wide
      title="Recadrer la photo"
      // Pas de fermeture pendant l'enregistrement : sa réponse fermerait la
      // fenêtre rouverte sur une autre photo.
      onClose={envoi ? () => {} : onClose}
      footer={
        <>
          {recadree && (
            <Button
              variant="secondary"
              onClick={() => void revenir()}
              disabled={envoi !== null}
              loading={envoi === 'original'}
            >
              Revenir à l&apos;original
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={envoi !== null}
          >
            Annuler
          </Button>
          <Button
            onClick={() => void enregistrer()}
            disabled={!cadreValide || envoi !== null}
            loading={envoi === 'recadrer'}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {erreur && (
        <AlertBar variant="err" className="mb-4">
          {erreur}
        </AlertBar>
      )}
      <Text variant="hint" className="mb-3">
        Tracez le cadre à garder. La photo recadrée remplace celle affichée
        partout, l&apos;original est conservé.
      </Text>
      {source ? (
        <div
          className="flex justify-center"
          // Cadre et poignées aux couleurs du DS (variables de react-image-crop).
          style={
            {
              '--rc-focus-color': 'var(--primary)',
              '--rc-drag-handle-bg-colour': 'var(--primary)',
              '--rc-border-color': 'var(--color-savr-white)',
            } as React.CSSProperties
          }
        >
          <ReactCrop
            crop={cadre}
            onChange={(_px, pourcent) => setCadre(pourcent)}
            onComplete={(px) => setCadrePixels(px)}
            keepSelection
            ruleOfThirds
          >
            <img
              ref={imageRef}
              src={source}
              alt="Photo à recadrer"
              className="max-h-[60vh] w-auto"
              onLoad={(e) => {
                const img = e.currentTarget;
                setCadrePixels({
                  unit: 'px',
                  x: 0,
                  y: 0,
                  width: img.width,
                  height: img.height,
                });
              }}
            />
          </ReactCrop>
        </div>
      ) : (
        !erreur && <Skeleton className="h-64 w-full" />
      )}
    </Modal>
  );
}
