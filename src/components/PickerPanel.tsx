// Drop-down panel of the "Columns" pickers (the shared ColumnPicker and the
// payroll sheet's own list). It is drawn in document.body (a portal) at a fixed
// spot under its button: inside the page header it was trapped in the header's
// layer and the filter boxes below showed through it. Every tick is saved at
// once, so Done / X / Escape / clicking outside just close it.

import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';

export function PickerPanel({ anchor, align = 'right', width, title, onClose, footer, children }: {
  anchor: RefObject<HTMLElement | null>;
  /** Which edge of the button the panel lines up with. */
  align?: 'left' | 'right';
  width: number;
  title: string;
  onClose: () => void;
  /** Extra footer buttons, shown left of "Saved automatically · Done". */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; w: number; maxH: number } | null>(null);

  // Under the button, kept on screen; follows it on scroll / resize.
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 8));
      const top = r.bottom + 4;
      setPos({ top, left, w, maxH: Math.max(200, window.innerHeight - top - 12) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div role="dialog" aria-label={title}
        className="fixed z-[61] flex flex-col rounded-xl border border-slate-200 bg-white text-left shadow-2xl"
        style={{ top: pos.top, left: pos.left, width: pos.w, maxHeight: pos.maxH }}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <p className="text-sm font-bold text-slate-700">{title}</p>
          <button type="button" onClick={onClose} title="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-3 py-2">{children}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-3 py-2">
          {footer}
          <p className="ml-auto text-[11px] text-slate-400">Saved automatically</p>
          <button type="button" onClick={onClose}
            className="btn-grad flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold">
            <Check className="size-3.5" /> Done
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
