"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FileStack, Download, FileSpreadsheet, RotateCcw } from "lucide-react";
import {
  BLANK_CHALLAN,
  CHALLAN_DEFAULTS,
  CLIENT_LABELS,
  calcNetWeightKg,
  kgToMt,
  type ChallanClient,
  type ChallanFormData,
} from "@/lib/deliveryChallan";
import { generateChallanPdf, generateChallanExcel } from "@/lib/deliveryChallanExport";

/** One text input, styled to match the rest of the platform's forms. */
function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-biome-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-biome-line bg-biome-hover px-3 py-2 text-[13px] text-biome-text placeholder:text-biome-muted/50 outline-none transition-colors focus:border-biome-leafBright/60"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-biome-line bg-biome-hover p-4">
      <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-biome-leafBright">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export default function DeliveryChallanPage() {
  const [data, setData] = useState<ChallanFormData>(BLANK_CHALLAN);
  const [busy, setBusy] = useState<"pdf" | "excel" | null>(null);

  const net = useMemo(() => calcNetWeightKg(data.grossWeightKg, data.tareWeightKg), [data]);

  const set = <K extends keyof ChallanFormData>(key: K) => (value: ChallanFormData[K]) =>
    setData((d) => ({ ...d, [key]: value }));

  function handleClientChange(client: ChallanClient) {
    const defaults = CHALLAN_DEFAULTS[client];
    setData((d) => ({ ...d, client, ...defaults }));
  }

  function reset() {
    setData({ ...BLANK_CHALLAN, ...CHALLAN_DEFAULTS.ntpc_mouda, client: "ntpc_mouda" });
  }

  async function handleDownload(kind: "pdf" | "excel") {
    setBusy(kind);
    try {
      if (kind === "pdf") {
        await generateChallanPdf(data);
      } else {
        // Excel comes from the company's OWN workbook rather than being
        // drawn from scratch. That is what keeps the four copies, the
        // bank block and the logo exactly as the plant expects them —
        // only this consignment's values are written in.
        const res = await fetch("/api/delivery-challan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plant: data.client === "ntpc_solapur" ? "solapur" : "mouda",
            challanNo: data.challanNo,
            date: data.challanDate,
            transporter: data.transporterName,
            // The form calls it vehicleNo; the challan template calls the
            // same field lorryNo.
            lorryNo: data.vehicleNo,
            lrNo: data.lrNo,
            ewayBillNo: data.ewayBillNo,
            // There is no separate quantity field — the material weight IS
            // the quantity, and it is already derived from gross minus tare.
            quantity: net,
            grossWeight: data.grossWeightKg,
            tareWeight: data.tareWeightKg,
            materialWeight: net,
          }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${data.challanNo || "Delivery Challan"}.xlsx`;
          document.body.appendChild(a);
          a.click();
          window.setTimeout(() => a.remove(), 4000);
          window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        } else {
          // The template route needs `exceljs`; fall back to the built-in
          // generator rather than leaving the user with nothing.
          await generateChallanExcel(data);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="pt-1">
        <h1 className="flex items-center gap-2.5 font-display text-xl font-semibold text-biome-text">
          <FileStack size={20} className="text-biome-leafBright" />
          Delivery Challan Generator
        </h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-biome-muted">
          Fill in one dispatch and export an exact-replica Delivery Challan for NTPC Mouda or NTPC
          Solapur — a print-ready PDF (Mouda 3-page / Solapur 2-page, with Annexure-II where applicable) and a
          formula-driven Excel copy, both generated locally in your browser.
        </p>
      </motion.div>

      {/* Client selector */}
      <div className="flex gap-1 rounded-xl border border-biome-line bg-biome-hover p-1 sm:w-fit">
        {(Object.keys(CLIENT_LABELS) as ChallanClient[]).map((key) => (
          <button
            key={key}
            onClick={() => handleClientChange(key)}
            className={`relative flex-1 rounded-lg px-4 py-1.5 text-[12px] font-medium transition-colors sm:flex-none ${
              data.client === key
                ? "bg-biome-leaf/15 text-biome-leafBright"
                : "text-biome-muted hover:text-biome-text"
            }`}
          >
            {CLIENT_LABELS[key]}
          </button>
        ))}
      </div>

      <Section title="Header & Dispatch Data">
        <Field label="Challan No." value={data.challanNo} onChange={set("challanNo")} placeholder="BI/NTPC/MOU/089" />
        <Field label="Challan Date" value={data.challanDate} onChange={set("challanDate")} placeholder="30-07-2026" />
        <Field label="P.O. No. / LOA No." value={data.poNo} onChange={set("poNo")} placeholder="4000348583-M11-1043" />
        <Field label="LOA Date" value={data.loaDate} onChange={set("loaDate")} placeholder="07-10-2024" />
        <Field
          label="Other References / BDC Ref No."
          value={data.bdcRefNo}
          onChange={set("bdcRefNo")}
          placeholder="BDC39/GKD/39"
        />
        <Field label="E-Way Bill No." value={data.ewayBillNo} onChange={set("ewayBillNo")} placeholder="3923 0220 3448" />
        <Field label="Vendor Code" value={data.vendorCode} onChange={set("vendorCode")} placeholder="00001225467" />
      </Section>

      <Section title="Logistics Details">
        <Field label="Transporter Name" value={data.transporterName} onChange={set("transporterName")} placeholder="PIYUSH TRANSPORT" />
        <Field label="Lorry / Vehicle No." value={data.vehicleNo} onChange={set("vehicleNo")} placeholder="MH40BG9225" />
        <Field label="L.R. / R.R. No." value={data.lrNo} onChange={set("lrNo")} />
        <Field label="Driver Mobile No." value={data.driverMobile} onChange={set("driverMobile")} />
        <Field label="Driver Licence No." value={data.driverLicenseNo} onChange={set("driverLicenseNo")} />
        <Field label="Destination / Place of Dispatch" value={data.destination} onChange={set("destination")} />
      </Section>

      <Section title="Goods & Weight Details">
        <Field label="Item Description" value={data.itemDescription} onChange={set("itemDescription")} />
        <Field label="HSN / SAC Code" value={data.hsnCode} onChange={set("hsnCode")} />
        <Field label="Gross Weight (Kg)" value={data.grossWeightKg} onChange={set("grossWeightKg")} type="number" />
        <Field label="Tare Weight (Kg)" value={data.tareWeightKg} onChange={set("tareWeightKg")} type="number" />
        <div className="sm:col-span-2 rounded-lg border border-biome-leaf/25 bg-biome-leaf/[0.06] px-3 py-2.5">
          <span className="text-[11px] font-medium text-biome-muted">Net Material Weight (auto-calculated)</span>
          <div className="mt-0.5 font-display text-lg font-semibold text-biome-leafBright">
            {net.toLocaleString("en-IN")} Kg
            <span className="ml-2 text-sm font-normal text-biome-muted">({kgToMt(net)} MT)</span>
          </div>
        </div>
      </Section>

      <Section title="Technical / Consignment Tag Details (Annexure-II)">
        <Field label="Batch Number" value={data.batchNumber} onChange={set("batchNumber")} />
        <Field label="Pellet Diameter & Specs" value={data.pelletSpec} onChange={set("pelletSpec")} />
        <Field label="Base Material %" value={data.baseMaterialPct} onChange={set("baseMaterialPct")} />
        <Field label="Mixing Material %" value={data.mixingMaterialPct} onChange={set("mixingMaterialPct")} />
        <Field label="Additive %" value={data.additivePct} onChange={set("additivePct")} />
      </Section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-biome-line bg-biome-bgSoft/95 p-3 shadow-lg backdrop-blur">
        <button
          onClick={() => handleDownload("pdf")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-biome-leaf px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Download size={14} />
          {busy === "pdf" ? "Generating PDF…" : "Download PDF (Mouda 3-page / Solapur 2-page)"}
        </button>
        <button
          onClick={() => handleDownload("excel")}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg border border-biome-line bg-biome-hover px-4 py-2 text-[13px] font-medium text-biome-text transition-colors hover:bg-biome-hover disabled:opacity-60"
        >
          <FileSpreadsheet size={14} />
          {busy === "excel" ? "Generating Excel…" : "Download Excel"}
        </button>
        <button
          onClick={reset}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-biome-muted transition-colors hover:text-biome-text"
        >
          <RotateCcw size={13} />
          Reset form
        </button>
      </div>
    </div>
  );
}
