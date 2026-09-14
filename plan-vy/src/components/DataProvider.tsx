"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ApiError, DEFAULT_MONTH, fetchPlanVy, normalizeMonth } from "@/lib/api";
import type { ApiResponse } from "@/lib/types";

interface DataState {
  data: ApiResponse | null;
  loading: boolean;
  error: string | null;
  month: string;
  setMonth: (m: string) => void;
  refetch: () => void;
}

const Ctx = createContext<DataState | null>(null);

/**
 * En hämtning per månad, delad av alla sidor.
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
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  /** Hindrar ett långsamt svar för en gammal månad från att skriva över ett nytt. */
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchPlanVy(month)
      .then((res) => {
        if (cancelled || ticket !== latest.current) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled || ticket !== latest.current) return;
        setData(null);
        setError(e instanceof ApiError ? e.message : "Ett oväntat fel inträffade.");
      })
      .finally(() => {
        if (cancelled || ticket !== latest.current) return;
        setLoading(false);
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
    () => ({ data, loading, error, month, setMonth, refetch }),
    [data, loading, error, month, setMonth, refetch],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData måste användas inuti <DataProvider>.");
  return ctx;
}

export { DEFAULT_MONTH };
