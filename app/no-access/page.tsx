"use client";

import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";
import { useSession } from "@/lib/session";
import { ROLES } from "@/lib/permissions";

/**
 * Where the middleware sends someone who opened a page their role cannot
 * see. It says who they are signed in as, because the usual cause is the
 * wrong account rather than a missing permission.
 */
export default function NoAccessPage() {
  const { user } = useSession();
  const roleLabel = ROLES.find((r) => r.id === user?.role)?.label || user?.role;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-[430px] rounded-3xl border border-biome-line bg-biome-bgSoft p-7 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-500">
          <ShieldAlert size={22} />
        </span>
        <h1 className="mt-4 text-[17px] font-semibold tracking-[-.02em] text-biome-text">
          This section isn&apos;t open to your role
        </h1>
        <p className="mt-2 text-[11.5px] leading-relaxed text-biome-muted">
          {user
            ? `You're signed in as ${user.name} (${roleLabel}). If you need this section, ask an admin to change your role.`
            : "Sign in to continue."}
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-biome-line px-4 py-2.5 text-[11.5px] font-semibold text-biome-text transition hover:bg-biome-bg"
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
