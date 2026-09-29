/**
 * Biome Platform — WhatsApp agent client (server only)
 * -------------------------------------------------------------------
 * Talks to the background agent over localhost.
 *
 * This lives apart from lib/whatsapp.ts on purpose: that file holds the
 * types and label maps that client components need, and it must stay
 * free of `fs` or any other Node built-in. Anything that touches the
 * filesystem belongs here, and here is only ever imported from route
 * handlers.
 */

import fs from "fs";
import path from "path";
import { paths } from "./dataRoot";

interface Handshake {
  host: string;
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

/** Reads the handshake file the agent writes when it starts up. */
export function readHandshake(): Handshake | null {
  try {
    if (!fs.existsSync(paths.runtimeFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(paths.runtimeFile, "utf8")) as Handshake;
    if (!parsed?.port || !parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A crash note the agent leaves when it can't even start. */
export function readAgentCrash(): { reason: string; message: string; detail?: string; at: string } | null {
  try {
    const file = path.join(path.dirname(paths.runtimeFile), "whatsapp-agent-error.json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentUnavailableError";
  }
}

const AGENT_DOWN_MESSAGE =
  "The WhatsApp background agent isn't running yet. It starts with the desktop app on the server PC and " +
  "restarts itself within a minute if it stops. If this stays, close Biome completely and open it again; " +
  "the reason is written in %APPDATA%\\Biome\\logs\\whatsapp-agent.log.";

/**
 * Call the background agent. Throws AgentUnavailableError when the agent
 * isn't up, so callers can return a clear 503 instead of a bare 500.
 */
export async function agentFetch(
  route: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const handshake = readHandshake();
  if (!handshake) {
    // Prefer the agent's own account of why it died over a generic message.
    const crash = readAgentCrash();
    throw new AgentUnavailableError(crash ? `${crash.message}${crash.detail ? ` (${crash.detail.slice(0, 240)})` : ""}` : AGENT_DOWN_MESSAGE);
  }

  const { timeoutMs = 30000, headers, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`http://${handshake.host}:${handshake.port}${route}`, {
      ...rest,
      headers: { ...(headers || {}), "x-agent-token": handshake.token },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new AgentUnavailableError("The WhatsApp agent did not respond in time.");
    }
    throw new AgentUnavailableError(AGENT_DOWN_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

/** agentFetch plus a JSON parse, for the common case. */
export async function agentJson<T>(
  route: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const res = await agentFetch(route, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any)?.error || `Agent returned ${res.status}.`);
  return body as T;
}
