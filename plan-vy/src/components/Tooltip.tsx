"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Tooltip via portal till <body>.
 *
 * Renderas utanför sidans DOM-träd och positioneras fixed med z-index 9999,
 * så att den aldrig klipps av overflow eller stacking-kontexter i korten.
 */
export function Tooltip({ content, children, className }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const anchor = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 300;
    const left = Math.min(
      Math.max(12, r.left + r.width / 2 - width / 2),
      Math.max(12, window.innerWidth - width - 12),
    );
    // Under ankaret om det inte får plats ovanför.
    const top = r.top > 190 ? r.top - 12 : r.bottom + 12;
    setPos({ top, left });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);

  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const above = typeof window !== "undefined" && anchor.current
    ? anchor.current.getBoundingClientRect().top > 190
    : false;

  return (
    <>
      <span
        ref={anchor}
        className={className}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {mounted && open
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                width: 300,
                zIndex: 9999,
                transform: above ? "translateY(-100%)" : undefined,
              }}
              className="glass p-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)] shadow-lg"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
