// "Columns" dropdown for grids: tick the columns to show, grouped in sections
// (main / more / named groups). Saved per user by useColumnPrefs; the panel
// itself (on top of the page, Done / X / Escape) is PickerPanel.

import { useRef, useState } from 'react';
import { Columns3, RotateCcw } from 'lucide-react';
import { PickerPanel } from './PickerPanel';

export type PickerColumn = { key: string; label: string; shown: boolean };
export type PickerSection = { title: string; columns: PickerColumn[] };

export function ColumnPicker({ sections, onToggle, onSetMany, onReset }: {
  sections: PickerSection[];
  onToggle: (key: string, shown: boolean) => void;
  onSetMany: (keys: string[], shown: boolean) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const visible = sections.filter((s) => s.columns.length > 0);
  if (visible.length === 0) return null;
  const all = visible.flatMap((s) => s.columns);
  const shownCount = all.filter((c) => c.shown).length;

  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)}
        title="Choose the columns to show (saved to your account)"
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          open ? 'border-[#1e5c97] bg-[#e8f0f8] text-[#1e5c97]' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
        <Columns3 className="size-3.5" /> Columns <span className="text-slate-400 font-normal">{shownCount}/{all.length}</span>
      </button>
      {open && (
        <PickerPanel anchor={btn} width={560} title="Columns to show" onClose={() => setOpen(false)}
          footer={<>
            <button type="button" onClick={() => onSetMany(all.map((c) => c.key), true)}
              className="text-[11px] font-semibold text-[#1e5c97] hover:underline">Show all columns</button>
            <button type="button" onClick={onReset}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-[#1e5c97]">
              <RotateCcw className="size-3" /> Reset to default
            </button>
          </>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visible.map((s) => (
              <div key={s.title}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{s.title}</p>
                  <span className="text-[11px] text-slate-400">
                    <button type="button" className="hover:text-[#1e5c97]" onClick={() => onSetMany(s.columns.map((c) => c.key), true)}>all</button>
                    {' · '}
                    <button type="button" className="hover:text-[#1e5c97]" onClick={() => onSetMany(s.columns.map((c) => c.key), false)}>none</button>
                  </span>
                </div>
                {s.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50 select-none cursor-pointer">
                    <input type="checkbox" checked={c.shown} onChange={(e) => onToggle(c.key, e.target.checked)} className="accent-[#1e5c97]" />
                    {c.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </PickerPanel>
      )}
    </>
  );
}
