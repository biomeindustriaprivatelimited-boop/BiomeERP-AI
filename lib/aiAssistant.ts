/**
 * Local, offline AI Assistant engine — powered by WebLLM
 * (https://github.com/mlc-ai/web-llm), which runs a real language model
 * entirely inside the browser using WebGPU. There is no API key, no
 * server, and no per-message cost: the model weights are downloaded once
 * (that first download needs internet) and then cached by the browser,
 * so every conversation after that works completely offline.
 *
 * Trade-off, and it's an honest one: these are small models (1-3B
 * parameters) compared to large cloud models, so answers are less
 * capable/accurate — but they cost nothing to run and never send any
 * data anywhere.
 */

import { ASSISTANT_SYSTEM_PROMPT } from "@/lib/assistantKnowledge";

export interface AssistantModelOption {
  id: string;
  label: string;
  sizeLabel: string;
  note: string;
}

// A small, curated subset of WebLLM's prebuilt model list — picked for a
// reasonable download-size vs. quality trade-off on a typical laptop GPU.
export const ASSISTANT_MODELS: AssistantModelOption[] = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Fast",
    sizeLabel: "~0.9 GB download",
    note: "Quickest to load, lightest on your device, but the least accurate of the three.",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Balanced (recommended)",
    sizeLabel: "~1.8 GB download",
    note: "Best mix of speed and answer quality for most laptops/desktops.",
  },
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Balanced — Hindi-friendly",
    sizeLabel: "~1.9 GB download",
    note: "Similar size to Balanced, often a bit stronger on Hindi/Hinglish.",
  },
];

export const DEFAULT_ASSISTANT_MODEL = ASSISTANT_MODELS[1].id;

export function isWebGpuSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as any).gpu);
}

export interface EngineProgress {
  text: string;
  progress: number; // 0-1
}

type Engine = import("@mlc-ai/web-llm").MLCEngineInterface;

let enginePromise: Promise<Engine> | null = null;
let loadedModelId: string | null = null;

export function getLoadedAssistantModelId(): string | null {
  return loadedModelId;
}

/** Downloads (first time only — cached by the browser after that) and
 *  initializes the local model. Safe to call again with the same model
 *  id once loaded — it reuses the existing engine instead of reloading. */
export async function loadAssistantEngine(
  modelId: string,
  onProgress?: (p: EngineProgress) => void
): Promise<Engine> {
  if (enginePromise && loadedModelId === modelId) return enginePromise;

  if (enginePromise && loadedModelId !== modelId) {
    // Switching models — release the old one first.
    try {
      const old = await enginePromise;
      await old.unload();
    } catch {
      /* ignore */
    }
    enginePromise = null;
    loadedModelId = null;
  }

  const webllm = await import("@mlc-ai/web-llm");
  loadedModelId = modelId;
  enginePromise = webllm.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => onProgress?.({ text: report.text, progress: report.progress }),
  });
  try {
    return await enginePromise;
  } catch (err) {
    enginePromise = null;
    loadedModelId = null;
    throw err;
  }
}

export async function unloadAssistantEngine() {
  if (enginePromise) {
    try {
      const engine = await enginePromise;
      await engine.unload();
    } catch {
      /* ignore */
    }
  }
  enginePromise = null;
  loadedModelId = null;
}

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Streams a reply token-by-token from the already-loaded local model,
 *  grounded in the Biome Industria business + app knowledge baked into
 *  ASSISTANT_SYSTEM_PROMPT. Throws if no model has been loaded yet. */
export async function* streamAssistantReply(
  history: AssistantChatMessage[]
): AsyncGenerator<string, void, unknown> {
  if (!enginePromise) {
    throw new Error("No local model loaded yet — call loadAssistantEngine() first.");
  }
  const engine = await enginePromise;

  const stream = await engine.chat.completions.create({
    messages: [{ role: "system", content: ASSISTANT_SYSTEM_PROMPT }, ...history],
    stream: true,
    temperature: 0.6,
    max_tokens: 600,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}
