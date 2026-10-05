import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { ensureDir } from "@/lib/dataRoot";
import {
  ticketAttachmentAllowed, attachmentExt, ATTACHMENT_KINDS,
  MAX_TICKET_ATTACHMENTS, MAX_FILES_PER_MESSAGE, TicketAttachment, isOpen,
} from "@/lib/support";
import {
  loadTickets, saveTickets, attachmentsDir, resolveAttachment, canSeeTicket,
} from "@/lib/supportStore";

/**
 * Files on a Help & Support case — photos, PDFs, Excel and Word.
 *
 * WHO: anyone who holds "support" may attach to their OWN case (the first
 * message, or one of their follow-up messages), whatever their role — a
 * role created next year gets it with no change here. The desk (admin and
 * developer, "support.manage") may attach to any case. Reading a file is
 * the same rule: the case's owner, the admin and the developer. Nobody
 * else, not even a colleague at the same plant.
 *
 * WHAT: checked by extension AND by the file's first bytes (a renamed .exe
 * is refused), at most 15 MB a file, 10 files a message, 40 a case. Stored
 * under <data root>/support/attachments/<case id>/ with a generated name.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Does the content look like what the extension claims? */
function contentMatches(ext: string, bytes: Buffer): boolean {
  const head = bytes.subarray(0, 16);
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  const ascii = (s: string, at = 0) => head.subarray(at, at + s.length).toString("latin1") === s;
  switch (ext) {
    case "pdf": return ascii("%PDF");
    case "png": return starts(0x89, 0x50, 0x4e, 0x47);
    case "jpg": case "jpeg": return starts(0xff, 0xd8, 0xff);
    case "gif": return ascii("GIF8");
    case "webp": return ascii("RIFF") && ascii("WEBP", 8);
    case "heic": return ascii("ftyp", 4);
    // Office 2007+ files are zip archives; the old formats are OLE files.
    case "xlsx": case "docx": return starts(0x50, 0x4b, 0x03, 0x04);
    case "xls": case "doc": return starts(0xd0, 0xcf, 0x11, 0xe0);
    case "csv": {
      // Plain text: no NUL bytes in the first few KB.
      const sample = bytes.subarray(0, 4096);
      return !sample.includes(0);
    }
    default: return false;
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const ticketId = String(form.get("ticketId") || "");
  const replyId = String(form.get("replyId") || "").trim();
  const uploaded = form.get("file");
  if (!ticketId || !(uploaded instanceof File)) {
    return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  }

  const tickets = loadTickets();
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket || !canSeeTicket(user, ticket)) {
    return NextResponse.json({ error: "That case was not found." }, { status: 404 });
  }

  // A file goes with a message: the first one (no replyId — only the
  // person who raised the case), or a follow-up the uploader wrote.
  if (replyId) {
    const reply = ticket.replies.find((r) => r.id === replyId);
    if (!reply || reply.by !== user.id) {
      return NextResponse.json({ error: "Attach files to your own message." }, { status: 403 });
    }
  } else {
    if (ticket.raisedBy !== user.id) {
      return NextResponse.json({ error: "Write a message on the case, then attach files to it." }, { status: 403 });
    }
    // A settled case is a record — only files that come with a new
    // message may be added to it.
    if (!isOpen(ticket.status)) {
      return NextResponse.json({ error: "This case is finished. Write a message and attach the file with it." }, { status: 409 });
    }
  }

  const existing = ticket.attachments || [];
  if (existing.length >= MAX_TICKET_ATTACHMENTS) {
    return NextResponse.json({ error: `${MAX_TICKET_ATTACHMENTS} files is the limit for one case.` }, { status: 409 });
  }
  const inThisMessage = existing.filter((a) => (a.replyId || "") === replyId).length;
  if (inThisMessage >= MAX_FILES_PER_MESSAGE) {
    return NextResponse.json({ error: `${MAX_FILES_PER_MESSAGE} files is the limit for one message.` }, { status: 409 });
  }

  const name = String(uploaded.name || "file").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180);
  const problem = ticketAttachmentAllowed(name, uploaded.size);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const ext = attachmentExt(name);
  const bytes = Buffer.from(await uploaded.arrayBuffer());
  if (!contentMatches(ext, bytes)) {
    return NextResponse.json(
      { error: `"${name}" is not really a .${ext} file — it can't be attached. Save it again as ${ext.toUpperCase()} and retry.` },
      { status: 400 }
    );
  }

  const dir = path.join(attachmentsDir(), ticket.id);
  ensureDir(dir);
  // Generated name, never the browser's — an uploaded name can carry path
  // separators and walk out of the folder.
  const id = crypto.randomUUID();
  const stored = `${id}.${ext}`;
  fs.writeFileSync(path.join(dir, stored), bytes);

  const attachment: TicketAttachment = {
    id,
    name,
    size: bytes.length,
    // From our own table, never the browser's claim.
    type: ATTACHMENT_KINDS[ext].type,
    file: path.join(ticket.id, stored),
    uploadedAt: new Date().toISOString(),
    uploadedBy: user.id,
    uploadedByName: user.name,
    ...(replyId ? { replyId } : {}),
  };

  // Re-read before saving so a parallel upload (several files at once) is
  // not lost.
  const fresh = loadTickets();
  const t = fresh.find((x) => x.id === ticket.id);
  if (!t) return NextResponse.json({ error: "That case was not found." }, { status: 404 });
  t.attachments = [...(t.attachments || []), attachment];
  t.updatedAt = attachment.uploadedAt;
  saveTickets(fresh);

  const { file: _file, ...shown } = attachment;
  void _file;
  return NextResponse.json({ attachment: shown }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "support");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;

  const ticketId = req.nextUrl.searchParams.get("ticketId") || "";
  const attachmentId = req.nextUrl.searchParams.get("id") || "";
  const download = req.nextUrl.searchParams.get("download") === "1";

  const ticket = loadTickets().find((t) => t.id === ticketId);
  // Same answer whether the case is missing or simply not yours.
  if (!ticket || !canSeeTicket(user, ticket)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const attachment = (ticket.attachments || []).find((a) => a.id === attachmentId);
  if (!attachment) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const full = resolveAttachment(attachment.file);
  if (!full) return NextResponse.json({ error: "That file is missing from the store." }, { status: 404 });

  const kind = ATTACHMENT_KINDS[attachmentExt(attachment.name)] || null;
  const type = kind?.type || "application/octet-stream";
  // Photos and PDFs open in the app; Excel / Word download.
  const inline = !download && (kind?.kind === "image" || kind?.kind === "pdf");
  const safeName = attachment.name.replace(/["\r\n]/g, "");
  const bytes = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
