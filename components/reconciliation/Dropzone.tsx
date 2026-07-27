"use client";

import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { UploadCloud, FileSpreadsheet, X } from "lucide-react";

export default function Dropzone({
  label,
  hint,
  fileName,
  rowCount,
  onFile,
  onClear,
  accentClass = "text-biome-leafBright",
}: {
  label: string;
  hint: string;
  fileName: string | null;
  rowCount: number | null;
  onFile: (file: File) => void;
  onClear: () => void;
  accentClass?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files[0]) return;
      onFile(files[0]);
    },
    [onFile]
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
      onClick={() => !fileName && inputRef.current?.click()}
      className={`relative flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        dragOver
          ? "border-biome-leafBright bg-biome-leaf/10"
          : "border-biome-line bg-white/[0.02] hover:bg-white/[0.04]"
      } ${!fileName ? "cursor-pointer" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {!fileName ? (
        <>
          <motion.div
            animate={dragOver ? { y: -4 } : { y: 0 }}
            className={`rounded-xl bg-white/5 p-3 ${accentClass}`}
          >
            <UploadCloud size={26} />
          </motion.div>
          <p className="font-display text-sm font-medium text-biome-text">{label}</p>
          <p className="text-xs text-biome-muted">{hint}</p>
          <span className="mt-1 text-[11px] text-biome-muted/70">
            Drop a file here, or click to browse — CSV, XLSX, XLS, PDF
          </span>
        </>
      ) : (
        <>
          <div className={`rounded-xl bg-white/5 p-3 ${accentClass}`}>
            <FileSpreadsheet size={26} />
          </div>
          <p className="max-w-[220px] truncate font-display text-sm font-medium text-biome-text">
            {fileName}
          </p>
          <p className="text-xs text-biome-muted">
            {rowCount !== null ? `${rowCount} rows detected` : "Parsing…"}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-biome-line px-3 py-1 text-[11px] text-biome-muted transition-colors hover:text-biome-text"
          >
            <X size={12} /> Remove
          </button>
        </>
      )}
    </div>
  );
}
