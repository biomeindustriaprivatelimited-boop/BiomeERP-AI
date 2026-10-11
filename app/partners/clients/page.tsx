"use client";

import RegistrationRegister from "@/components/partners/RegistrationRegister";

/**
 * Client registration — the ONE client register. It holds what used to be
 * split between "Registration → Client" and the separate client master at
 * /clients (document requirements, DSC, aliases, POs).
 */
export default function ClientRegistrationPage() {
  return <RegistrationRegister mode="clients" />;
}
