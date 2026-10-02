// /cgu — publication du texte des Conditions Générales d'Utilisation.
//
// Écran PUBLIC (déclaré dans `PUBLIC_PREFIXES`) : il doit être lisible avant
// d'avoir un compte, puisque c'est à l'inscription qu'on demande de l'accepter.
// Le contenu vient de `content/cgu-v1.ts` (dérivé du CDC, cf. l'en-tête de ce
// fichier) et n'est jamais interprété comme du HTML : chaque paragraphe est un
// tableau de segments {texte, gras}, donc aucune injection possible.

import type { Metadata } from 'next';
import {
  CGU_SECTIONS,
  CGU_TEXTE_VERSION,
  type BlocCgu,
} from '@/content/cgu-v1';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';

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
      <main className="mx-auto w-full max-w-3xl rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm sm:p-10">
        <Heading level={1} weight="semibold">
          Conditions Générales d&apos;Utilisation
        </Heading>
        <Text className="mt-2">
          Version {CGU_TEXTE_VERSION} — activités Zéro-Déchet et Anti-Gaspi.
          C&apos;est le texte accepté à la création d&apos;un compte Savr.
        </Text>

        <div className="mt-8 space-y-8">
          {CGU_SECTIONS.map((section) => (
            <section key={section.titre}>
              <Heading level={2}>{section.titre}</Heading>
              <Text
                as="div"
                variant="body"
                className="mt-3 space-y-3 leading-relaxed"
              >
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
                      <Heading level={3} className="pt-2" key={i}>
                        <Segments bloc={bloc} />
                      </Heading>
                    );
                  }
                  return (
                    <p key={i}>
                      <Segments bloc={bloc} />
                    </p>
                  );
                })}
              </Text>
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-savr-neutral-200 pt-6">
          <TextLink href="/signup" strong className="text-sm">
            Retour à la création de compte
          </TextLink>
        </div>
      </main>
    </div>
  );
}
