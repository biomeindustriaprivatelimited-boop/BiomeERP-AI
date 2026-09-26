"use client";

import { Building2 } from "lucide-react";
import ClientRequirements from "@/components/clients/ClientRequirements";

/**
 * The client master.
 *
 * The editor for this has existed since the SOP work, but it was never
 * mounted on a page — which is why there appeared to be no way to add a
 * client. It was reachable from nowhere. This is that missing page.
 */
export default function ClientsPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-.03em] text-biome-text">
          <Building2 size={19} className="text-biome-leaf" /> Clients
        </h1>
        <p className="mt-1 text-[11.5px] text-biome-muted">
          The power plants you supply, and the papers each of them insists on. Adding a client here
          is what makes the document checks work for their supplies.
        </p>
      </header>

      <ClientRequirements />
    </div>
  );
}
