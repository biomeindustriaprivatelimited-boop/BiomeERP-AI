import Link from "next/link";
import { WifiOff, RefreshCw } from "lucide-react";

/** Shown by the service worker when a navigation fails with no signal. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b1d04] px-8 text-center text-white" data-force-dark="1">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[#9fe870]/12 text-[#9fe870]">
        <WifiOff size={28} />
      </span>
      <h1 className="text-[22px] font-semibold tracking-[-.03em]">No signal right now</h1>
      <p className="max-w-sm text-[12.5px] leading-relaxed text-white/65">
        Biome needs the network to read or file anything — showing you a stale float or an old
        attendance sheet would be worse than showing nothing. The moment you have a bar, this works
        again.
      </p>
      <Link
        href="/m"
        className="mt-2 flex items-center gap-2 rounded-2xl bg-[#9fe870] px-5 py-3 text-[12px] font-bold text-[#163300]"
      >
        <RefreshCw size={14} /> Try again
      </Link>
    </main>
  );
}
