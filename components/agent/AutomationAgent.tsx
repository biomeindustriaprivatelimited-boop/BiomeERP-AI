"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Send, X, WifiOff, ArrowRight, Sparkles, Download, RotateCcw } from "lucide-react";
import { tryMatchIntent, matchIntent, type AgentReply, type AgentRoute } from "@/lib/agent";
import { useNotifications } from "@/lib/notifications";
import {
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL,
  isWebGpuSupported,
  loadAssistantEngine,
  streamAssistantReply,
  type EngineProgress,
  type AssistantChatMessage,
} from "@/lib/aiAssistant";

interface Msg {
  role: "agent" | "user";
  text: string;
  route?: AgentRoute;
  streaming?: boolean;
}

type AiState = "idle" | "loading" | "ready" | "unsupported" | "error";

const WELCOME: Msg = {
  role: "agent",
  text:
    "Hi! I'm the Biome assistant. Instant app commands (\"reconcile ledger\", \"gst due dates\"…) work offline right away, no setup. For open-ended questions about the business or the app, turn on the local AI below — it downloads once, then keeps working fully offline, no API key, no cost.",
};

export default function AutomationAgent() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [aiState, setAiState] = useState<AiState>("idle");
  const [aiProgress, setAiProgress] = useState<EngineProgress | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_ASSISTANT_MODEL);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { notify } = useNotifications();

  useEffect(() => {
    setAiState(isWebGpuSupported() ? "idle" : "unsupported");
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, aiProgress]);

  async function enableLocalAi() {
    setAiState("loading");
    setAiError(null);
    setAiProgress({ text: "Starting…", progress: 0 });
    try {
      await loadAssistantEngine(selectedModel, (p) => setAiProgress(p));
      setAiState("ready");
      notify({
        kind: "success",
        title: "Local AI Assistant ready",
        detail: "Running fully offline in your browser — no internet needed from here on.",
      });
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: "Local AI is ready — running fully in your browser, no internet needed from here on. Ask me anything about Biome Industria or this app.",
        },
      ]);
    } catch (err: any) {
      setAiState("error");
      setAiError(err?.message || "Couldn't load the local model.");
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    // Instant, zero-cost rule-based nav commands take priority.
    const ruleReply: AgentReply | null = tryMatchIntent(text);
    if (ruleReply) {
      setMessages((m) => [...m, { role: "agent", text: ruleReply.text, route: ruleReply.route }]);
      return;
    }

    if (aiState !== "ready") {
      const fallback = matchIntent(text);
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text:
            fallback.text +
            (aiState === "unsupported"
              ? ""
              : "\n\nFor open-ended questions like this, turn on the local AI below."),
          route: fallback.route,
        },
      ]);
      return;
    }

    // Local AI path — stream the reply token by token.
    setBusy(true);
    const history: AssistantChatMessage[] = messages
      .filter((m) => !m.streaming)
      .slice(-8)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text } as AssistantChatMessage))
      .concat([{ role: "user", content: text }]);

    setMessages((m) => [...m, { role: "agent", text: "", streaming: true }]);
    try {
      let acc = "";
      for await (const delta of streamAssistantReply(history)) {
        acc += delta;
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "agent", text: acc, streaming: true };
          return next;
        });
      }
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "agent", text: acc || "…", streaming: false };
        return next;
      });
    } catch (err: any) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "agent",
          text: `Local AI hit an error: ${err?.message || "unknown error"}. You can try again, or stick to app commands.`,
          streaming: false,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-biome-leaf text-biome-bg shadow-[0_0_24px_rgba(62,213,152,0.45)]"
        aria-label="Open assistant"
      >
        <motion.span
          animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-full bg-biome-leaf"
        />
        <Bot size={24} className="relative" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ duration: 0.22 }}
            className="glass fixed bottom-24 right-6 z-40 flex h-[480px] w-[340px] flex-col overflow-hidden rounded-2xl border border-biome-line shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-biome-line px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-biome-leafBright" />
                <div>
                  <p className="font-display text-xs font-semibold text-biome-text">Biome Assistant</p>
                  <p className="flex items-center gap-1 text-[10px] text-biome-muted">
                    {aiState === "ready" ? (
                      <>
                        <Sparkles size={9} /> Local AI ready · offline · no API
                      </>
                    ) : (
                      <>
                        <WifiOff size={9} /> Offline commands · no API
                      </>
                    )}
                  </p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-biome-muted hover:text-biome-text">
                <X size={16} />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-[11.5px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-biome-leaf/20 text-biome-text"
                        : "border border-biome-line bg-white/[0.03] text-biome-muted"
                    }`}
                  >
                    {m.text || (m.streaming ? "…" : "")}
                    {m.route && (
                      <Link
                        href={m.route.href}
                        onClick={() => setOpen(false)}
                        className="mt-2 flex items-center gap-1 text-biome-leafBright hover:underline"
                      >
                        {m.route.label} <ArrowRight size={11} />
                      </Link>
                    )}
                  </div>
                </div>
              ))}

              {(aiState === "idle" || aiState === "loading" || aiState === "error") && (
                <div className="rounded-xl border border-biome-leaf/20 bg-biome-leaf/5 p-3">
                  {aiState === "idle" && (
                    <>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-biome-text">
                        <Sparkles size={12} className="text-biome-leafBright" /> Enable local AI chat
                      </p>
                      <div className="mb-2 space-y-1.5">
                        {ASSISTANT_MODELS.map((model) => (
                          <label
                            key={model.id}
                            className="flex cursor-pointer items-start gap-2 rounded-lg border border-biome-line/60 px-2 py-1.5 text-[10.5px] text-biome-muted has-[:checked]:border-biome-leaf/50 has-[:checked]:bg-biome-leaf/10"
                          >
                            <input
                              type="radio"
                              name="assistant-model"
                              className="mt-0.5"
                              checked={selectedModel === model.id}
                              onChange={() => setSelectedModel(model.id)}
                            />
                            <span>
                              <span className="font-medium text-biome-text">{model.label}</span>{" "}
                              <span className="text-biome-muted">· {model.sizeLabel}</span>
                              <br />
                              {model.note}
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={enableLocalAi}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-biome-leaf px-3 py-1.5 text-[11px] font-medium text-biome-bg"
                      >
                        <Download size={12} /> Download &amp; enable
                      </button>
                    </>
                  )}
                  {aiState === "loading" && aiProgress && (
                    <>
                      <p className="mb-1.5 text-[10.5px] text-biome-muted">{aiProgress.text}</p>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-biome-leaf transition-all"
                          style={{ width: `${Math.round((aiProgress.progress || 0) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-biome-muted">
                        One-time download — stays cached for offline use after this.
                      </p>
                    </>
                  )}
                  {aiState === "error" && (
                    <>
                      <p className="mb-2 text-[10.5px] text-red-300">{aiError}</p>
                      <button
                        onClick={enableLocalAi}
                        className="flex items-center gap-1.5 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] text-biome-text"
                      >
                        <RotateCcw size={11} /> Retry
                      </button>
                    </>
                  )}
                </div>
              )}
              {aiState === "unsupported" && (
                <div className="rounded-xl border border-biome-line/60 bg-white/[0.02] p-3 text-[10.5px] text-biome-muted">
                  Your browser doesn&apos;t support WebGPU, so local AI chat isn&apos;t available here — app
                  commands below still work fully offline. Try Chrome or Edge on a desktop for local AI.
                </div>
              )}
            </div>

            <div className="border-t border-biome-line p-2">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {["GST due dates", "Reconcile ledger", "Scan invoice", "What does Biome make?"].map((s) => (
                  <button
                    key={s}
                    disabled={busy}
                    onClick={() => {
                      setInput(s);
                    }}
                    className="rounded-full border border-biome-line px-2 py-1 text-[10px] text-biome-muted transition-colors hover:text-biome-text disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder={busy ? "Thinking…" : "Ask me something…"}
                  disabled={busy}
                  className="w-full flex-1 rounded-lg border border-biome-line bg-white/5 px-3 py-2 text-xs text-biome-text outline-none focus:border-biome-leaf disabled:opacity-60"
                />
                <button
                  onClick={send}
                  disabled={busy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-biome-leaf text-biome-bg disabled:opacity-50"
                  aria-label="Send"
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
