import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import {
  ticketAttachmentAllowed, MAX_TICKET_ATTACHMENTS, TicketAttachment, isOpen, Status,
} from "@/lib/support";

/**
 * Photos and PDFs on a support ticket.
 *
 * Kept in its own route rather than folded into the ticket body: a file
 * upload is multipart, the ticket is JSON, and mixing the two means every
 * ordinary reply carries the machinery for handling a 12 MB body.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ticket {
  id: string;
  ref: string;
  status: Status;
  raisedBy: string;
  attachments?: TicketAttachment[];
  updatedAt: string;
  [k: string]: any;
}

function file() { return path.join(paths.root, "support", "tickets.json"); }
function attachmentsDir() { return path.join(paths.root, "support", "attachments"); }

function load(): Ticket[] {
  const f = readJson<{ tickets: Ticket[] }>(file(), { tickets: [] });
  return Array.isArray(f.tickets) ? f.tickets : [];
}
function save(tickets: Ticket[]) {
  ensureDir(path.join(paths.root, "support"));
  writeJsonAtomic(file(), { tickets, updatedAt: new Date().toISOString() });
}

/** Resolves a stored path, refusing anything that points outside the folder. */
function resolveAttachment(relative: string): string | null {
  const base = attachmentsDir();
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const ticketId = String(form.get("ticketId") || "");
  const uploaded = form.get("file");
  if (!ticketId || !(uploaded instanceof File)) {
    return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  }

  const tickets = load();
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) return NextResponse.json({ error: "That message no longer exists." }, { status: 404 });

  // The person who raised it, or someone who handles the desk. A colleague
  // must not be able to attach anything to a salary complaint.
  const canManage = hasPermission(user.role, "support.manage");
  if (ticket.raisedBy !== user.id && !canManage) {
    return NextResponse.json({ error: "That message isn't yours." }, { status: 403 });
  }

  // A settled ticket is a record. Adding to it later would change what the
  // decision was made on.
  if (!isOpen(ticket.status)) {
    return NextResponse.json(
      { error: "This message is settled. Raise a fresh one and attach it there." },
      { status: 409 }
    );
  }

  const existing = ticket.attachments || [];
  if (existing.length >= MAX_TICKET_ATTACHMENTS) {
    return NextResponse.json(
      { error: `${MAX_TICKET_ATTACHMENTS} attachments is the limit for one message.` },
      { status: 409 }
    );
  }

  const problem = ticketAttachmentAllowed(uploaded.type, uploaded.size);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const dir = path.join(attachmentsDir(), ticket.id);
  ensureDir(dir);

  // Generated name, never the browser's — an uploaded name can carry path
  // separators and walk out of the folder.
  const ext = (uploaded.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const id = crypto.randomUUID();
  const stored = `${id}.${ext || "bin"}`;
  fs.writeFileSync(path.join(dir, stored), bytes);

  const attachment: TicketAttachment = {
    id,
    name: uploaded.name.slice(0, 180),
    size: bytes.length,
    type: uploaded.type,
    file: path.join(ticket.id, stored),
    uploadedAt: new Date().toISOString(),
    uploadedBy: user.id,
    uploadedByName: user.name,
  };

  ticket.attachments = [...existing, attachment];
  ticket.updatedAt = attachment.uploadedAt;
  save(tickets);

  return NextResponse.json({ attachment }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const ticketId = req.nextUrl.searchParams.get("ticketId") || "";
  const attachmentId = req.nextUrl.searchParams.get("id") || "";

  const ticket = load().find((t) => t.id === ticketId);
  if (!ticket) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const canManage = hasPermission(user.role, "support.manage");
  if (ticket.raisedBy !== user.id && !canManage) {
    return NextResponse.json({ error: "That message isn't yours." }, { status: 403 });
  }

  const attachment = (ticket.attachments || []).find((a) => a.id === attachmentId);
  if (!attachment) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const full = resolveAttachment(attachment.file);
  if (!full) return NextResponse.json({ error: "That file is missing from the store." }, { status: 404 });

  const bytes = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.type || "application/octet-stream",
      // inline, so a screenshot opens in the browser instead of landing in
      // Downloads — the person looking at it wants to see it, not keep it.
      "Content-Disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
