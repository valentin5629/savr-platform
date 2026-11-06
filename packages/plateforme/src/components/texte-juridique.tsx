// Mise en page d'un texte juridique public (CGU, politique de confidentialité) :
// pleine page claire, titre, sous-titre, sections, lien de retour en pied.
//
// Le texte n'est jamais interprété comme du HTML : chaque paragraphe est un
// tableau de segments {texte, gras}, donc aucune injection possible.

import type { ReactNode } from 'react';
import type { BlocCgu, SectionCgu } from '@/content/cgu-texte';
import { Heading } from '@/components/ui/heading';
import { PageHero } from '@/components/ui/page-hero';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';

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

export function TexteJuridique({
  titre,
  sousTitre,
  sections,
  retour,
}: {
  titre: string;
  sousTitre: ReactNode;
  sections: SectionCgu[];
  retour: { href: string; libelle: string };
}) {
  return (
    <div className="min-h-screen bg-savr-neutral-50 px-4 py-10">
      <main className="mx-auto w-full max-w-3xl rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm sm:p-10">
        <PageHero title={titre} />
        <Text className="mt-2">{sousTitre}</Text>

        <div className="mt-8 space-y-8">
          {sections.map((section) => (
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
          <TextLink href={retour.href} strong className="text-sm">
            {retour.libelle}
          </TextLink>
        </div>
      </main>
    </div>
  );
}
