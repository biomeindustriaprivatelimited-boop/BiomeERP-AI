"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import Portal from "@/components/Portal";

/**
 * The sidebar, on a phone.
 *
 * Below the md breakpoint the 248px rail would take two thirds of the
 * screen, so it hides and becomes this drawer: the navbar's menu button
 * slides it in, a tap outside or any navigation slides it away.
 */
export default function MobileNavDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    window.addEventListener("biome:toggle-nav", toggle);
    return () => window.removeEventListener("biome:toggle-nav", toggle);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[150] md:hidden">
            <motion.div
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 shadow-[20px_0_60px_-20px_rgb(0_0_0/.6)]"
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
            >
              <Sidebar drawer />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
