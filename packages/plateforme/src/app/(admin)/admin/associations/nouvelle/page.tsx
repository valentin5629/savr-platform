'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AssociationForm } from '@/components/admin/association-form';

export default function NouvelleAssociationPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/associations">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-savr-neutral-900">
          Nouvelle association
        </h1>
      </div>
      <AssociationForm />
    </div>
  );
}
