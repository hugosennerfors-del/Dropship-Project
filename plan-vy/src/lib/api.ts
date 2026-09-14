import type { ApiResponse } from "./types";

/**
 * n8n-backenden. Kan pekas om med NEXT_PUBLIC_PLAN_VY_API — användbart för att
 * köra mot en lokal kopia av svaret utan nät. Utan variabeln går allt mot skarp
 * backend.
 */
const BASE = process.env.NEXT_PUBLIC_PLAN_VY_API?.replace(/\/$/, "") ||
  "https://tikitiki1.app.n8n.cloud/webhook";

export const API_URL = `${BASE}/plan-vy-api`;
export const RESEARCH_URL = `${BASE}/plan-vy-research-generate`;

/** Månaden där den riktiga datan finns. */
export const DEFAULT_MONTH = "2026-09";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isValidMonth = (m: string | null | undefined): m is string =>
  typeof m === "string" && MONTH_RE.test(m);

export const normalizeMonth = (m: string | null | undefined): string =>
  isValidMonth(m) ? m : DEFAULT_MONTH;

export class ApiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(`Tidsgränsen gick ut efter ${Math.round(timeoutMs / 1000)} s.`, e);
    }
    throw new ApiError("Kunde inte nå API:t. Kontrollera nätverket.", e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ApiError(`API svarade ${res.status} ${res.statusText}.`);
  }

  const text = await res.text();
  if (!text.trim()) throw new ApiError("API:t svarade med ett tomt svar.");
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new ApiError("API:t svarade med något som inte är giltig JSON.", e);
  }
}

/**
 * Hämtar hela datalagret för en månad.
 *
 * Skickar MEDVETET inga egna request-headers. Webhook-noden för /plan-vy-api
 * har ingen allowedOrigins satt — den sätter bara Access-Control-Allow-Origin
 * på svaret. Ett anrop utan egna headers är en "simple request" och slipper
 * preflight. Lägger man till en icke-safelistad header börjar webbläsaren
 * skicka OPTIONS först, och då faller anropet.
 */
export async function fetchPlanVy(month: string, timeoutMs = 60_000): Promise<ApiResponse> {
  const url = `${API_URL}?month=${encodeURIComponent(normalizeMonth(month))}`;
  const data = await getJson<ApiResponse>(url, { method: "GET", cache: "no-store" }, timeoutMs);
  if (!data || typeof data !== "object") throw new ApiError("Oväntat svarsformat från API:t.");
  return data;
}

/** Ber backenden generera nya kandidater för en nisch. Returnerar antalet sparade. */
export async function generateResearch(niche: string, timeoutMs = 120_000): Promise<number> {
  const payload = await getJson<unknown>(
    RESEARCH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche }),
      cache: "no-store",
    },
    timeoutMs,
  );
  if (Array.isArray(payload)) return payload.length;
  if (payload && typeof payload === "object" && Array.isArray((payload as { candidates?: unknown[] }).candidates)) {
    return (payload as { candidates: unknown[] }).candidates.length;
  }
  return 0;
}
