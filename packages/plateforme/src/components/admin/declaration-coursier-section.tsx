'use client';

// Bloc « Déclaration du coursier » de la fiche collecte Admin (décision Val
// 2026-11-17) : ce que le coursier a saisi à « Colis récupéré » (poids pesé,
// tranches de poids, caisse, attente), relu chez le transporteur à l'ouverture.
// Lecture seule : le poids du don se corrige dans le bloc qui lui est dédié.

import { useEffect, useState } from 'react';
import { AlertBar } from '@/components/ui/alert-bar';
import { FicheSection } from '@/components/ui/fiche/fiche-section';
import { InfoItem } from '@/components/ui/info-item';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';

interface Declaration {
  course: number;
  declare_le: string | null;
  poids_kg: number | null;
  champs: Array<{ nom: string; valeur: string }>;
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

export function DeclarationCoursierSection({
  collecteId,
}: {
  collecteId: string;
}) {
  const [courses, setCourses] = useState<Declaration[] | null>(null);
  const [sansDeclaration, setSansDeclaration] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  const url = `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/declaration-coursier`;

  useEffect(() => {
    let annule = false;
    setCourses(null);
    setErreur(null);
    void (async () => {
      const res = await fetch(url).catch(() => null);
      const body = (await res?.json().catch(() => ({}))) as {
        courses?: Declaration[];
        courses_sans_declaration?: number;
        error?: string;
      };
      if (annule) return;
      if (res?.ok && body.courses) {
        setCourses(body.courses);
        setSansDeclaration(body.courses_sans_declaration ?? 0);
      } else {
        setCourses([]);
        setErreur(body?.error ?? 'Déclaration du coursier indisponible');
      }
    })();
    return () => {
      annule = true;
    };
  }, [url]);

  const plusieurs = (courses?.length ?? 0) + sansDeclaration > 1;

  return (
    <FicheSection
      titre="Déclaration du coursier"
      data-testid="bloc-declaration-coursier"
    >
      <div className="min-w-0 space-y-4">
        {courses === null ? (
          <Skeleton className="h-16 w-full" />
        ) : erreur ? (
          <AlertBar variant="err">{erreur}</AlertBar>
        ) : courses.length === 0 ? (
          <Text>Le coursier n’a pas encore déclaré l’enlèvement.</Text>
        ) : (
          <>
            {courses.map((d) => (
              <div key={d.course} className="space-y-2">
                <Text variant="hint">
                  {plusieurs ? `Vélo ${d.course} · ` : ''}
                  {heure(d.declare_le)
                    ? `Déclaré le ${heure(d.declare_le)}`
                    : 'Déclaré'}
                </Text>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  {d.champs.map((c) => (
                    <InfoItem key={c.nom} label={c.nom}>
                      {c.valeur || '—'}
                    </InfoItem>
                  ))}
                </dl>
              </div>
            ))}
            {sansDeclaration > 0 && (
              <Text variant="hint">
                {sansDeclaration > 1
                  ? `${sansDeclaration} vélos n’ont pas encore déclaré l’enlèvement.`
                  : 'Un vélo n’a pas encore déclaré l’enlèvement.'}
              </Text>
            )}
          </>
        )}
      </div>
    </FicheSection>
  );
}
