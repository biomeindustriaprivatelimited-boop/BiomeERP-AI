"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import CommandPalette from "@/components/CommandPalette";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function Navbar() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="glass sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-biome-line px-5 py-3 md:px-8">
      <div className="flex items-center gap-4">
        <CommandPalette />
        {now && (
          <span className="hidden text-xs text-biome-muted lg:inline">
            {getGreeting()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {now && (
          <span className="hidden font-mono text-xs text-biome-muted sm:inline">
            {now.toLocaleDateString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
            })}{" "}
            · {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        <NotificationBell />
        <div className="flex items-center gap-1.5 rounded-full border border-biome-leaf/30 bg-biome-leaf/10 px-3 py-1.5 text-xs font-medium text-biome-leafBright">
          <Bot size={13} />
          Automation Agent · Offline
        </div>
      </div>
    </header>
  );
}
