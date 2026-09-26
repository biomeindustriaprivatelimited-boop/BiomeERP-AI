import os from "os";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";

/**
 * Where this server can be reached on the local network.
 *
 * Exists for one screen: the "Open on your phone" QR. The desktop app runs
 * on the server PC as http://localhost, and a QR of "localhost" would send
 * the phone to itself. So the server reports its own LAN addresses and the
 * QR is built from the first real one.
 *
 * Signed-in users only — the address list is harmless on a home network
 * and useful to an intruder on a hostile one, so it follows the session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "imprest.view");
  if ("response" in auth) return auth.response;

  const port = Number(process.env.PORT || 4173);
  const addresses: string[] = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // IPv4, not loopback, not a link-local autoconfig address.
      if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.")) {
        addresses.push(net.address);
      }
    }
  }

  return NextResponse.json({
    port,
    urls: addresses.map((a) => `http://${a}:${port}`),
  });
}
