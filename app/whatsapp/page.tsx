"use client";

import { MessagesSquare } from "lucide-react";
import ModuleComingSoon from "@/components/ModuleComingSoon";

export default function WhatsappPage() {
  return (
    <ModuleComingSoon
      icon={MessagesSquare}
      title="WhatsApp Documents"
      description="The WhatsApp Business API receiver (whatsapp_webhook.py) already auto-organizes incoming documents into Month → Client → Document folders. This page is the planned viewer for that same folder."
      stepsTitle="Use it right now"
      steps={[
        "Run whatsapp_webhook.py alongside the Streamlit app to keep receiving documents.",
        "Browse what's been received in the Streamlit app's WhatsApp Documents tab.",
        "This page will read from the same WhatsApp_Documents folder once wired up.",
      ]}
    />
  );
}
