import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { loadPartners, gapsFor, PARTNER_DOCUMENT_TYPES } from "@/lib/partners";
import { sendMail } from "@/lib/mailer";

/**
 * The registration letter — sent BY HAND, never automatically.
 *
 * When a vendor or transporter's registration is finalised, the person
 * doing it presses "Send registration email" and the company sends a
 * proper letter: who was registered, as what, for which plants, which
 * papers are on file and which are still owed. Manual on purpose — an
 * automated letter fired at a half-finished registration reads as a
 * confirmation the business never meant to give.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  biomass_vendor: "Vendor",
  client: "Client",
  transporter: "Transporter",
  other: "Business Partner",
};

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "partners");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid);
  if (!user) return NextResponse.json({ error: "Session user not found." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const partner = loadPartners().find((p) => p.id === body?.id);
  if (!partner) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const to = String(body?.to || partner.email || "").trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json(
      { error: "No valid email. Add the partner's email to the registration, or type one to send to." },
      { status: 400 }
    );
  }

  const kindLabel = KIND_LABEL[partner.kind] || "Business Partner";
  const category = partner.category === "trading" ? "Trading" : "Manufacturing";
  const gaps = gapsFor(partner);
  const docLabel = (id: string) => PARTNER_DOCUMENT_TYPES.find((t) => t.id === id)?.label || id;
  const onFile = partner.documents.map((d) => `${docLabel(d.type)}${d.reference ? ` (${d.reference})` : ""}`);
  const still = gaps.missing.map((m) => m.label);

  const row = (k: string, v: string | null | undefined) =>
    v ? `<tr><td style="padding:4px 0;color:#6a6c6a;width:160px;vertical-align:top">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>` : "";

  const subject = `Registration ${still.length ? "update" : "confirmation"} — ${partner.name} (${kindLabel})`;

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #d5dad0;border-radius:12px;overflow:hidden">
    <div style="background:#163300;padding:20px 26px">
      <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#9fe870">Biome Industria Private Limited</div>
      <div style="font-size:21px;font-weight:800;color:#ffffff;margin-top:4px">Registration ${still.length ? "Update" : "Confirmation"}</div>
    </div>
    <div style="padding:24px 26px;color:#202420;font-size:14px;line-height:1.65">
      <p>Dear ${partner.contactPerson || partner.name},</p>
      <p>This is to ${still.length ? "update you on" : "confirm"} the registration of
        <b>${partner.legalName || partner.name}</b> as a <b>${kindLabel}${category ? ` — ${category}` : ""}</b>
        with Biome Industria Private Limited.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;margin:14px 0">
        ${row("Registered name", partner.legalName || partner.name)}
        ${row("Partner code", partner.code)}
        ${row("GSTIN", partner.gstin)}
        ${row("PAN", partner.pan)}
        ${row("Contact person", partner.contactPerson)}
        ${row("Phone", partner.phone)}
        ${row("Serving plant(s)", partner.plants.length ? partner.plants.join(", ") : "All locations")}
        ${row("Material / service", partner.material)}
        ${row("Status", partner.status)}
      </table>
      ${onFile.length ? `<p style="margin:8px 0 4px"><b>Documents on file:</b><br>${onFile.join("<br>")}</p>` : ""}
      ${still.length
        ? `<p style="margin:12px 0 4px;color:#8a4b00"><b>Still required to complete registration:</b><br>${still.join("<br>")}<br><br>Kindly share these at the earliest so the registration can be activated.</p>`
        : `<p>All required documents are on record. Your registration is complete.</p>`}
      <p style="margin-top:16px">For any correction to the above, reply to this email.</p>
      <p style="margin-top:18px">Regards,<br><b>${user.name}</b><br>Biome Industria Private Limited</p>
    </div>
    <div style="background:#f0f3ee;padding:12px 26px;font-size:11px;color:#6a6c6a">
      Sent from the Biome Industria Platform on ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.
    </div>
  </div>`;

  const text =
    `Registration ${still.length ? "update" : "confirmation"} — ${partner.name} (${kindLabel})\n\n` +
    `Registered name: ${partner.legalName || partner.name}\nCode: ${partner.code}\nGSTIN: ${partner.gstin || "—"}\n` +
    `PAN: ${partner.pan || "—"}\nPlants: ${partner.plants.join(", ") || "All"}\nStatus: ${partner.status}\n` +
    (onFile.length ? `\nDocuments on file:\n- ${onFile.join("\n- ")}\n` : "") +
    (still.length ? `\nStill required:\n- ${still.join("\n- ")}\n` : "\nAll required documents are on record.\n") +
    `\nRegards,\n${user.name}\nBiome Industria Private Limited`;

  const sent = await sendMail({ to, subject, text, html });
  if (!sent.ok) return NextResponse.json({ error: sent.error || "Could not send." }, { status: 502 });

  return NextResponse.json({ ok: true, to, subject });
}
