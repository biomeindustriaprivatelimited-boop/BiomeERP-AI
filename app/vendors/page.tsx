import { redirect } from "next/navigation";
/** Vendors are registered in ONE place now — Registration — with KYC and the plant/trading role rules. */
export default function VendorsRedirect() { redirect("/partners"); }
