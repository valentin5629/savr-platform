'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/ui/loading-state';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { ChoiceCard } from '@/components/ui/choice-card';

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
          <Heading level={1}>Paramètres — Templates emails</Heading>
          <Text className="mt-0.5">
            {templates.length} templates actifs — consultation seule (l'édition
            arrive dans une version ultérieure).
          </Text>
        </div>
      </div>

      {loading ? (
        <LoadingState variant="bloc" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Liste */}
          <Card className="p-2 lg:col-span-1 max-h-[70vh] overflow-y-auto">
            <ul className="divide-y divide-savr-neutral-100">
              {templates.map((t) => (
                <li key={t.id}>
                  <ChoiceCard
                    selected={t.id === selectedId}
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full border-transparent px-3 py-2.5 ${
                      t.id === selectedId
                        ? ''
                        : 'hover:border-transparent hover:bg-savr-neutral-50'
                    }`}
                  >
                    <Text as="div" variant="hint" className="font-mono">
                      {t.code}
                    </Text>
                    <Text as="div" tone="strong" className="truncate">
                      {t.sujet}
                    </Text>
                  </ChoiceCard>
                </li>
              ))}
            </ul>
          </Card>

          {/* Aperçu */}
          <Card padding="md" className="lg:col-span-2 space-y-4">
            {selected ? (
              <>
                <div>
                  <Text as="div" variant="faint" className="font-mono">
                    {selected.code}
                  </Text>
                  <Heading level={2} size="inherit">
                    {selected.sujet}
                  </Heading>
                  {selected.description && (
                    <Text className="mt-1">{selected.description}</Text>
                  )}
                </div>

                {selected.variables && selected.variables.length > 0 && (
                  <div>
                    <Text variant="hint" className="font-medium mb-1.5">
                      Variables
                    </Text>
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
                  <Text variant="hint" className="font-medium mb-1.5">
                    Aperçu du corps
                  </Text>
                  {/* Rendu du corps HTML dans une iframe sandboxée (scripts
                      désactivés) — contenu = seed de confiance, aucune saisie
                      utilisateur en V1 (édition = V1.1). */}
                  <iframe
                    title={`Aperçu ${selected.code}`}
                    sandbox=""
                    srcDoc={selected.corps_html}
                    className="w-full h-96 border border-savr-neutral-200 rounded-savr-md bg-savr-white"
                  />
                </div>
              </>
            ) : (
              <Text>Sélectionnez un template.</Text>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
