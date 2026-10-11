"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Leaf, Recycle, Users, Rocket, Package, Mail, Linkedin, Globe, Search, Building2, Factory, Zap, Truck,
  FileText, FlaskConical, ShieldCheck, BookOpen, GraduationCap, ChevronDown, Pencil, Plus, Trash2, RotateCcw,
  X, Loader2, Check, Camera, Eye, Layers,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";
import Portal from "@/components/Portal";

/**
 * Company Profile — open to every signed-in user.
 *
 * The top (hero, purpose) and bottom (leadership, contact) are the
 * company's public face. The middle is the business guide: category tabs
 * + search over sections a new employee can read to understand the
 * business. Defaults ship with the app (lib/companyProfile.ts); admin /
 * developer ("company.edit") can edit, add, hide and restore sections and
 * upload director photos — everyone else reads.
 */

const PURPOSE = [
  { icon: Leaf, title: "Decarbonising Energy", desc: "Manufacturing a replacement for fossil fuels to reduce deforestation and mining-related damage." },
  { icon: Recycle, title: "Waste Repurposing", desc: "Converting agricultural waste that would otherwise be burnt into a fully renewable energy source." },
  { icon: Users, title: "Empowering Farmers", desc: "Social upliftment through employment generation and skill development for rural workforces." },
  { icon: Rocket, title: "Fuelling India", desc: "Helping India realise domestic energy potential and reduce dependence on energy imports." },
];

const CAT_ICONS: Record<string, any> = { Building2, Package, Factory, Zap, Truck, FileText, FlaskConical, Users, ShieldCheck, BookOpen, GraduationCap };

interface Section { id: string; category: string; title: string; body: string; order: number; custom?: boolean; edited?: boolean; updatedAt?: string; updatedBy?: string }
interface Category { id: string; label: string; icon: string }
interface Director { id: string; name: string; role: string; linkedin: string; photoUrl: string; photoSource: "uploaded" | "bundled"; photoUpdatedAt?: string }

/** Bundled photos, used until the profile loads (versioned so a new photo shows). */
const FALLBACK_DIRECTORS: Director[] = [
  { id: "tanesh-singh-dod", name: "Tanesh Singh Dod", role: "Executive Director", linkedin: "https://www.linkedin.com/in/tanesh-singh-dod-6a1174167/", photoUrl: "/team/tanesh-singh-dod.webp?v=20261004", photoSource: "bundled" },
  { id: "shubham-goel", name: "Shubham Goel", role: "Executive Director", linkedin: "https://www.linkedin.com/in/shubham-goel-a39141136/", photoUrl: "/team/shubham-goel.webp?v=20261004", photoSource: "bundled" },
];

