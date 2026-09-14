"use client";

import { useState } from "react";
import { Tooltip } from "./Tooltip";
import { TERMS } from "@/lib/ui";

/**
 * Begrepp med förklaring. Kort mening direkt, formel/detalj bakom "Visa mer".
 */
export function Term({ k, children }: { k: keyof typeof TERMS; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const term = TERMS[k];
  if (!term) return <>{children}</>;

  return (
    <Tooltip
      className="cursor-help underline decoration-dotted decoration-[var(--hairline-strong)] underline-offset-4"
      content={
        <div onMouseDown={(e) => e.preventDefault()}>
          <p className="text-[var(--text-primary)]">{term.short}</p>
          {expanded ? (
            <p className="mt-2 border-t border-[var(--hairline)] pt-2">{term.detail}</p>
          ) : (
            <button
              type="button"
              className="mt-2 text-[12px] font-medium text-[var(--series)] hover:underline"
              onClick={() => setExpanded(true)}
            >
              Visa mer
            </button>
          )}
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}
