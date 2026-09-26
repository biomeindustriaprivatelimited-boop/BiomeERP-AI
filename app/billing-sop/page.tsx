"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  FileText,
  Truck,
  Tag,
  Scale,
  Fingerprint,
  ChevronDown,
  ClipboardCheck,
  AlertTriangle,
  FolderLock,
  Building2,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

interface ClientSOP {
  id: string;
  name: string;
  short: string;
  docs: string[];
  process: string[];
  remarks: string;
}

const DOC_CONTROL: { label: string; value: string }[] = [
  { label: "Company Name", value: "BIOME Industria Private Limited" },
  { label: "Document Name", value: "Standard Operating Procedure (SOP)" },
  { label: "Department", value: "Billing & Dispatch Operations" },
  { label: "Applicable To", value: "Accounts, Billing, Logistics & Coordination Team" },
  { label: "Version", value: "1.0" },
  { label: "Effective Date", value: "Immediate" },
  { label: "Approved By", value: "Management" },
];

const GUIDELINES = [
  {
    icon: ClipboardCheck,
    title: "3.1 Mandatory Verification",
    points: [
      "Purchase Order (PO) Number & Date",
      "Vehicle Number",
      "Material Weight",
      "Dispatch Location",
      "Vendor Details",
      "Driver Details (where applicable)",
      "GST & Tax Information",
    ],
  },
  {
    icon: Truck,
    title: "3.2 E-Way Bill Compliance",
    points: [
      "E-Way Bills generated only after dispatch details are confirmed",
      "Dispatch address must strictly follow client-specific instructions",
      "Any state/location mismatch must be escalated immediately",
    ],
  },
  {
    icon: FolderLock,
    title: "3.3 Document Sharing Protocol",
    points: [
      "Verified before circulation",
      "Saved in proper digital records",
      "Shared with the Sales Group immediately after preparation",
      "Maintained client-wise for audit and tracking",
    ],
  },
  {
    icon: Fingerprint,
    title: "3.4 Digital Signature Compliance",
    points: ["DSC attachment is mandatory before document sharing, wherever applicable"],
  },
];

