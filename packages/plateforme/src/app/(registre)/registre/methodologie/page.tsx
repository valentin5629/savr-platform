import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import { ROUTES } from '@/lib/routes';
import { PageHero } from '@/components/ui/page-hero';
import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/ui/icones';

// Notice méthodologique unique (§06.03 + §12) — même source que le rapport de
// recyclage (sobriété C2 : pas de PDF méthodo séparé). Contenu canonique in-app.

export default function MethodologiePage() {
  return (
    <div className="space-y-4">
      <PageHero
        icon={
          <Link
            href={ROUTES.registre}
            aria-label="Retour au registre"
            className="rounded-savr-md p-1 text-savr-primary-700 hover:bg-savr-primary-200/60 hover:text-savr-primary-800"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </Link>
        }
        title="Méthodologie de calcul"
      />

      <Card
        padding="lg"
        className="space-y-4 text-sm leading-relaxed text-savr-neutral-700"
      >
        <section>
          <Heading level={2} size="inherit" className="mb-1">
            Taux de recyclage par captation
          </Heading>
          <p>
            Le taux de recyclage d&apos;une collecte est calculé par filière de
            valorisation : pour chaque flux pesé (biodéchets, emballages,
            cartons, verre, déchet résiduel), le poids réel est multiplié par le
            taux de captation de sa filière (source ADEME / Citeo), puis
            rapporté au poids total collecté. Le taux affiché au registre est
            figé au moment de la clôture de la collecte (snapshot non
            rétroactif).
          </p>
        </section>

        <section>
          <Heading level={2} size="inherit" className="mb-1">
            Cadre réglementaire
          </Heading>
          <p>
            La méthode suit les principes de la directive-cadre déchets et du
            règlement d&apos;exécution UE 2019/1004 (mesure et déclaration des
            quantités de déchets et de leur valorisation). Le registre tient
            lieu de registre chronologique des déchets sortants au sens de
            l&apos;article R541-43 du Code de l&apos;environnement.
          </p>
        </section>

        <section>
          <Heading level={2} size="inherit" className="mb-1">
            Périmètre du registre
          </Heading>
          <p>
            Seules les collectes Zéro Déchet clôturées figurent au registre
            (état définitif). Les bordereaux de pesée Savr constituent les
            pièces justificatives ; ils sont téléchargeables individuellement ou
            groupés (ZIP) sur la période filtrée.
          </p>
        </section>
      </Card>
    </div>
  );
}
