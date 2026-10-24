import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, RefreshCw, Bot, User as UserIcon } from 'lucide-react';
import { getAiOverview, askAi } from '../api/portalApi';

interface ChatMsg { role: 'user' | 'ai'; text: string; }

/**
 * Right-edge AI assistant for super users: an AI "insights" feed generated from
 * today's live dashboard stats, plus a chat box to ask questions about the data.
 * Rendered as a fixed slide-over so it overlays without disturbing the layout.
 * Opened from the "ProSwim AI" button in the sidebar (no floating tab: it sat
 * on top of grids and buttons). Gate rendering with isSuperUser() at the call site.
 */
export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setOpen = (v: boolean) => { if (!v) onClose(); };

  // Insights (AI overview of today's stats).
  const [overview, setOverview] = useState<string | null>(null);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovError, setOvError] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  // Chat.
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadOverview = () => {
    setOvLoading(true);
    setOvError(null);
    getAiOverview()
      .then((r) => { setOverview(r.overview); setOvError(r.error); })
      .catch((e) => setOvError(e instanceof Error ? e.message : 'Failed to load insights.'))
      .finally(() => setOvLoading(false));
  };

  // Load insights the first time the panel is opened.
  useEffect(() => {
    if (open && !loadedOnce.current) {
      loadedOnce.current = true;
      loadOverview();
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep the chat scrolled to the latest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, asking]);

  const send = () => {
    const q = question.trim();
    if (!q || asking) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setQuestion('');
    setAsking(true);
    askAi(q)
      .then((r) => setMessages((m) => [...m, { role: 'ai', text: r.answer || r.error || 'No answer.' }]))
      .catch((e) => setMessages((m) => [...m, { role: 'ai', text: e instanceof Error ? e.message : 'Request failed.' }]))
      .finally(() => setAsking(false));
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-slate-900/40" aria-hidden />
      )}

      {/* Slide-over panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="ProSwim AI assistant"
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md bg-slate-50 shadow-2xl flex flex-col transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 text-white shrink-0"
             style={{ background: 'linear-gradient(90deg, #202f4d 0%, #1e5c97 100%)' }}>
          <Sparkles className="size-5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">ProSwim AI</p>
            <p className="text-[10px] text-white/60 leading-tight">Insights & questions on your live data</p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close AI assistant" className="ml-auto p-1 text-white/70 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        {/* Insights feed */}
        <div className="px-4 pt-4 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Today's insights</p>
            <button onClick={loadOverview} disabled={ovLoading} aria-label="Refresh insights"
                    className="text-slate-400 hover:text-[#1e5c97] disabled:opacity-40">
              <RefreshCw className={`size-4 ${ovLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-sm">
            {ovLoading ? (
              <p className="text-slate-400">Analyzing today's numbers…</p>
            ) : ovError ? (
              <p className="text-red-600">{ovError}</p>
            ) : overview ? (
              <p className="whitespace-pre-wrap leading-relaxed">{overview}</p>
            ) : (
              <p className="text-slate-400">No insights yet.</p>
            )}
          </div>
        </div>

        {/* Chat */}
        <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 shrink-0">Ask about your data</p>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-2 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400 mt-2">
              Ask things like “How much is still due this semester?”, “How did attendance look today?”, or “Which packages need follow-up?”
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`size-7 shrink-0 rounded-full flex items-center justify-center ${m.role === 'user' ? 'bg-[#1e5c97] text-white' : 'bg-white border border-slate-200 text-[#1e5c97]'}`}>
                {m.role === 'user' ? <UserIcon className="size-4" /> : <Bot className="size-4" />}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${m.role === 'user' ? 'bg-[#1e5c97] text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                {m.text}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex gap-2">
              <div className="size-7 shrink-0 rounded-full bg-white border border-slate-200 text-[#1e5c97] flex items-center justify-center">
                <Bot className="size-4" />
              </div>
              <div className="rounded-2xl px-3 py-2 text-sm bg-white border border-slate-200 text-slate-400">Thinking…</div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 bg-white p-3 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask a question…"
              rows={1}
              aria-label="Ask the AI a question"
              className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e5c97]/40 max-h-32"
            />
            <button onClick={send} disabled={asking || !question.trim()} aria-label="Send question"
                    className="rounded-lg bg-[#1e5c97] p-2 text-white disabled:opacity-40 hover:bg-[#184e80]">
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
