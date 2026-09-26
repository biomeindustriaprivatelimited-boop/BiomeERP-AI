import { NextRequest, NextResponse } from "next/server";
import { loadDrive, saveDrive, exchangeCode, driveRedirectUri, whoAmI } from "@/lib/gdrive";
import { encrypt } from "@/lib/mailer";

/**
 * Where Google sends the browser back after consent.
 *
 * Unauthenticated by necessity — the redirect arrives in a plain
 * browser tab with no app session. It is safe the same way any OAuth
 * loopback is: the code is worthless without the Client Secret, which
 * never leaves this machine, and connecting Drive only ever points
 * backups at the account that just consented.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, body: string): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
     <body style="font-family:Segoe UI,Arial,sans-serif;background:#0d100b;color:#f0f4ed;display:grid;place-items:center;height:100vh;margin:0">
     <div style="max-width:420px;text-align:center;border:1px solid #2c3626;border-radius:16px;padding:36px;background:#161c12">
     <div style="font-size:34px">${title.startsWith("Connected") ? "✅" : "⚠️"}</div>
     <h2 style="margin:12px 0 6px">${title}</h2>
     <p style="color:#9ca696;font-size:14px;line-height:1.6">${body}</p></div>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const err = req.nextUrl.searchParams.get("error");
  if (err) return page("Not connected", `Google said: ${err}. Close this tab and try again from Settings.`);
  if (!code) return page("Not connected", "No code came back from Google. Close this tab and try again.");

  try {
    const redirect = driveRedirectUri(req.nextUrl.origin);
    const { refreshToken, accessToken } = await exchangeCode(code, redirect);
    if (!refreshToken) {
      return page("Almost", "Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions, then connect again.");
    }
    const email = await whoAmI(accessToken).catch(() => "");
    const cfg = loadDrive();
    saveDrive({
      ...cfg,
      refreshTokenEnc: encrypt(refreshToken),
      accountEmail: email,
      connectedAt: new Date().toISOString(),
    });
    return page("Connected to Google Drive", `Backups will be saved to <b>${email || "your Google Drive"}</b> in the "Biome Platform Backups" folder. You can close this tab and return to the app.`);
  } catch (e) {
    return page("Not connected", (e as Error).message);
  }
}
