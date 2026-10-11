/**
 * Biome Industria's own letterhead details, for printed statements.
 *
 * Tally's company master is asked first (address, state, GSTIN — see
 * lib/tallyLedgerActivity.ts buildCompanyProfileRequest); these are the
 * fallbacks when Tally doesn't give them. Registered office = Unit 1
 * (Haryana), which is the state the GSTIN belongs to (code 06).
 */
export const BIOME_COMPANY = {
  name: "Biome Industria Private Limited",
  address: ["Rewari Road Khaleta, Mayan Village", "Rewari District, Haryana — 123103"],
  state: "Haryana",
  stateCode: "06",
  gstin: "06AAJCB1927H1ZS",
  pan: "AAJCB1927H",
  logo: "/icons/icon-192.png",
};

export interface LetterheadInfo {
  name: string;
  address: string[];
  state: string;
  gstin: string;
  pan: string;
}

/** Tally's company master where it has a value, the app's otherwise. */
export function letterheadFrom(tally?: Partial<{ address: string[]; state: string | null; pincode: string | null; gstin: string | null; pan: string | null }> | null): LetterheadInfo {
  const addr = (tally?.address || []).filter(Boolean);
  const pin = tally?.pincode ? ` — ${tally.pincode}` : "";
  return {
    name: BIOME_COMPANY.name,
    address: addr.length ? [...addr.slice(0, -1), `${addr[addr.length - 1]}${pin}`] : BIOME_COMPANY.address,
    state: tally?.state || BIOME_COMPANY.state,
    gstin: tally?.gstin || BIOME_COMPANY.gstin,
    pan: tally?.pan || BIOME_COMPANY.pan,
  };
}