export default function CompanyProfilePage() {
  const [data, setData] = useState<{ categories: Category[]; sections: Section[]; hidden: { id: string; title: string; category: string }[]; directors: Director[]; canEdit: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Partial<Section> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/company/profile", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the company profile.");
      setData(json);
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const categories = data?.categories || [];
  const sections = useMemo(() => data?.sections || [], [data]);
  const canEdit = Boolean(data?.canEdit);
  const directors = data?.directors?.length ? data.directors : FALLBACK_DIRECTORS;

  const q = query.trim().toLowerCase();
  const visible = sections.filter((s) =>
    (q ? true : tab === "all" || s.category === tab) &&
    (!q || `${s.title}\n${s.body}`.toLowerCase().includes(q))
  );
  const countFor = (cat: string) => sections.filter((s) => s.category === cat).length;

  async function put(body: any) {
    const res = await fetch("/api/company/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not save.");
    await load();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 pt-6">
      {/* Hero */}
      <GlassCard activeBorder className="p-8 text-center md:p-12">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto mb-4 h-16 w-16 overflow-hidden rounded-2xl bg-biome-hover p-2">
          <Image src="/assets/logo.png" alt="Biome Industria" width={64} height={64} className="h-full w-full object-contain" />
        </motion.div>
        <h1 className="font-display text-2xl font-semibold text-biome-text md:text-3xl">Biome Industria Private Limited</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm italic text-biome-leafBright">&ldquo;Think Biomass, Think Biome.&rdquo;</p>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-biome-muted md:text-base">
          An impact-focused venture driven to meet today&rsquo;s energy demands while safeguarding the environment for tomorrow —
          promoting economically feasible green fuels across the Indian industrial landscape, from densified biomass today toward
          CBG, Ethanol, Bio-MDF, Bio-Char and Bio-Bitumen in the future.
        </p>
      </GlassCard>

      {/* Purpose */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">Our Purpose</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PURPOSE.map((p, i) => {
            const Icon = p.icon;
            return (
              <GlassCard key={p.title} delay={i * 0.06} className="p-5">
                <div className="mb-3 w-fit rounded-xl bg-biome-leaf/12 p-2.5"><Icon size={18} className="text-biome-leafBright" /></div>
                <h3 className="font-display text-sm font-medium text-biome-text">{p.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-biome-muted">{p.desc}</p>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Business guide */}
      <section data-testid="business-guide" className="rounded-2xl border border-biome-line bg-biome-bgSoft">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-biome-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-medium text-biome-text">
              <Layers size={18} className="text-biome-leafBright" /> Business guide
            </h2>
            <p className="mt-0.5 text-[11.5px] text-biome-muted">
              Everything a new team member needs to understand the business — read by category or search.
            </p>
          </div>
          {canEdit ? (
            <button onClick={() => setEditing({ category: tab === "all" ? "about" : tab, title: "", body: "" })} data-testid="guide-add"
              className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-3.5 py-2 text-[11.5px] font-bold text-white">
              <Plus size={13} /> Add section
            </button>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted" data-testid="guide-readonly">
              <Eye size={12} /> Read-only · the admin keeps this up to date
            </span>
          )}
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-biome-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search — e.g. GCV, e-way bill, Solapur, co-firing, imprest"
              data-testid="guide-search"
              className="w-full rounded-xl border border-biome-line bg-biome-bg py-2.5 pl-9 pr-9 text-[12px] text-biome-text outline-none focus:border-biome-leaf/50" />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-biome-muted hover:text-biome-text"><X size={13} /></button>
            )}
          </div>
          {!q && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" data-testid="guide-tabs">
              <TabChip on={tab === "all"} onClick={() => setTab("all")} icon={Layers} label="All" count={sections.length} />
              {categories.map((c) => (
                <TabChip key={c.id} on={tab === c.id} onClick={() => setTab(c.id)} icon={CAT_ICONS[c.icon] || BookOpen} label={c.label} count={countFor(c.id)} />
              ))}
            </div>
          )}
          {q && <p className="text-[11px] text-biome-muted">{visible.length} section{visible.length === 1 ? "" : "s"} match &ldquo;{query}&rdquo;</p>}
          {error && <p className="rounded-xl border border-rose-400/30 bg-rose-400/[.07] px-3 py-2 text-[11.5px] text-biome-text">{error}</p>}
          {!data && !error && <p className="flex items-center gap-2 py-6 text-[12px] text-biome-muted"><Loader2 size={14} className="animate-spin" /> Loading…</p>}

          <div className="space-y-2">
            {(tab === "all" && !q ? categories : [null]).map((cat) => {
              const list = cat ? visible.filter((s) => s.category === cat.id) : visible;
              if (!list.length) return null;
              const Icon = cat ? CAT_ICONS[cat.icon] || BookOpen : null;
              return (
                <div key={cat?.id || "flat"} className="space-y-2">
                  {cat && (
                    <p className="flex items-center gap-1.5 pt-2 text-[10px] font-bold uppercase tracking-[.14em] text-biome-muted">
                      {Icon && <Icon size={12} />} {cat.label}
                    </p>
                  )}
                  {list.map((s, i) => {
                    const isOpen = openIds[s.id] ?? Boolean(q || (tab !== "all" && i === 0));
                    return (
                      <article key={s.id} className="overflow-hidden rounded-xl border border-biome-line bg-biome-bg" data-testid="guide-section">
                        <button onClick={() => setOpenIds({ ...openIds, [s.id]: !isOpen })} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-biome-hover">
                          <ChevronDown size={14} className={`shrink-0 text-biome-muted transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                          <span className="flex-1 text-[12.5px] font-semibold text-biome-text">{s.title}</span>
                          {q && <span className="text-[9.5px] uppercase tracking-[.1em] text-biome-muted">{categories.find((c) => c.id === s.category)?.label}</span>}
                          {s.custom && <span className="rounded-full border border-sky-500/35 px-1.5 text-[9px] font-semibold text-sky-600">added</span>}
                          {s.edited && <span className="rounded-full border border-amber-500/35 px-1.5 text-[9px] font-semibold text-amber-600">edited</span>}
                        </button>
                        {isOpen && (
                          <div className="border-t border-biome-line px-4 py-3">
                            <Body text={s.body} />
                            {canEdit && (
                              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-biome-line pt-2.5">
                                <button onClick={() => setEditing(s)} className="flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-text hover:bg-biome-hover"><Pencil size={11} /> Edit</button>
                                {s.edited && (
                                  <button onClick={() => put({ restore: s.id }).catch((e) => setError(e.message))} className="flex items-center gap-1 rounded-lg border border-biome-line px-2.5 py-1 text-[10.5px] font-semibold text-biome-muted hover:bg-biome-hover"><RotateCcw size={11} /> Restore default</button>
                                )}
                                <button onClick={() => { if (window.confirm(`${s.custom ? "Delete" : "Hide"} "${s.title}"?`)) put({ remove: s.id }).catch((e) => setError(e.message)); }}
                                  className="flex items-center gap-1 rounded-lg border border-rose-500/35 px-2.5 py-1 text-[10.5px] font-semibold text-rose-500 hover:bg-rose-500/10"><Trash2 size={11} /> {s.custom ? "Delete" : "Hide"}</button>
                                {s.updatedBy && <span className="ml-auto text-[9.5px] text-biome-muted">Last edited by {s.updatedBy}{s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ""}</span>}
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              );
            })}
            {data && visible.length === 0 && <p className="py-6 text-center text-[12px] text-biome-muted">Nothing found. Try another word.</p>}
          </div>

          {canEdit && (data?.hidden || []).length > 0 && (
            <div className="rounded-xl border border-dashed border-biome-line px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Hidden default sections</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data!.hidden.map((h) => (
                  <button key={h.id} onClick={() => put({ restore: h.id }).catch((e) => setError(e.message))}
                    className="flex items-center gap-1 rounded-full border border-biome-line px-2.5 py-1 text-[10.5px] text-biome-muted hover:text-biome-text">
                    <RotateCcw size={10} /> {h.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Leadership */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">Leadership</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {directors.map((t, i) => (
            <DirectorCard key={t.id} d={t} index={i} canEdit={canEdit} onChanged={load} />
          ))}
        </div>
      </div>

      {/* Contact */}
      <GlassCard className="p-6">
        <h2 className="mb-3 font-display text-base font-medium text-biome-text">Get in Touch</h2>
        <div className="flex flex-wrap gap-4 text-sm text-biome-muted">
          <a href="mailto:biomeindustria@gmail.com" className="inline-flex items-center gap-2 hover:text-biome-leafBright"><Mail size={15} /> biomeindustria@gmail.com</a>
          <a href="https://www.linkedin.com/company/biome-industria-pvt-ltd/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-biome-leafBright"><Linkedin size={15} /> LinkedIn</a>
          <a href="https://biomeindustria.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-biome-leafBright"><Globe size={15} /> biomeindustria.com</a>
        </div>
      </GlassCard>

      {editing && (
        <SectionEditor
          value={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (v) => { await put({ section: v }); setEditing(null); if (v.id) setOpenIds((o) => ({ ...o, [v.id!]: true })); }}
        />
      )}
    </div>
  );
}

function TabChip({ on, onClick, icon: Icon, label, count }: { on: boolean; onClick: () => void; icon: any; label: string; count: number }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${on ? "border-biome-leaf/60 bg-biome-leaf/15 text-biome-text" : "border-biome-line text-biome-muted hover:text-biome-text"}`}>
      <Icon size={12} /> {label} <span className="font-mono text-[10px] opacity-70">{count}</span>
    </button>
  );
}

/** The tiny markup: "### " heading, "- " bullet, blank line = paragraph. */
function Body({ text }: { text: string }) {
  const blocks: { type: "h" | "ul" | "p"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ type: "p", lines: [] }); continue; }
    if (line.startsWith("### ")) { blocks.push({ type: "h", lines: [line.slice(4)] }); continue; }
    if (/^\s*-\s+/.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last?.type === "ul") last.lines.push(line.replace(/^\s*-\s+/, ""));
      else blocks.push({ type: "ul", lines: [line.replace(/^\s*-\s+/, "")] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ type: "p", lines: [line] });
  }
  return (
    <div className="space-y-2 text-[12px] leading-relaxed text-biome-text">
      {blocks.filter((b) => b.lines.length).map((b, i) =>
        b.type === "h" ? <h4 key={i} className="pt-1 text-[11.5px] font-bold uppercase tracking-[.08em] text-biome-leaf">{b.lines[0]}</h4>
        : b.type === "ul" ? (
          <ul key={i} className="space-y-1">
            {b.lines.map((l, j) => <li key={j} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-biome-leaf/70" /><span>{l}</span></li>)}
          </ul>
        ) : <p key={i}>{b.lines.join(" ")}</p>
      )}
    </div>
  );
}

function SectionEditor({ value, categories, onClose, onSave }: { value: Partial<Section>; categories: Category[]; onClose: () => void; onSave: (v: Partial<Section>) => Promise<void> }) {
  const [form, setForm] = useState<Partial<Section>>(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  async function save() {
    setBusy(true); setErr(null);
    try { await onSave(form); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const input = "w-full rounded-xl border border-biome-line bg-biome-bg px-3 py-2 text-[12px] text-biome-text outline-none";
  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
        <div role="dialog" aria-modal="true" className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-biome-line bg-biome-bgSoft shadow-2xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-biome-line px-5 py-3.5">
            <Pencil size={15} className="text-biome-leaf" />
            <h3 className="flex-1 text-[13.5px] font-semibold text-biome-text">{value.id ? "Edit section" : "Add a section"}</h3>
            <button onClick={onClose} aria-label="Close" className="rounded-lg border border-biome-line p-1.5 text-biome-muted hover:bg-biome-hover"><X size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Category</span>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Order</span>
                <input type="number" value={form.order ?? ""} onChange={(e) => setForm({ ...form, order: e.target.value === "" ? undefined : Number(e.target.value) })} className={input} placeholder="auto" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Title</span>
              <input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[.12em] text-biome-muted">Text</span>
              <textarea value={form.body || ""} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={14} className={`${input} resize-y font-mono text-[11.5px]`} />
              <span className="mt-1 block text-[10px] text-biome-muted">Start a line with &ldquo;- &rdquo; for a bullet and &ldquo;### &rdquo; for a sub-heading. Leave an empty line between paragraphs.</span>
            </label>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-biome-line px-5 py-3">
            {err && <p className="mr-auto text-[11px] font-semibold text-rose-500">{err}</p>}
            <button onClick={onClose} disabled={busy} className="rounded-xl border border-biome-line px-4 py-2 text-[11.5px] font-semibold text-biome-muted">Cancel</button>
            <button onClick={save} disabled={busy || !String(form.title || "").trim()} className="flex items-center gap-1.5 rounded-xl bg-biome-leaf px-4 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function DirectorCard({ d, index, canEdit, onChanged }: { d: Director; index: number; canEdit: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("id", d.id);
      fd.append("file", file);
      const res = await fetch("/api/company/photo", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not upload.");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function reset() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/company/photo?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not reset.");
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <GlassCard delay={index * 0.08} className="flex items-center gap-5 p-5">
      <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border-2 border-biome-leaf/30 shadow-md">
        {/* Plain <img>: the URL carries a version, so a new photo is never
            served from an image cache (next/image's optimiser kept the old
            file under the same name). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.photoUrl} alt={d.name} className="h-full w-full object-cover object-top" data-testid={`director-photo-${d.id}`} />
        {busy && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 size={18} className="animate-spin text-white" /></span>}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[.14em] text-biome-leaf">Director {index + 1}</p>
        <h3 className="font-display text-base font-semibold text-biome-text">{d.name}</h3>
        <p className="text-xs text-biome-muted">{d.role}</p>
        <a href={d.linkedin} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-biome-skyBright hover:underline">
          <Linkedin size={12} /> LinkedIn
        </a>
        {canEdit && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-biome-line px-2 py-1 text-[10.5px] font-semibold text-biome-text hover:bg-biome-hover">
              <Camera size={11} /> Change photo
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" data-testid={`director-upload-${d.id}`}
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            {d.photoSource === "uploaded" && (
              <button onClick={reset} disabled={busy} className="flex items-center gap-1 rounded-lg border border-biome-line px-2 py-1 text-[10.5px] text-biome-muted hover:bg-biome-hover">
                <RotateCcw size={11} /> Use original
              </button>
            )}
          </div>
        )}
        {err && <p className="mt-1 text-[10.5px] text-rose-500">{err}</p>}
      </div>
    </GlassCard>
  );
}
