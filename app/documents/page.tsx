"use client";

import { FileText } from "lucide-react";
import ComingSoonPage from "@/components/ComingSoonPage";

export default function DocumentsPage() {
  return (
    <ComingSoonPage
      title="Documents"
      description="A central library pulling together everything scanned via OCR, received on WhatsApp, and uploaded elsewhere — searchable in one place."
      icon={FileText}
      plannedFeatures={[
        "Unified view across OCR Scanner and WhatsApp uploads",
        "Full-text search across every document's recognized content",
        "Folder view by month, client, or document type",
        "Bulk export to Excel/PDF",
      ]}
    />
  );
}
