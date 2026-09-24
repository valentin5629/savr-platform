// /cgu — publication du texte des Conditions Générales d'Utilisation.
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : il doit être lisible avant
// d'avoir un compte, puisque c'est à l'inscription qu'on demande de l'accepter.
// Le contenu vient de `content/cgu-v1.ts` (dérivé du CDC, cf. l'en-tête de ce
// fichier) et n'est jamais interprété comme du HTML : chaque paragraphe est un
// tableau de segments {texte, gras}, donc aucune injection possible.

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CGU_SECTIONS,
  CGU_TEXTE_VERSION,
  type BlocCgu,
} from '@/content/cgu-v1';

export const metadata: Metadata = {
  title: "Conditions Générales d'Utilisation — Savr",
};

function Segments({ bloc }: { bloc: BlocCgu }) {
  return (
    <>
      {bloc.segments.map((s, i) =>
        s.gras ? (
          <strong key={i} className="font-semibold text-savr-neutral-900">
            {s.texte}
          </strong>
        ) : (
          <span key={i}>{s.texte}</span>
        ),
      )}
    </>
  );
}

// Les items de liste consécutifs sont regroupés dans UN seul <ul> : une suite de
// listes à un élément est lue comme autant de listes séparées par un lecteur
// d'écran, ce qui hache l'énumération (§10 §10 accessibilité).
type Groupe = { type: 'liste' | 'bloc'; blocs: BlocCgu[] };

function grouper(blocs: BlocCgu[]): Groupe[] {
  const groupes: Groupe[] = [];
  for (const bloc of blocs) {
    const dernier = groupes[groupes.length - 1];
    if (bloc.type === 'li' && dernier?.type === 'liste') {
      dernier.blocs.push(bloc);
    } else {
      groupes.push({
        type: bloc.type === 'li' ? 'liste' : 'bloc',
        blocs: [bloc],
      });
    }
  }
  return groupes;
}

export default function CguPage() {
  return (
    <div className="min-h-screen bg-savr-neutral-50 px-4 py-10">
      <main className="mx-auto w-full max-w-3xl rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-sm sm:p-10">
        <h1 className="text-2xl font-semibold text-savr-neutral-900">
          Conditions Générales d&apos;Utilisation
        </h1>
        <p className="mt-2 text-sm text-savr-neutral-500">
          Version {CGU_TEXTE_VERSION} — activités Zéro-Déchet et Anti-Gaspi.
          C&apos;est le texte accepté à la création d&apos;un compte Savr.
        </p>

        <div className="mt-8 space-y-8">
          {CGU_SECTIONS.map((section) => (
            <section key={section.titre}>
              <h2 className="text-lg font-semibold text-savr-neutral-900">
                {section.titre}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-savr-neutral-700">
                {grouper(section.blocs).map((groupe, i) => {
                  if (groupe.type === 'liste') {
                    return (
                      <ul key={i} className="list-disc space-y-1 pl-5">
                        {groupe.blocs.map((bloc, j) => (
                          <li key={j}>
                            <Segments bloc={bloc} />
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  const bloc = groupe.blocs[0]!;
                  if (bloc.type === 'h3') {
                    return (
                      <h3
                        key={i}
                        className="pt-2 text-base font-semibold text-savr-neutral-900"
                      >
                        <Segments bloc={bloc} />
                      </h3>
                    );
                  }
                  return (
                    <p key={i}>
                      <Segments bloc={bloc} />
                    </p>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-savr-neutral-200 pt-6">
          <Link
            href="/signup"
            className="text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
          >
            Retour à la création de compte
          </Link>
        </div>
      </main>
    </div>
  );
}
