import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { getSession, findById } from "@/lib/authServer";
import { hasPermission } from "@/lib/permissions";
import {
  loadEntries, saveEntries, personForUser, isEditable, event,
  storeAttachment, attachmentAllowed, attachmentPath,
} from "@/lib/imprest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireEntryAccess(req: NextRequest, entryId: string) {
  const session = await getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  const user = findById(session.uid);
  if (!user || !user.active) {
    return { error: NextResponse.json({ error: "This account is no longer active." }, { status: 401 }) };
  }

  const entries = loadEntries();
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return { error: NextResponse.json({ error: "Entry not found." }, { status: 404 }) };

  const canApprove = hasPermission(user.role, "imprest.approve");
  const mine = personForUser(user.id);
  const isOwn = Boolean(mine && entry.personId === mine.id);
  if (!isOwn && !canApprove) {
    return { error: NextResponse.json({ error: "That entry isn't yours." }, { status: 403 }) };
  }

  return { user, entry, entries, isOwn, canApprove };
}

/** Attach a bill photo or PDF to an entry that hasn't been decided. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the file as form data." }, { status: 400 });

  const entryId = String(form.get("entryId") || "");
  const file = form.get("file");
  if (!entryId || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  }

  const access = await requireEntryAccess(req, entryId);
  if ("error" in access) return access.error;
  const { user, entry, entries } = access;

  if (!isEditable(entry)) {
    return NextResponse.json({ error: "This entry has been decided — its bills are fixed." }, { status: 409 });
  }
  if (entry.attachments.length >= 8) {
    return NextResponse.json({ error: "Eight attachments is the limit for one entry." }, { status: 409 });
  }

  const problem = attachmentAllowed(file.type, file.size);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const attachment = await storeAttachment(entry.id, file.name, file.type, bytes);

  const updated = {
    ...entry,
    attachments: [...entry.attachments, attachment],
    updatedAt: new Date().toISOString(),
    history: [...entry.history, event(user.id, user.name, "attached", attachment.name)],
  };
  saveEntries(entries.map((e) => (e.id === entry.id ? updated : e)));

  return NextResponse.json({ attachment, entry: updated }, { status: 201 });
}

/** Stream a stored bill back for viewing. */
export async function GET(req: NextRequest) {
  const entryId = req.nextUrl.searchParams.get("entryId") || "";
  const attachmentId = req.nextUrl.searchParams.get("attachmentId") || "";

  const access = await requireEntryAccess(req, entryId);
  if ("error" in access) return access.error;
  const { entry } = access;

  const attachment = entry.attachments.find((a) => a.id === attachmentId);
  if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });

  const full = attachmentPath(attachment.file);
  if (!full) return NextResponse.json({ error: "That file is missing from disk." }, { status: 404 });

  const data = fs.readFileSync(full);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.type || "application/octet-stream",
      // inline so a bill opens in the viewer rather than downloading
      "Content-Disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** Remove an attachment from an undecided entry. */
export async function DELETE(req: NextRequest) {
  const entryId = req.nextUrl.searchParams.get("entryId") || "";
  const attachmentId = req.nextUrl.searchParams.get("attachmentId") || "";

  const access = await requireEntryAccess(req, entryId);
  if ("error" in access) return access.error;
  const { user, entry, entries } = access;

  if (!isEditable(entry)) {
    return NextResponse.json({ error: "This entry has been decided — its bills are fixed." }, { status: 409 });
  }

  const attachment = entry.attachments.find((a) => a.id === attachmentId);
  if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });

  // The record loses the reference; the file itself stays on disk. Deleting
  // evidence on a click is not something an accounts trail should allow.
  const updated = {
    ...entry,
    attachments: entry.attachments.filter((a) => a.id !== attachmentId),
    updatedAt: new Date().toISOString(),
    history: [...entry.history, event(user.id, user.name, "removed attachment", attachment.name)],
  };
  saveEntries(entries.map((e) => (e.id === entry.id ? updated : e)));

  return NextResponse.json({ entry: updated });
}
