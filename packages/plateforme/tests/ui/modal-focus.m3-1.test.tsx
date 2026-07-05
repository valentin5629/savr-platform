/**
 * M3.1 — Régression : le champ d'une Modal garde le focus à la frappe.
 * Bug (2026-07-05) : l'effet de focus du composant Modal dépendait de `onClose`.
 * Les appelants passent un `onClose` INLINE (nouvelle identité à chaque render) →
 * l'effet se relançait à chaque frappe et volait le focus (panelRef.focus()),
 * ne laissant saisir qu'une lettre à la fois. Fix : effet dépendant de `open`
 * seul, `onClose` lu via ref. Ce test vérifie qu'un re-render (nouvel onClose
 * inline) NE vole PAS le focus du champ.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '@/components/ui/modal';

function Harness(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const [v, setV] = useState('');
  return (
    // onClose INLINE → nouvelle identité à chaque render (reproduit l'usage réel).
    <Modal open={open} title="Test" onClose={() => setOpen(false)}>
      <textarea
        aria-label="motif"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
    </Modal>
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => cleanup());

describe('M3.1 / Modal — focus retenu à la frappe', () => {
  it('M3.1/modal_saisie_multi_caracteres — re-render ne vole pas le focus du champ', async () => {
    render(<Harness />);
    const ta = screen.getByLabelText('motif') as HTMLTextAreaElement;
    // Laisse passer le focus initial (setTimeout 0 → panneau), puis l'utilisateur
    // clique dans le champ.
    await wait(5);
    ta.focus();
    expect(document.activeElement).toBe(ta);

    // Frappe → chaque onChange re-render le parent (nouvel onClose inline).
    fireEvent.change(ta, { target: { value: 'a' } });
    fireEvent.change(ta, { target: { value: 'an' } });
    fireEvent.change(ta, { target: { value: 'ann' } });
    fireEvent.change(ta, { target: { value: 'annulée' } });

    // Si l'effet s'était relancé (bug), un setTimeout(focus panneau) aurait été
    // programmé : on lui laisse le temps de tirer.
    await wait(10);

    expect(ta.value).toBe('annulée');
    // Le champ garde le focus (fix) — avant le fix, le focus était sur le panneau.
    expect(document.activeElement).toBe(ta);
  });
});
