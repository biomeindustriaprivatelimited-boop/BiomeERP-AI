import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/authToken";
import { canAccessPath, isPublicPath, hasPermission, landingPathFor } from "@/lib/permissions";

/**
 * One gate in front of everything.
 *
 * Hiding a sidebar link is a courtesy, not a control — a plant manager
 * who types /ledgers, or whose app is asked to fetch /api/tally/full,
 * has to be refused by the server. That refusal happens here, before any
 * route handler runs, so a new page is protected the moment its path is
 * added to ROUTE_PERMISSIONS rather than whenever someone remembers to
 * add a check inside it.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) return harden(NextResponse.next(), pathname);

  const bearer = req.headers.get("authorization") || "";
  const token = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : req.cookies.get(SESSION_COOKIE)?.value;

  const session = await verifySession(token);
  const isApi = pathname.startsWith("/api/");

  if (!session) {
    if (isApi) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // "/" is the Finance Command Center. Roles without finance access are
  // sent to a home they can use rather than to a page of 403s.
  const sessionCan = (p: string) =>
    session.perms && session.perms.length ? session.perms.includes(p) : hasPermission(session.role, p as any);

  if (pathname === "/" && !sessionCan("finance")) {
    const url = req.nextUrl.clone();
    url.pathname = landingPathFor(session.role);
    return NextResponse.redirect(url);
  }

  if (!canAccessPath(session.role, pathname, session.perms)) {
    /**
     * A hidden feature answers 404, not 403.
     *
     * 403 confirms the page exists and merely refuses it, which tells
     * someone exactly what to go looking for. 404 says nothing is there.
     * For every role except admin the module is, as far as the app will
     * ever admit, not part of this installation.
     */
    if (isApi) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/not-found-page";
    url.search = "";
    return new NextResponse(NOT_FOUND_HTML, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return harden(NextResponse.next(), pathname);
}

/**
 * DATA STAYS ON THE SERVER.
 *
 * Every business record lives only on the server PC. A phone or a client
 * PC must never keep a copy — not even in the browser's disk cache, where
 * anyone with the device could dig it out later. So every API answer and
 * every page is marked `no-store, private`: the browser (and Electron's
 * Chromium) shows it and forgets it. Static build files are untouched and
 * stay cacheable, they contain no data.
 */
function harden(res: NextResponse, pathname: string): NextResponse {
  if (!pathname.startsWith("/_next/static") && !/\.(js|css|png|jpg|svg|ico|woff2?|wasm|mjs|traineddata)$/i.test(pathname)) {
    res.headers.set("Cache-Control", "no-store, private, max-age=0");
    res.headers.set("Pragma", "no-cache");
  }
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
}

/** Plain 404 body. Deliberately says nothing about roles or permissions. */
const NOT_FOUND_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Not found</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1418;color:#8aa0a8}
div{text-align:center}h1{font-size:46px;margin:0 0 6px;color:#cfe3e8;letter-spacing:-.04em}
p{font-size:13px;margin:0 0 22px}a{color:#4ade80;text-decoration:none;font-size:13px}
</style></head><body><div><h1>404</h1><p>This page doesn't exist.</p>
<a href="/">Back to the app</a></div></body></html>`;

export const config = {
  // Static assets and the Next internals are excluded here as well as in
  // PUBLIC_PREFIXES; running the matcher over every image is pure cost.
  matcher: ["/((?!_next/static|_next/image|assets|favicon.ico).*)"],
};
