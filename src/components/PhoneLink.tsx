// A phone number as shown in grids and schedules (user, 2026-11-02): either a
// WhatsApp link (wa.me) or a click-to-copy button, by the user's saved choice
// (lib/phoneMode). A cell with several numbers gets one link per number; a
// number WhatsApp can't dial (junk, too short) falls back to click-to-copy.

import type { MouseEvent } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import { splitPhones, waDigits } from '../lib/phone';
import { usePhoneMode, setPhoneMode, type PhoneMode } from '../lib/phoneMode';
import { toast } from './Toast';

const WA_GREEN = '#128C7E';

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
}

function PhonePart({ text, mode, code }: { text: string; mode: PhoneMode; code?: string }) {
  // Not a number: "-", a bare country code ("961"), room numbers… → plain text.
  if (text.replace(/\D/g, '').length < 5) return <span>{text}</span>;
  // A separate country code (student record) is dialled but not shown.
  const digits = waDigits(code && /\d/.test(code) && !/^\+|^00/.test(text.trim()) ? `${code} ${text}` : text);
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    copyText(text).then(() => toast.success(`Copied ${text}`)).catch(() => toast.error('Could not copy the number.'));
  };
  if (mode === 'whatsapp' && digits) {
    return (
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={`Open a WhatsApp chat with +${digits}`}
        className="inline-flex items-center gap-1 whitespace-nowrap hover:underline"
        style={{ color: WA_GREEN }}
      >
        <MessageCircle className="size-[1em] shrink-0" />
        {text}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={mode === 'whatsapp' ? 'Not a number WhatsApp can dial — click to copy it' : 'Click to copy the number'}
      className="inline-flex items-center gap-1 whitespace-nowrap hover:underline hover:text-[#1e5c97]"
    >
      <Copy className="size-[0.9em] shrink-0 opacity-50" />
      {text}
    </button>
  );
}

/** Renders a phone cell. Keeps the stored text as the label; `code` is the
 *  country code stored in its own field, used for dialling only. */
export function PhoneText({ value, code, className }: { value: unknown; code?: string; className?: string }) {
  const mode = usePhoneMode();
  const raw = value == null ? '' : String(value);
  const parts = splitPhones(raw);
  if (parts.length === 0) return <>{raw}</>;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 ${className ?? ''}`}>
      {parts.map((p, i) => <PhonePart key={i} text={p} mode={mode} code={code} />)}
    </span>
  );
}

/** The per-user switch: ticked = WhatsApp links, unticked = click to copy. */
export function PhoneModeToggle({ className }: { className?: string }) {
  const mode = usePhoneMode();
  return (
    <label
      title="Ticked: phone numbers open a WhatsApp chat. Unticked: a click copies the number. Saved to your account."
      className={`flex items-center gap-1.5 text-xs text-slate-600 select-none whitespace-nowrap cursor-pointer ${className ?? ''}`}
    >
      <input
        type="checkbox"
        checked={mode === 'whatsapp'}
        onChange={(e) => setPhoneMode(e.target.checked ? 'whatsapp' : 'copy')}
        className="accent-[#1e5c97]"
      />
      <MessageCircle className="size-3.5" style={{ color: WA_GREEN }} />
      WhatsApp
    </label>
  );
}
