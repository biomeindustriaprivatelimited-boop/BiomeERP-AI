"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Leaf,
  Recycle,
  Users,
  Rocket,
  Package,
  MapPin,
  Mail,
  Linkedin,
  Globe,
  Target,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

const PURPOSE = [
  {
    icon: Leaf,
    title: "Decarbonising Energy",
    desc: "Manufacturing a replacement for fossil fuels to reduce deforestation and mining-related damage.",
  },
  {
    icon: Recycle,
    title: "Waste Repurposing",
    desc: "Converting agricultural waste that would otherwise be burnt into a fully renewable energy source.",
  },
  {
    icon: Users,
    title: "Empowering Farmers",
    desc: "Social upliftment through employment generation and skill development for rural workforces.",
  },
  {
    icon: Rocket,
    title: "Fuelling India",
    desc: "Helping India realise domestic energy potential and reduce dependence on energy imports.",
  },
];

const UNITS = [
  {
    name: "Unit 1",
    state: "Haryana",
    address: "Rewari Road Khaleta, Mayan Village, Rewari District, Haryana — 123103",
  },
  {
    name: "Unit 2",
    state: "Maharashtra",
    address: "Plot A-15, Gangakhed MIDC, Gangakhed, Parbhani District, Maharashtra — 431415",
  },
];

const TEAM = [
  {
    name: "Tanesh Singh Dod",
    role: "Executive Director",
    photo: "/team/tanesh-singh-dod.webp",
    linkedin: "https://www.linkedin.com/in/tanesh-singh-dod-6a1174167/",
  },
  {
    name: "Shubham Goel",
    role: "Executive Director",
    photo: "/team/shubham-goel.webp",
    linkedin: "https://www.linkedin.com/in/shubham-goel-a39141136/",
  },
];

export default function CompanyProfilePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 pt-6">
      {/* Hero */}
      <GlassCard activeBorder className="p-8 text-center md:p-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mx-auto mb-4 h-16 w-16 overflow-hidden rounded-2xl bg-biome-hover p-2"
        >
          <Image
            src="/assets/logo.png"
            alt="Biome Industria"
            width={64}
            height={64}
            className="h-full w-full object-contain"
          />
        </motion.div>
        <h1 className="font-display text-2xl font-semibold text-biome-text md:text-3xl">
          Biome Industria Private Limited
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm italic text-biome-leafBright">
          &ldquo;Think Biomass, Think Biome.&rdquo;
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-biome-muted md:text-base">
          An impact-focused venture driven to meet today&rsquo;s energy demands
          while safeguarding the environment for tomorrow — promoting
          economically feasible green fuels across the Indian industrial
          landscape, from densified biomass today toward CBG, Ethanol,
          Bio-MDF, Bio-Char and Bio-Bitumen in the future.
        </p>
      </GlassCard>

      {/* Purpose */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">
          Our Purpose
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PURPOSE.map((p, i) => {
            const Icon = p.icon;
            return (
              <GlassCard key={p.title} delay={i * 0.06} className="p-5">
                <div className="mb-3 w-fit rounded-xl bg-biome-leaf/12 p-2.5">
                  <Icon size={18} className="text-biome-leafBright" />
                </div>
                <h3 className="font-display text-sm font-medium text-biome-text">
                  {p.title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-biome-muted">
                  {p.desc}
                </p>
              </GlassCard>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Products */}
        <GlassCard className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Package size={18} className="text-biome-skyBright" />
            <h2 className="font-display text-base font-medium text-biome-text">
              Products
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-biome-sky/30 bg-biome-sky/10 px-3 py-1.5 text-xs font-medium text-biome-skyBright">
              Briquettes · 70–90mm
            </span>
            <span className="rounded-full border border-biome-sky/30 bg-biome-sky/10 px-3 py-1.5 text-xs font-medium text-biome-skyBright">
              Pellets · 6–25mm
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-biome-muted">
            Heat output ranging 2800–4000 kcal/kg, from feedstocks including
            mustard husk, paddy straw, soyabean husk, chana husk, groundnut
            shells and bagasse.
          </p>
        </GlassCard>

        {/* Vision */}
        <GlassCard className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Target size={18} className="text-biome-bolt" />
            <h2 className="font-display text-base font-medium text-biome-text">
              Our Vision
            </h2>
          </div>
          <ul className="space-y-2 text-xs leading-relaxed text-biome-muted">
            <li>• 1 million tonnes of biomass utilized annually by 2030</li>
            <li>• Diversify into CBG, Ethanol and liquid/gaseous biofuels</li>
            <li>• Upskill rural workforce as agro-waste entrepreneurs</li>
            <li>• Contribute to India&rsquo;s Net Zero goal — offset 1M tonnes CO₂</li>
          </ul>
        </GlassCard>
      </div>

      {/* Units */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">
          Manufacturing Units
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {UNITS.map((u, i) => (
            <GlassCard key={u.name} delay={i * 0.08} className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <MapPin size={16} className="text-biome-leafBright" />
                <h3 className="font-display text-sm font-medium text-biome-text">
                  {u.name} — {u.state}
                </h3>
              </div>
              <p className="text-xs text-biome-muted">{u.address}</p>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Team */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">
          Leadership
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TEAM.map((t, i) => (
            <GlassCard key={t.name} delay={i * 0.08} className="flex items-center gap-4 p-5">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-biome-line">
                <Image src={t.photo} alt={t.name} fill className="object-cover" sizes="64px" />
              </div>
              <div>
                <h3 className="font-display text-sm font-medium text-biome-text">
                  {t.name}
                </h3>
                <p className="text-xs text-biome-muted">{t.role}</p>
                <a
                  href={t.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-biome-skyBright hover:underline"
                >
                  <Linkedin size={12} /> LinkedIn
                </a>
              </div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Contact */}
      <GlassCard className="p-6">
        <h2 className="mb-3 font-display text-base font-medium text-biome-text">
          Get in Touch
        </h2>
        <div className="flex flex-wrap gap-4 text-sm text-biome-muted">
          <a
            href="mailto:biomeindustria@gmail.com"
            className="inline-flex items-center gap-2 hover:text-biome-leafBright"
          >
            <Mail size={15} /> biomeindustria@gmail.com
          </a>
          <a
            href="https://www.linkedin.com/company/biome-industria-pvt-ltd/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-biome-leafBright"
          >
            <Linkedin size={15} /> LinkedIn
          </a>
          <a
            href="https://biomeindustria.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 hover:text-biome-leafBright"
          >
            <Globe size={15} /> biomeindustria.com
          </a>
        </div>
      </GlassCard>
    </div>
  );
}
