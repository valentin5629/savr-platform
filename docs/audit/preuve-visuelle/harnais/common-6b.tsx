import * as React from 'react';
export const zd = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
].map((periode, i) => ({
  periode,
  biodechet: 4700 + i * 300,
  emballage: 1680 - i * 90,
  carton: 1300 + i * 40,
  verre: 850 + (i % 2) * 200,
  dechet_residuel: 640 - i * 30,
  tonnage_total: 9170 + i * 400,
  taux_recyclage: 78 + i,
  nb_collectes: 10 + i,
  pax: 4000 + i * 100,
}));
export const ag = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
].map((periode, i) => ({
  periode,
  repas_donnes: 3720 + i * 120,
  pax: 4300 - i * 50,
  ratio: 0.86 + i * 0.01,
}));
export const DOT = {
  navy: 'var(--color-savr-dataviz-1)',
  navy2: 'var(--color-savr-dataviz-3)',
  green: 'var(--color-savr-dataviz-4)',
  navy3: 'var(--color-savr-dataviz-5)',
  accent: 'var(--color-savr-dataviz-2)',
};
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-savr-neutral-50 p-6" style={{ width: 1180 }}>
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-savr-neutral-500">
        {title}
      </div>
      {children}
    </section>
  );
}
