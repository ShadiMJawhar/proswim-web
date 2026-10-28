// History-aware back link: returns to wherever the user actually came from
// (dashboard quick action, a list page, a schedule cell…), falling back to the
// page's natural parent when the app was opened directly on this page. When
// the page was opened in its own tab from a schedule, it reads "Close" and
// closes that tab so the schedule underneath is still where the user left it.

import { ArrowLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { canGoBack, closeOrGo, isPopupTab } from '../lib/history';

export function SmartBack({ label = 'Back', fallback = '/' }: { label?: string; fallback?: string }) {
  const navigate = useNavigate();
  const closes = !canGoBack() && isPopupTab();
  return (
    <button
      type="button"
      onClick={() => closeOrGo(navigate, fallback)}
      title={closes ? 'Close this tab and return to the schedule' : undefined}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#1e5c97] mb-2"
    >
      {closes ? <><X className="size-4" /> Close</> : <><ArrowLeft className="size-4" /> {label}</>}
    </button>
  );
}
