"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Mic,
  X,
  Send,
  Loader2,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { getTallySettings } from "@/lib/preferences";
import {
  ASSISTANT_MODELS, DEFAULT_ASSISTANT_MODEL, isWebGpuSupported, type EngineProgress,
} from "@/lib/aiAssistant";
import { runLocalAssistant } from "@/lib/localAssistant";

/**
 * The assistant panel.
 *
 * It shows its working. Every tool the orchestrator called is listed with
 * whether it succeeded and where the data came from, so a figure in the
 * answer can be traced to the thing that produced it. For a finance tool
 * that matters more than the answer looking clever — an unverifiable
 * number is worthless.
 */

interface TraceStep {
  tool: string;
  args: any;
  ok: boolean;
  summary: string;
  source?: string;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  trace?: TraceStep[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What should I do today?",
  "How is the business doing?",
  "Kaunse vendors risky hain?",
  "How do I register a new vendor?",
  "What's our cash and bank position?",
  "Which supplies are missing documents?",
  "How much do we owe vendors?",
  "Kaunse vendors ka KYC pending hai?",
  "What does Jhajjar Power need for a supply?",
];

const TOOL_LABEL: Record<string, string> = {
  get_financial_summary: "Reading Tally balances",
  find_party_balance: "Looking up a party",
  get_transactions: "Fetching transactions",
  get_supply_sets: "Checking supply sets",
  search_documents: "Searching documents",
  list_vendors: "Reading vendor registry",
  list_clients: "Reading client registry",
  get_agent_status: "Checking system status",
};

export default function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which brain answers: the free on-device model, or the cloud key.
   *  Local is the default whenever the machine can run it — that is the
   *  whole point of a free assistant. */
  const [brain, setBrain] = useState<"local" | "cloud">("local");
  const [modelId, setModelId] = useState(DEFAULT_ASSISTANT_MODEL);
  /** Specialised agent (scope-limited tools) or the general assistant. */
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string; scope: string }[]>([]);
  useEffect(() => { fetch("/api/assistant/tool").then((r) => r.json()).then((j) => setAgents(j.agents || [])).catch(() => {}); }, []);
  const [gpuOk, setGpuOk] = useState(true);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  /** Voice-to-work: the browser's own speech recognition (free, offline
   *  on Chrome/Edge for en-IN/hi-IN) dictates straight into the composer. */
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  function toggleVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setStatus("Voice input isn't available in this browser."); setTimeout(() => setStatus(null), 2500); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const rec = new SR(); rec.lang = "en-IN"; rec.interimResults = true; rec.continuous = false;
    rec.onresult = (e: any) => {
      const text = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
      setInput(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/Cmd + J opens the assistant from anywhere.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    const ok = isWebGpuSupported();
    setGpuOk(ok);
    if (!ok) setBrain("cloud");
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const history = messages
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((m) => [...m, { role: "user", content: question }]);
      setInput("");
      setBusy(true);

      try {
        const t = getTallySettings();

        if (brain === "local") {
          // The free path: the model runs on THIS machine, the tools run
          // on the server behind the same session. First use downloads
          // the weights once; after that it works with no internet.
          let liveText = "";
          let liveTrace: TraceStep[] = [];
          setMessages((m) => [...m, { role: "assistant", content: "", trace: [] }]);
          const patchLast = (content: string, trace: TraceStep[], error = false) =>
            setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? { ...msg, content, trace, error } : msg)));

          try {
            for await (const ev of runLocalAssistant({
              message: question,
              history,
              modelId,
              agentId: agentId || null,
              tally: { host: t.host, port: t.port, company: t.companyName },
              onProgress: (p) => setProgress(p.progress >= 1 ? null : p),
            })) {
              if (ev.type === "status") setStatus(ev.text);
              if (ev.type === "tool") {
                liveTrace = [...liveTrace, ev.step];
                patchLast(liveText, liveTrace);
              }
              if (ev.type === "token") {
                liveText += ev.text;
                patchLast(liveText, liveTrace);
              }
              if (ev.type === "done") patchLast(ev.reply, liveTrace);
              if (ev.type === "error") patchLast(ev.error, liveTrace, true);
            }
          } catch (localErr) {
            patchLast(
              `The local model hit a problem: ${(localErr as Error).message}. ` +
                "If this keeps happening, try the Fast model, or switch the brain to Cloud in the header.",
              liveTrace,
              true
            );
          } finally {
            setStatus(null);
            setProgress(null);
          }
          return;
        }

        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: question,
            history,
            tally: { host: t.host, port: t.port, company: t.companyName },
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: json.error || `Request failed (${res.status}).`, error: true },
          ]);
        } else {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: json.reply, trace: json.trace ?? [] },
          ]);
        }
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: (err as Error).message, error: true },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, brain, modelId, agentId]
  );

  return (
    <>
      {/* Launcher */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
        title="Ask the assistant (Ctrl+J)"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-biome-leaf to-biome-leafBright shadow-lg shadow-biome-leaf/25"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X size={22} className="text-biome-text" />
            </motion.span>
          ) : (
            <motion.span key="bot" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              <Bot size={22} className="text-biome-text" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            className="glass fixed bottom-24 right-6 z-40 flex h-[560px] w-[calc(100vw-3rem)] max-w-[420px] flex-col overflow-hidden rounded-2xl border border-biome-line shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-biome-line px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-biome-leaf to-biome-leafBright">
                <Sparkles size={15} className="text-biome-text" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-semibold text-biome-text">Biome Assistant</p>
                <p className="text-[10px] text-biome-muted">Answers only from your live data</p>
              </div>
              <select
                value={brain}
                onChange={(e) => setBrain(e.target.value as "local" | "cloud")}
                title={gpuOk ? "Which brain answers" : "This browser has no WebGPU — local needs it"}
                className="rounded-lg border border-biome-line bg-biome-bg px-1.5 py-1 text-[10px] text-biome-muted outline-none"
              >
                <option value="local" disabled={!gpuOk}>Local · free</option>
                <option value="cloud">Cloud · API key</option>
              </select>
              {agents.length > 0 && (
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)} title="Specialised agent (limits tools to its scope)"
                  className="max-w-[110px] rounded-lg border border-biome-line bg-biome-bg px-1.5 py-1 text-[10px] text-biome-muted outline-none">
                  <option value="">General</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              {brain === "local" && (
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  title="Local model — bigger is smarter, smaller is faster"
                  className="max-w-[90px] rounded-lg border border-biome-line bg-biome-bg px-1.5 py-1 text-[10px] text-biome-muted outline-none"
                >
                  {ASSISTANT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              )}
              {messages.length > 0 && (
                <button
                  onClick={() => setMessages([])}
                  className="rounded-lg px-2 py-1 text-[10.5px] text-biome-muted transition-colors hover:bg-biome-hover hover:text-biome-text"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Local-model status: download on first use, then lookups */}
            {(progress || status) && (
              <div className="border-b border-biome-line bg-biome-bg/60 px-4 py-2">
                <p className="flex items-center gap-1.5 text-[10px] text-biome-muted">
                  <Loader2 size={11} className="bmx-spin" />
                  {progress
                    ? `Downloading the model once (free, then cached): ${Math.round(progress.progress * 100)}%`
                    : status}
                </p>
                {progress && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-biome-line">
                    <div className="h-full rounded-full bg-biome-leaf transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                  </div>
                )}
              </div>
            )}

            {/* Conversation */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-[11.5px] leading-relaxed text-biome-muted">
                    Ask about your finances, supplies, vendors or documents. I read Tally and the
                    document system live — I don&apos;t answer from memory, and I&apos;ll tell you if
                    something can&apos;t be fetched.
                  </p>
                  <div className="space-y-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="w-full rounded-xl border border-biome-line px-3 py-2 text-left text-[11.5px] text-biome-muted transition-colors hover:border-biome-leaf/40 hover:text-biome-text"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  {m.role === "user" ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-biome-leaf/12 px-3.5 py-2 text-[12px] text-biome-text">
                      {m.content}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {m.trace && m.trace.length > 0 && <TraceList trace={m.trace} />}
                      <div
                        className={`rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-[12px] leading-relaxed ${
                          m.error
                            ? "border border-rose-400/30 bg-rose-400/5 text-rose-500"
                            : "border border-biome-line bg-biome-hover text-biome-text"
                        }`}
                      >
                        {m.content.split("\n").map((line, j) => (
                          <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-[11.5px] text-biome-muted">
                  <Loader2 size={13} className="animate-spin text-biome-leafBright" />
                  Looking it up…
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-biome-line p-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  rows={1}
                  placeholder="Ask anything about your business…"
                  className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border border-biome-line bg-biome-hover px-3 py-2.5 text-[12px] text-biome-text outline-none placeholder:text-biome-muted/60 focus:border-biome-leaf/40"
                />
                <button
                  onClick={toggleVoice}
                  title={listening ? "Stop listening" : "Speak your request (voice-to-work)"}
                  className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    listening ? "border-rose-500/50 bg-rose-500/15 text-rose-500 animate-pulse" : "border-biome-line text-biome-muted hover:text-biome-text"
                  }`}
                >
                  <Mic size={15} />
                </button>
                <button
                  onClick={() => send(input)}
                  disabled={busy || !input.trim()}
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-biome-leaf to-biome-leafBright text-biome-text transition-opacity disabled:opacity-40"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[9.5px] text-biome-muted/70">
                Reads your data. Can&apos;t change anything.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** The working, shown. Collapsed by default so it doesn't crowd the answer. */
function TraceList({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  const failed = trace.filter((t) => !t.ok).length;

  return (
    <div className="rounded-xl border border-biome-line bg-biome-hover">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <Wrench size={11} className="shrink-0 text-biome-muted" />
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-biome-muted">
          {trace.length} lookup{trace.length === 1 ? "" : "s"}
          {failed > 0 && <span className="text-rose-500"> · {failed} failed</span>}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={11} className="text-biome-muted" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 border-t border-biome-line px-3 py-2">
              {trace.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  {t.ok ? (
                    <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertTriangle size={10} className="mt-0.5 shrink-0 text-rose-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[10.5px] text-biome-text">
                      {TOOL_LABEL[t.tool] ?? t.tool}
                    </p>
                    <p className="truncate text-[9.5px] text-biome-muted">
                      {t.summary}
                      {t.source ? ` · ${t.source}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