const CLIENTS: ClientSOP[] = [
  {
    id: "jpl",
    name: "Jhajjar Power Limited (JPL)",
    short: "Client 01",
    docs: ["Tax Invoice", "E-Way Bill", "E-Invoice"],
    process: [
      "Generate Tax Invoice and E-Way Bill through Tally.",
      "Ensure PO Number and PO Date are mentioned correctly.",
      "Collect Vehicle Number, Bill T. Number, and Material Weight from vendor documents.",
      "If vendor's E-Way Bill shows Dispatch Location as Haryana, use the same in Biome's E-Way Bill.",
      "If vendor's E-Way Bill shows any location other than Haryana, generate Biome's E-Way Bill with Dispatch Location as Rewari Plant, Haryana.",
      "Share final Tax Invoice and E-Way Bill with the Sales Group.",
    ],
    remarks: "Maintain strict verification of dispatch state before final E-Way generation to avoid compliance issues.",
  },
  {
    id: "npl",
    name: "Nabha Power Limited (NPL)",
    short: "Client 02",
    docs: ["Delivery Challan", "E-Way Bill"],
    process: [
      "Generate Delivery Challan and E-Way Bill through Tally.",
      "Include PO details, dispatch details, vendor name, vehicle number, and weight.",
      "Vehicle Number and Material Weight must be collected from vendor documents.",
      "Verify vendor name and dispatch location before E-Way Bill generation.",
      "Dispatch location and Vendor Name must match the vendor's E-Way Bill.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "DSC attachment on the Delivery Challan is mandatory before circulation.",
  },
  {
    id: "tanda",
    name: "NTPC Tanda",
    short: "Client 03",
    docs: ["Delivery Challan", "E-Way Bill", "Consignment Tag"],
    process: [
      "Generate Delivery Challan and E-Way Bill through Tally.",
      "Ensure PO Number and PO Date are correctly updated.",
      "Take dispatch location details from the sales group.",
      "Collect Vehicle Number and Material Weight from vendor documents.",
      "Update Vehicle Number, Challan Number, and Weight Details on the Consignment Tag.",
      "Ensure Consignment Tag dispatch details match the E-Way Bill.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "All dispatch documents must remain identical and synchronized. DSC attachment on the Delivery Challan is mandatory.",
  },
  {
    id: "solapur",
    name: "NTPC Solapur",
    short: "Client 04",
    docs: ["Delivery Challan", "E-Way Bill", "Consignment Tag"],
    process: [
      "Generate Delivery Challan and E-Way Bill.",
      "Dispatch location must always remain \u201cBiome Gangakhed Plant\u201d.",
      "PO Number and PO Date are mandatory.",
      "For manufacturing sales, collect vehicle and weight details from plant weight slips.",
      "For trading sales, collect vehicle and weight details from vendor documents.",
      "Even in trading sales, dispatch location remains Biome Gangakhed Plant.",
      "Update Vehicle Number, Challan Number, and Weight Details on Consignment Tag.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "Dispatch location should never be modified without management approval.",
  },
  {
    id: "vindhyanchal",
    name: "NTPC Vindhyanchal",
    short: "Client 05",
    docs: ["Delivery Challan", "E-Way Bill", "Consignment Tag"],
    process: [
      "Generate Delivery Challan and E-Way Bill.",
      "Ensure PO Number and PO Date are updated.",
      "Take dispatch location details from the sales group or vendor document.",
      "Collect Vehicle Number and Material Weight from vendor documents.",
      "Update dispatch details, vehicle details, challan number, and weight on the Consignment Tag.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "Cross-check all dispatch details before final sharing. DSC attachment on the Delivery Challan is mandatory.",
  },
  {
    id: "mouda",
    name: "NTPC Mouda",
    short: "Client 06",
    docs: ["Delivery Challan", "E-Way Bill", "Weight Slip", "Fast Tag Documentation"],
    process: [
      "Prepare Delivery Challan in MS Word.",
      "Confirm Vehicle Number and Material Weight with the vendor.",
      "Generate E-Way Bill through the E-Way portal.",
      "Dispatch location must always remain \u201cBiome Rewari Plant\u201d.",
      "Share E-Way details with the authorized person for Fast Tag processing.",
      "Fast Tag timing must be minimum one hour after E-Way generation.",
      "Prepare internal Weight Slip \u2014 Gross Weight one hour before E-Way timing, Tare Weight minimum two hours after Gross Weight.",
      "Include Driver Mobile Number and License Number in Delivery Challan; collect driver details from vendor group.",
      "Merge all final documents into a single file and share with the Sales Group.",
    ],
    remarks: "Vehicle entry timing must align with Fast Tag movement records to avoid operational delays.",
  },
  {
    id: "apcpl",
    name: "APCPL",
    short: "Client 07",
    docs: ["Delivery Challan", "E-Way Bill", "Consignment Tag"],
    process: [
      "Generate Delivery Challan and E-Way Bill through Tally.",
      "Dispatch location must always remain \u201cRewari Plant\u201d.",
      "For trading sales, collect Vehicle Number and Material Weight from vendor documents.",
      "Update Vehicle Number, Challan Number, and Weight Details on Consignment Tag.",
      "Ensure PO Number and PO Date are correctly updated.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "DSC attachment is mandatory on all dispatch documents.",
  },
  {
    id: "devyani",
    name: "Devyani Agro",
    short: "Client 08",
    docs: ["Delivery Challan", "E-Way Bill"],
    process: [
      "Generate Delivery Challan and E-Way Bill.",
      "Dispatch location must always remain \u201cRewari Plant\u201d \u2014 most dispatches processed from BIOME Rewari Plant.",
      "Vehicle Number and Material Weight must be taken from plant weight slips.",
      "Verify all weight details and Vehicle No. from the Weight Slip before finalization.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "Ensure proper weight accuracy in all dispatch-related documents.",
  },
  {
    id: "ssepl",
    name: "SSEPL",
    short: "Client 09",
    docs: ["Tax Invoice", "E-Way Bill"],
    process: [
      "Generate Tax Invoice and E-Way Bill.",
      "Both manufacturing and trading sales are applicable.",
      "For manufacturing sales, collect details from plant weight slips.",
      "For trading sales, collect details from vendor documents.",
      "Dispatch location must remain \u201cRewari Plant\u201d.",
      "Verify all invoice details before circulation and share with the Sales Group.",
    ],
    remarks: "Accuracy in invoice and dispatch documentation is mandatory.",
  },
  {
    id: "htps",
    name: "HTPS Aligarh",
    short: "Client 10",
    docs: ["Delivery Challan", "E-Way Bill"],
    process: [
      "Generate Delivery Challan and E-Way Bill.",
      "Ensure PO Number and PO Date are properly updated.",
      "Vehicle Number and Material Weight must be collected from vendor documents.",
      "Dispatch location must remain \u201cRewari Plant\u201d.",
      "Share final documents with the Sales Group.",
    ],
    remarks: "DSC attachment is mandatory before dispatch documentation circulation.",
  },
];

const DOC_ICON: Record<string, typeof FileText> = {
  "Tax Invoice": FileText,
  "E-Invoice": FileText,
  "Delivery Challan": FileText,
  "E-Way Bill": Truck,
  "Consignment Tag": Tag,
  "Weight Slip": Scale,
  "Fast Tag Documentation": ShieldCheck,
};

export default function BillingSopPage() {
  const [openId, setOpenId] = useState<string | null>("jpl");

  return (
    <div className="mx-auto max-w-6xl space-y-8 pt-6">
      {/* Hero */}
      <GlassCard activeBorder className="overflow-hidden p-8 text-center md:p-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
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
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-biome-skyBright">
          Standard Operating Procedure
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-biome-text md:text-3xl">
          Billing, Dispatch &amp; Documentation Management
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-biome-muted md:text-base">
          A structured, professional process for billing, dispatch documentation,
          E-Way Bill generation, invoice preparation, and client coordination across
          all major clients of BIOME Industria Private Limited.
        </p>

        <div className="mx-auto mt-6 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-biome-line bg-biome-hover p-4 text-left sm:grid-cols-3">
          {DOC_CONTROL.map((d, i) => (
            <motion.div
              key={d.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
            >
              <p className="text-[10px] uppercase tracking-wide text-biome-muted">{d.label}</p>
              <p className="text-xs font-medium text-biome-text">{d.value}</p>
            </motion.div>
          ))}
        </div>
      </GlassCard>

      {/* Purpose & Scope */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={18} className="text-biome-leafBright" />
            <h2 className="font-display text-base font-medium text-biome-text">Purpose</h2>
          </div>
          <p className="text-xs leading-relaxed text-biome-muted">
            Establishes a structured, professional process for billing, dispatch
            documentation, E-Way Bill generation, invoice preparation, and client
            coordination &mdash; ensuring accuracy, tax &amp; transport compliance,
            departmental coordination, timely dispatch, and uniform standards across
            all clients.
          </p>
        </GlassCard>
        <GlassCard delay={0.06} className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <Building2 size={18} className="text-biome-skyBright" />
            <h2 className="font-display text-base font-medium text-biome-text">Scope</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Billing Department", "Dispatch Coordination Team", "Accounts Team", "Sales Coordination Team", "Plant & Logistics Operations"].map(
              (s) => (
                <span
                  key={s}
                  className="rounded-full border border-biome-sky/30 bg-biome-sky/10 px-3 py-1.5 text-xs font-medium text-biome-skyBright"
                >
                  {s}
                </span>
              )
            )}
          </div>
        </GlassCard>
      </div>

      {/* Standard Operational Guidelines */}
      <div>
        <h2 className="mb-3 font-display text-lg font-medium text-biome-text">
          Standard Operational Guidelines
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {GUIDELINES.map((g, i) => {
            const Icon = g.icon;
            return (
              <GlassCard key={g.title} delay={i * 0.06} className="p-5">
                <div className="mb-3 w-fit rounded-xl bg-biome-leaf/12 p-2.5">
                  <Icon size={18} className="text-biome-leafBright" />
                </div>
                <h3 className="font-display text-sm font-medium text-biome-text">{g.title}</h3>
                <ul className="mt-2 space-y-1.5">
                  {g.points.map((p) => (
                    <li key={p} className="text-xs leading-relaxed text-biome-muted">
                      &bull; {p}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Client-wise SOP */}
      <div>
        <h2 className="mb-1 font-display text-lg font-medium text-biome-text">
          Client-wise Standard Operating Procedure
        </h2>
        <p className="mb-3 text-xs text-biome-muted">
          Tap a client to view required documents, the dispatch process, and remarks.
        </p>

        <div className="space-y-3">
          {CLIENTS.map((c, i) => {
            const isOpen = openId === c.id;
            return (
              <GlassCard key={c.id} delay={i * 0.04} className="overflow-hidden p-0">
                <button
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-biome-sky/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-biome-skyBright">
                      {c.short}
                    </div>
                    <span className="font-display text-sm font-medium text-biome-text md:text-base">
                      {c.name}
                    </span>
                  </div>
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.25 }}
                    className="shrink-0 text-biome-muted"
                  >
                    <ChevronDown size={18} />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden border-t border-biome-line"
                    >
                      <div className="grid gap-5 px-5 py-5 md:grid-cols-[220px_1fr]">
                        <div>
                          <p className="mb-2 text-[10px] uppercase tracking-wide text-biome-muted">
                            Required Documents
                          </p>
                          <div className="flex flex-col gap-2">
                            {c.docs.map((d) => {
                              const Icon = DOC_ICON[d] ?? FileText;
                              return (
                                <div
                                  key={d}
                                  className="flex items-center gap-2 rounded-lg border border-biome-line bg-biome-hover px-3 py-2"
                                >
                                  <Icon size={14} className="shrink-0 text-biome-leafBright" />
                                  <span className="text-xs text-biome-text">{d}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-[10px] uppercase tracking-wide text-biome-muted">
                            Operational Process
                          </p>
                          <ol className="space-y-2">
                            {c.process.map((step, idx) => (
                              <li key={idx} className="flex gap-2.5 text-xs leading-relaxed text-biome-muted">
                                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-biome-leaf/15 text-[10px] font-semibold text-biome-leafBright">
                                  {idx + 1}
                                </span>
                                <span>{step}</span>
                              </li>
                            ))}
                          </ol>

                          <div className="mt-4 flex items-start gap-2 rounded-lg border border-biome-bolt/25 bg-biome-bolt/[0.06] px-3 py-2.5">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-biome-boltDeep" />
                            <p className="text-xs leading-relaxed text-biome-text/90">{c.remarks}</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            );
          })}
        </div>
      </div>

      {/* Compliance & Final Remarks */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-6">
          <div className="mb-3 flex items-center gap-2">
            <FolderLock size={18} className="text-biome-skyBright" />
            <h2 className="font-display text-base font-medium text-biome-text">
              Compliance &amp; Record Management
            </h2>
          </div>
          <ul className="space-y-1.5">
            {[
              "All client files must be maintained in organized digital folders.",
              "Incorrect documentation may result in penalties, rejection, or dispatch delays.",
              "Any discrepancy must be immediately reported to management.",
              "Unauthorized changes in dispatch location are strictly prohibited.",
              "Proper document backup must be maintained for audit purposes.",
            ].map((p) => (
              <li key={p} className="text-xs leading-relaxed text-biome-muted">
                &bull; {p}
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard delay={0.06} activeBorder className="flex flex-col justify-center p-6 text-center">
          <p className="font-display text-sm font-medium text-biome-text">
            &ldquo;Strict adherence to this procedure is mandatory for smooth
            coordination, timely dispatches, and error-free documentation
            management.&rdquo;
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-wide text-biome-muted">
            Prepared for BIOME Industria Private Limited &middot; Billing &amp; Dispatch Operations
          </p>
        </GlassCard>
      </div>
    </div>
  );
}
