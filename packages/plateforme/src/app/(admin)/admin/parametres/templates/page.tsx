'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface EmailTemplate {
  id: string;
  code: string;
  sujet: string;
  description: string | null;
  variables: string[] | null;
  corps_html: string;
  actif: boolean;
}

export default function TemplatesEmailPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/admin/templates-email')
      .then((r) => r.json())
      .then((d: { data: EmailTemplate[] }) => {
        setTemplates(d.data ?? []);
        setSelectedId(d.data?.[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, []);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Mail className="h-6 w-6 text-savr-neutral-600" />
        <div>
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Paramètres — Templates emails
          </h1>
          <p className="text-sm text-savr-neutral-500 mt-0.5">
            {templates.length} templates actifs — consultation seule (l'édition
            arrive dans une version ultérieure).
          </p>
        </div>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Liste */}
          <Card className="p-2 lg:col-span-1 max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-savr-neutral-100">
              {templates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${
                      t.id === selectedId
                        ? 'bg-savr-primary-50'
                        : 'hover:bg-savr-neutral-50'
                    }`}
                  >
                    <div className="font-mono text-xs text-savr-neutral-500">
                      {t.code}
                    </div>
                    <div className="text-sm text-savr-neutral-800 truncate">
                      {t.sujet}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {/* Aperçu */}
          <Card className="p-5 lg:col-span-2 space-y-4">
            {selected ? (
              <>
                <div>
                  <div className="font-mono text-xs text-savr-neutral-400">
                    {selected.code}
                  </div>
                  <h2 className="font-semibold text-savr-neutral-900">
                    {selected.sujet}
                  </h2>
                  {selected.description && (
                    <p className="text-sm text-savr-neutral-500 mt-1">
                      {selected.description}
                    </p>
                  )}
                </div>

                {selected.variables && selected.variables.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-savr-neutral-500 mb-1.5">
                      Variables
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.variables.map((v) => (
                        <Badge key={v} variant="neutral" className="font-mono">
                          {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-savr-neutral-500 mb-1.5">
                    Aperçu du corps
                  </p>
                  {/* Rendu du corps HTML dans une iframe sandboxée (scripts
                      désactivés) — contenu = seed de confiance, aucune saisie
                      utilisateur en V1 (édition = V1.1). */}
                  <iframe
                    title={`Aperçu ${selected.code}`}
                    sandbox=""
                    srcDoc={selected.corps_html}
                    className="w-full h-96 border border-savr-neutral-200 rounded-lg bg-white"
                  />
                </div>
              </>
            ) : (
              <p className="text-sm text-savr-neutral-500">
                Sélectionnez un template.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
