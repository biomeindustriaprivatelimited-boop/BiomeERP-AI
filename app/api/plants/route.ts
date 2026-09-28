import { NextRequest, NextResponse } from "next/server";
import { plantOptions } from "@/lib/plants";

/** Active plants (code + name) for pickers — public (login picker). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ plants: plantOptions().map((p) => ({ code: p.code, label: p.label })) });
}
