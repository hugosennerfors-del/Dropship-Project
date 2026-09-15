"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, DEFAULT_MONTH, fetchPlanVy, normalizeMonth } from "@/lib/api";
import type { ApiResponse } from "@/lib/types";

interface DataState {
  data: ApiResponse | null;
  loading: boolean;
  /** Sant medan AI-texten fortfarande hämtas i bakgrunden. */
  aiLoading: boolean;
  error: string | null;
  month: string;
  setMonth: (m: string) => void;
  refetch: () => void;
}

const Ctx = createContext<DataState | null>(null);

/**
 * Två hämtningar per månad, delade av alla sidor.
 *
 * Steg 1 går mot snabbvägen (&ai=0) och svarar på ett par sekunder. Vyn renderas
 * då direkt med alla siffror. Steg 2 hämtar samma data igen, men med AI-texten,
 * och kan ta över en minut — backenden kör språkmodellen synkront och prompten
 * växer med antalet sparade kandidater. Tidigare väntade hela sidan på det och
 * slog i timeout-gränsen vid 30 kandidater.
 *
 * Misslyckas steg 2 behålls siffrorna från steg 1. Att tappa AI-texten är en
 * mycket mindre förlust än en tom sida.
 *
 * Datan hämtas i webbläsaren och inte på servern: månadsbytet ska inte kosta
 * en navigering, skelettlägena i UI:t förutsätter ett laddningstillstånd, och
 * API:t sätter Access-Control-Allow-Origin: * just för det här.
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const month = normalizeMonth(searchParams.get("month"));

  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /** Hindrar ett långsamt svar för en gammal månad från att skriva över ett nytt. */
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    let cancelled = false;
    const current = () => !cancelled && ticket === latest.current;

    setLoading(true);
    setAiLoading(true);
    setError(null);

    // Steg 1 — siffrorna, utan att vänta på språkmodellen.
    fetchPlanVy(month, { fast: true })
      .then((res) => {
        if (!current()) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!current()) return;
        setData(null);
        setLoading(false);
        setError(e instanceof ApiError ? e.message : "Ett oväntat fel inträffade.");
      });

    // Steg 2 — samma data igen, nu med AI-texten. Startar parallellt: om
    // snabbvägen mot förmodan skulle falla har den här ändå hunnit en bit.
    fetchPlanVy(month)
      .then((res) => {
        if (!current()) return;
        setData(res);
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        // Tyst med flit. Siffrorna från steg 1 står kvar och är det viktiga;
        // AI-sektionerna visar sitt tomma läge i stället för ett felmeddelande
        // tvärs över en sida som i övrigt fungerar.
      })
      .finally(() => {
        if (!current()) return;
        setAiLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, nonce]);

  const setMonth = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("month", normalizeMonth(next));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({ data, loading, aiLoading, error, month, setMonth, refetch }),
    [data, loading, aiLoading, error, month, setMonth, refetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData måste användas inuti <DataProvider>.");
  return ctx;
}

export { DEFAULT_MONTH };
