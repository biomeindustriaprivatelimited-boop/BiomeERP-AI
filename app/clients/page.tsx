import { redirect } from "next/navigation";

/**
 * The old client master. Clients now have ONE registration page — every
 * field from here (document requirements, DSC, short name, aliases, POs)
 * lives on Client registration.
 */
export default function ClientsRedirect() {
  redirect("/partners/clients");
}
