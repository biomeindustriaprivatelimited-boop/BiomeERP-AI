"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { UploadCloud, ImageIcon, FileText } from "lucide-react";

export default function MultiDropzone({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files.length) return;
      onFiles(Array.from(files));
    },
    [onFiles]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        dragOver
          ? "border-biome-leafBright bg-biome-leaf/10"
          : "border-biome-line bg-biome-hover hover:bg-biome-hover"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.pdf"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <motion.div
        animate={dragOver ? { y: -4 } : { y: 0 }}
        className="rounded-xl bg-biome-hover p-3 text-biome-leafBright"
      >
        <UploadCloud size={26} />
      </motion.div>
      <p className="font-display text-sm font-medium text-biome-text">
        Drop any document or photo — invoices, IDs, certificates, forms, or ledger scans
      </p>
      <p className="flex items-center gap-3 text-xs text-biome-muted">
        <span className="flex items-center gap-1">
          <ImageIcon size={12} /> Images
        </span>
        <span className="flex items-center gap-1">
          <FileText size={12} /> PDF
        </span>
      </p>
      <span className="mt-1 text-[11px] text-biome-muted/70">
        Multiple files at once — each is processed and queued automatically
      </span>
    </div>
  );
}
