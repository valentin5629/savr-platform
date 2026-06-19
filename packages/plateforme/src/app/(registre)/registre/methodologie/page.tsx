import { Card } from '@/components/ui/card';

// Notice méthodologique unique (§06.03 + §12) — même source que le rapport de
// recyclage (sobriété C2 : pas de PDF méthodo séparé). Contenu canonique in-app.

export default function MethodologiePage() {
  return (
    <div className="space-y-4">
      <div>
        <a href="/registre" className="text-sm text-savr-primary-700 underline">
          ← Registre
        </a>
        <h1 className="text-2xl font-bold text-savr-primary-800">
          Méthodologie de calcul
        </h1>
      </div>

      <Card className="space-y-4 p-6 text-sm leading-relaxed text-savr-neutral-700">
        <section>
          <h2 className="mb-1 font-semibold text-savr-neutral-900">
            Taux de recyclage par captation
          </h2>
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
          <h2 className="mb-1 font-semibold text-savr-neutral-900">
            Cadre réglementaire
          </h2>
          <p>
            La méthode suit les principes de la directive-cadre déchets et du
            règlement d&apos;exécution UE 2019/1004 (mesure et déclaration des
            quantités de déchets et de leur valorisation). Le registre tient
            lieu de registre chronologique des déchets sortants au sens de
            l&apos;article R541-43 du Code de l&apos;environnement.
          </p>
        </section>

        <section>
          <h2 className="mb-1 font-semibold text-savr-neutral-900">
            Périmètre du registre
          </h2>
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
