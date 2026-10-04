"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle } from "lucide-react";

/**
 * A sheet cell that suggests registered names as you type.
 *
 * Fed ONLY with what the server says this plant may see (see
 * /api/partners/suggest), so the list itself is the isolation — nothing
 * here filters by plant. Free typing still works: a name that is not in
 * the register is kept, with a quiet "not registered" mark, because the
 * truck at the gate does not wait for the paperwork.
 *
 * The list is drawn in a portal at a fixed position: the sheet scrolls
 * inside an overflow box that would otherwise clip it.
 */

export interface ComboOption {
  key: string;
  kind: "vendor" | "transporter" | "client";
  code: string;
  name: string;
  legalName: string;
  city: string;
  status: string;
  /** "registered" = partners register; "plant_list" = the plant's imported code list. */
  source: "registered" | "plant_list";
}

const KIND_LABEL: Record<ComboOption["kind"], string> = { vendor: "Vendor", transporter: "Transporter", client: "Client" };

export function optionMatches(o: ComboOption, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [o.code, o.name, o.legalName].some((x) => x && x.toLowerCase().includes(s));
}

export default function PartnerCombo({
  value, onChange, onPick, options, field, className, onOpen, kindsLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (o: ComboOption) => void;
  options: ComboOption[];
  /** Whether the cell holds the partner's name or its code. */
  field: "name" | "code";
  className: string;
  /** Called when the list opens — lets the grid refetch a stale list. */
  onOpen?: () => void;
  kindsLabel: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);

  const q = String(value ?? "");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (showAll && s.length < 2) return options.slice(0, 60);
    if (s.length < 2) return [];
    const hit = options.filter((o) => optionMatches(o, s));
    // Starts-with first, then contains; registered before the plant list.
    const rank = (o: ComboOption) =>
      (o.source === "registered" ? 0 : 2) +
      ([o.code, o.name].some((x) => x.toLowerCase().startsWith(s)) ? 0 : 1);
    return hit.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 60);
  }, [q, options, showAll]);

  // Registered = the cell's text is exactly a registered partner's name/code.
  const registered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return options.some(
      (o) => o.source === "registered" &&
        (field === "code" ? o.code.toLowerCase() === s : o.name.toLowerCase() === s || o.legalName.toLowerCase() === s)
    );
  }, [q, options, field]);

  const isOpen = open && matches.length > 0;

  const place = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 220 && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 2 : r.bottom + 2, width: Math.max(r.width, 320), up });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [isOpen]);

  useEffect(() => { setActive(0); }, [q, showAll]);

  useEffect(() => {
    if (!isOpen) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, isOpen]);

  function pick(o: ComboOption) {
    onPick(o);
    setOpen(false);
    setShowAll(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) { setOpen(true); setShowAll(true); onOpen?.(); return; }
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      if (!isOpen) return;
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (isOpen && matches[active]) { e.preventDefault(); pick(matches[active]); }
    } else if (e.key === "Escape") {
      if (isOpen) { e.preventDefault(); e.stopPropagation(); }
      setOpen(false);
      setShowAll(false);
    } else if (e.key === "Tab") {
      setOpen(false);
      setShowAll(false);
    }
  }

  const listbox = isOpen && pos && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={listRef}
          role="listbox"
          data-testid="partner-suggestions"
          className="fixed z-[200] max-h-60 overflow-auto rounded-xl border border-biome-line bg-biome-surface py-1 text-[11.5px] shadow-xl"
          style={{
            left: pos.left, width: pos.width,
            ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
          }}
        >
          {matches.map((o, idx) => (
            <div
              key={o.key}
              data-idx={idx}
              role="option"
              aria-selected={idx === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(idx)}
              className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 ${idx === active ? "bg-biome-leaf/10 text-biome-text" : "text-biome-text/90"}`}
            >
              {o.code && <span className="shrink-0 rounded bg-biome-hover px-1 font-mono text-[10px] text-biome-muted">{o.code}</span>}
              <span className="min-w-0 flex-1 truncate">
                {o.name}
                {o.city && <span className="ml-1 text-[10px] text-biome-muted">· {o.city}</span>}
              </span>
              <span className="shrink-0 text-[9.5px] text-biome-muted">
                {o.source === "plant_list" ? "plant list" : o.status === "active" ? KIND_LABEL[o.kind] : `${KIND_LABEL[o.kind]} · ${o.status.replace("_", " ")}`}
              </span>
            </div>
          ))}
        </div>,
        document.body
      )
    : null;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={q}
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setShowAll(false);
          if (!open) onOpen?.();
          setOpen(true);
        }}
        onFocus={() => onOpen?.()}
        onBlur={() => { setOpen(false); setShowAll(false); }}
        onKeyDown={onKeyDown}
        title={registered ? `Type 2+ letters for registered ${kindsLabel} of this plant · ↓ for the full list` : undefined}
        className={`${className} ${registered ? "" : "border-amber-500/50 pr-5"}`}
      />
      {!registered && (
        <span
          data-testid="not-registered"
          title={`Not registered — no ${kindsLabel.replace(/s$/, "")} by this ${field} is registered for this plant. You can keep it, or register it under Registration.`}
          className="pointer-events-auto absolute right-1 top-1/2 -translate-y-1/2 text-amber-500"
        >
          <AlertCircle size={11} />
        </span>
      )}
      {listbox}
    </div>
  );
}
