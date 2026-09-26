"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Truck, Factory, FileText, Radar, Package, Users } from "lucide-react";
import Hero3D from "@/components/brand/Hero3D";
import { SplitText, EASE } from "@/components/motion/kit";
import { Particles } from "@/components/fx";

/**
 * LOGIN SCENE — the Biome story, told while you type.
 * Left: the 3D prism with six modules orbiting it in real 3D space, a
 * rotating headline about the business (Rewari + Gangakhed, 27 power
 * plants, documents that file themselves, PO balances that never drift),
 * live counters, and a client marquee. Aurora, grid, particles, a
 * cursor-lit scene. Hands off to the card after 700 ms.
 */
interface Props { onRevealLogin: () => void }

const STORIES = [
  { k: "Two plants, one operating system.", s: "Rewari · Gangakhed — dispatch, weighbridge, receiving and billing on a single truth." },
  { k: "Documents that file themselves.", s: "Sales-group PDFs and photos are read in Hindi + English and land in Month → Client → Date → Reference." },
  { k: "PO balances that never drift.", s: "Consumed quantity is computed from linked supplies every time — cancellations recalculate by themselves." },
  { k: "27 power plants, every paper they insist on.", s: "APCPL, HTPS, NTPC, JPL, NPL — each client's document set, checked before billing." },
  { k: "What needs attention, decided.", s: "The Command Center turns every module's problems into context, impact and the next action." },
];
const ORBIT = [Truck, Factory, FileText, Radar, Package, Users];
// Only real clients from the company's client master — never filler names.
const CLIENTS = ["Jhajjar Power", "Nabha Power", "APCPL", "HTPS Kasimpur", "NTPC Mouda", "NTPC Dadri", "NTPC Tanda", "NTPC Solapur", "NTPC Vindhyachal", "NTPC Khargone", "Punjab Renewable Energy", "Lupin"];

export default function BiomassLoginScene({ onRevealLogin }: Props) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = window.setTimeout(onRevealLogin, 700); return () => window.clearTimeout(t); }, [onRevealLogin]);
  useEffect(() => { const t = window.setInterval(() => setI((x) => (x + 1) % STORIES.length), 5200); return () => window.clearInterval(t); }, []);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0" style={{ background: "radial-gradient(70% 60% at 25% 45%, rgb(159 232 112 / .14) 0%, transparent 60%), radial-gradient(50% 50% at 90% 10%, rgb(69 201 236 / .10) 0%, transparent 55%), linear-gradient(160deg,#0b1a06 0%,#06141a 100%)" }} />
      <motion.div className="absolute -left-40 top-1/3 h-[560px] w-[760px] rounded-full opacity-40 blur-3xl" style={{ background: "conic-gradient(from 90deg, rgb(159 232 112 / .5), rgb(69 201 236 / .3), rgb(159 232 112 / .5))" }} animate={{ rotate: 360 }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }} />
      <div className="absolute inset-0 opacity-[.06]" style={{ backgroundImage: "linear-gradient(rgb(226 246 213 / .5) 1px, transparent 1px), linear-gradient(90deg, rgb(226 246 213 / .5) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />
      <Particles density={90} className="!fixed" />
      <Hero3D className="absolute inset-y-0 left-0 w-[62%]" density={1600} />

      {/* Orbiting modules — real 3D ring */}
      <div className="absolute left-[8%] top-[18%] h-[420px] w-[420px] [perspective:900px] sm:left-[14%]">
        <motion.div className="absolute inset-0 [transform-style:preserve-3d]" animate={{ rotateY: 360 }} transition={{ duration: 28, repeat: Infinity, ease: "linear" }} style={{ transform: "rotateX(62deg)" }}>
          {ORBIT.map((I, k) => (
            <div key={k} className="absolute left-1/2 top-1/2 [transform-style:preserve-3d]" style={{ transform: `rotateY(${(k / ORBIT.length) * 360}deg) translateZ(210px) rotateX(-62deg)` }}>
              <motion.span className="-ml-5 -mt-5 flex h-10 w-10 items-center justify-center rounded-2xl border border-[#9fe870]/40 bg-[#0b1a06]/80 text-[#9fe870] shadow-[0_0_24px_rgb(159_232_112/.35)] backdrop-blur" animate={{ rotateY: -360 }} transition={{ duration: 28, repeat: Infinity, ease: "linear" }}><I size={16} /></motion.span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* The story */}
      {/* Scrim behind the story column so the headline stays legible
          while the prism and particles move behind it. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[62%]" style={{ background: "linear-gradient(90deg, rgb(4 12 3 / .78) 0%, rgb(4 12 3 / .45) 55%, transparent 100%)" }} />

      <div className="absolute bottom-[18%] left-8 z-10 max-w-xl sm:left-14 lg:left-20">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="text-[11px] font-bold uppercase tracking-[.35em] text-[#9fe870]">Biome Industria · AI ERP</motion.p>
        <div className="mt-3 min-h-[150px]">
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.6, ease: EASE }}>
              <h2 className="biome-shout text-[36px] leading-[1] tracking-[-0.04em] text-white sm:text-[48px]"><SplitText text={STORIES[i].k} /></h2>
              <p className="mt-3 max-w-lg text-[13px] leading-relaxed text-[#e2f6d5]/75">{STORIES[i].s}</p>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="mt-3 flex gap-1.5">{STORIES.map((_, k) => <button key={k} onClick={() => setI(k)} className={`h-1 rounded-full transition-all ${k === i ? "w-8 bg-[#9fe870]" : "w-3 bg-white/25"}`} />)}</div>
        <div className="mt-6 flex flex-wrap gap-5 font-mono text-[11px] text-[#e2f6d5]/70">
          {[["2", "plants"], ["27", "clients"], ["53", "vendors"], ["100%", "offline-first"]].map(([n, l]) => <span key={l}><span className="text-[18px] font-bold text-white">{n}</span> <span className="text-[#e2f6d5]/50">{l}</span></span>)}
        </div>
      </div>

      {/* Client marquee */}
      <div className="absolute inset-x-0 bottom-0 overflow-hidden border-t border-white/[.06] bg-black/20 py-2.5 backdrop-blur">
        <motion.div className="flex w-max gap-10 whitespace-nowrap px-6 text-[11px] font-semibold uppercase tracking-[.18em] text-[#e2f6d5]/50" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 40, repeat: Infinity, ease: "linear" }}>
          {[...CLIENTS, ...CLIENTS].map((c, k) => <span key={k} className="flex items-center gap-3"><span className="h-1.5 w-1.5 rounded-full bg-[#9fe870]" />{c}</span>)}
        </motion.div>
      </div>
    </div>
  );
}
