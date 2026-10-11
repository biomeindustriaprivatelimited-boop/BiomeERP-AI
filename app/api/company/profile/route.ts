import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, requirePermission } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { recordAudit } from "@/lib/audit";
import {
  PROFILE_CATEGORIES, loadSections, hiddenDefaults, upsertSection, removeSection, restoreDefault,
  loadDirectors, updateDirector,
} from "@/lib/companyProfile";

/**
 * Company Profile — READ for every signed-in person (it is how a new
 * employee learns the business), WRITE only with "company.edit"
 * (admin and developer by role; anyone else only if granted).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  const user = session ? findById(session.uid) : undefined;
  if (!user || !user.active) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const canEdit = effectivePermissions(user.role, user.access).includes("company.edit");
  return NextResponse.json({
    categories: PROFILE_CATEGORIES,
    sections: loadSections(),
    hidden: canEdit ? hiddenDefaults() : [],
    directors: loadDirectors().map(({ photoFile, ...d }) => d),
    canEdit,
  });
}

/**
 * Body:
 *   { section: { id?, category, title, body, order? } }  add / edit
 *   { remove: id }                                         delete custom / hide default
 *   { restore: id }                                        back to the shipped default
 *   { director: { id, name?, role?, linkedin? } }          edit a director's details
 */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "company.edit");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    let detail = "";
    if (body.section) {
      const s = upsertSection(body.section, user.name);
      detail = `Section saved: ${s.title}`;
    } else if (body.remove) {
      removeSection(String(body.remove), user.name);
      detail = `Section removed: ${body.remove}`;
    } else if (body.restore) {
      restoreDefault(String(body.restore));
      detail = `Section restored to default: ${body.restore}`;
    } else if (body.director?.id) {
      const d = body.director;
      const patch: any = {};
      if (d.name !== undefined) patch.name = String(d.name).trim().slice(0, 120);
      if (d.role !== undefined) patch.role = String(d.role).trim().slice(0, 120);
      if (d.linkedin !== undefined) patch.linkedin = String(d.linkedin).trim().slice(0, 300);
      updateDirector(String(d.id), patch);
      detail = `Director details changed: ${d.id}`;
    } else {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }
    recordAudit({
      action: "COMPANY_PROFILE_CHANGED",
      userId: user.id, userName: user.name, role: user.role,
      targetType: "company", targetId: "profile", targetLabel: "Company Profile", detail,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, sections: loadSections(), hidden: hiddenDefaults(), directors: loadDirectors().map(({ photoFile, ...d }) => d) });
}
