const path = require("path");
const pkg = require("./package.json");

/**
 * Works on Next 14 and Next 16 alike.
 *
 * The project has been run on both — 14 was pinned, but an install in a
 * nested folder picked up 16 — so the config sets whichever key the
 * installed version understands rather than assuming one.
 *
 * @type {import('next').NextConfig}
 */

// The document reader lives in whatsapp-agent/ as plain CommonJS and is
// loaded at runtime with require(). Bundling it would rewrite those
// paths and break them, so it stays external to the server build.
const EXTERNAL = ["tesseract.js", "pdfjs-dist", "exceljs"];

/** Which spelling this Next understands. It moved out of `experimental`
 *  in Next 15 and warns loudly if the old key is used. */
function nextMajor() {
  try {
    return Number(require("next/package.json").version.split(".")[0]) || 14;
  } catch {
    return 14;
  }
}

const major = nextMajor();

const nextConfig = {
  // Development only: lets several test builds run side by side
  // (NEXT_DIST_DIR=.next-a npx next build). Releases always use ".next".
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Lets the update banner compare the published version against this build.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  ...(major >= 15
    ? { serverExternalPackages: EXTERNAL }
    : {
        experimental: {
          serverComponentsExternalPackages: EXTERNAL,
          // instrumentation.ts starts the automatic backup timer. Stable
          // (no flag needed) from Next 15.
          instrumentationHook: true,
        },
      }),

  // Turbopack walks up looking for a lockfile and can land on
  // C:\Users\<name>, which would pull the entire home directory into the
  // build. Pinning the root stops that — but only Next 15+ knows the
  // key at all, and 14 rejects the whole config over an unknown one.
  ...(major >= 15 ? { turbopack: { root: __dirname } } : {}),

  images: {
    remotePatterns: [{ protocol: "https", hostname: "biomeindustria.com" }],
  },
};

module.exports = nextConfig;
