/**
 * The owner's master lists (from his Word file, Oct 2026), as data.
 *
 * Used ONLY by the one-time "Import vendor code list" / "Import client
 * list" actions in Vendor / Client registration — nothing reads these at
 * runtime as a source of truth; once imported, Registration is the
 * register and these lists are just what was handed over.
 *
 * NOTE: "SGE" is given to THREE vendors (Shri Ganpati Enterprises, SOHI
 * GREEN ENERGY, Sss Green Energy). They are imported as given and the
 * clash is shown prominently for the owner to fix — never silently renamed.
 */

export const OWNER_VENDOR_CODES: { name: string; code: string }[] = [
  { name: "Aadhar Enterprises", code: "ADR" },
  { name: "Balaji Rice Industries Private Limited", code: "BRI" },
  { name: "Bio Trend Energy (Opc) Private Limited", code: "BTE" },
  { name: "Devyani Agro Vision", code: "DAV" },
  { name: "Divyanshi Enterprises", code: "DIV" },
  { name: "Earth Renewables", code: "EAR" },
  { name: "ENVIRO ENABLERS INDIA PRIVATE LIMITED", code: "EEI" },
  { name: "FUELS SOLUTIONS", code: "FUS" },
  { name: "G D AGRO BIOMASS ENERGY", code: "GDA" },
  { name: "Gopal Enterprises", code: "GOP" },
  { name: "GOWARA GREEN ENERGY SOLUTIONS", code: "GGE" },
  { name: "Green Roots Fuel", code: "GRF" },
  { name: "GS Agro Fuels- Haryana", code: "GSH" },
  { name: "GS Agro Fuels- Punjab", code: "GSP" },
  { name: "Gurudeo Agro Company", code: "GAC" },
  { name: "Hari Urrja Solutions", code: "HUS" },
  { name: "INNOVATIVE BIOMASS SOLUTIONS - APCPL", code: "IBS" },
  { name: "JAI DURGA ENTERPRISES", code: "JDE" },
  { name: "Jai DurgaTraders", code: "JDT" },
  { name: "Jai Shree Ram Trading Company", code: "JSR" },
  { name: "Jain Industries", code: "JI" },
  { name: "Karan Biofuel Industries", code: "KBI" },
  { name: "MAAKARNI BIOFUEL PVT. LTD.", code: "MBPL" },
  { name: "MAHADEV RENEWABLE ENERGY", code: "MRE" },
  { name: "Mungiya Bio Fuels", code: "MBF" },
  { name: "Murli Wala Industries", code: "MWI" },
  { name: "N.S. Bio Fuel", code: "NSBF" },
  { name: "NIRVAAN AGRO FUEL INDUSTRIES", code: "NAFI" },
  { name: "Quality Bioenergy Limited Liability Partnership", code: "QBLLP" },
  { name: "Radhe Agro Products-Solapur Vendor", code: "RAP" },
  { name: "Rao Agro Fuels", code: "RAA" },
  { name: "S.P. Industries", code: "SPI" },
  { name: "Sandhu Bio Fuels_Tanda_Purchase", code: "SBF" },
  { name: "Sandhu Fuel Briquette-Purchase", code: "SFB" },
  { name: "Sanron", code: "SRN" },
  { name: "Shiv Bio Fuel Industries", code: "SBFI" },
  { name: "Shiva Biofuels Private Limited- NPL Vendor", code: "SBPL" },
  { name: "Shree Balaji Industries", code: "SBI" },
  { name: "SHREE GANPATI GREEN ENERGY SOLUTIONS LLP", code: "SGG" },
  { name: "Shri Ganpati Enterprises", code: "SGE" },
  { name: "SHUBHSHREE BIOFUELS ENERGY LIMITED", code: "SBEL" },
  { name: "Soami Agro Industries", code: "SAI" },
  { name: "SOHI GREEN ENERGY", code: "SGE" },
  { name: "Sps Eco Friendly Fuels", code: "SEFF" },
  { name: "Sss Green Energy", code: "SGE" },
  { name: "Sunbeam Biofuels", code: "SB" },
  { name: "Terra Biofuel Solutions", code: "TBS" },
  { name: "TERRANOVA KL ENERGIES", code: "TKE" },
  { name: "Walbha Industries Pvt. Ltd", code: "WIPL" },
  { name: "Yadav Biofuels", code: "YBL" },
  { name: "M.H. Industries", code: "MHI" },
  { name: "Asian Associates", code: "AA" },
  { name: "Arihant Traders", code: "AT" },
];

/** The trading register's clients, as the owner listed them. */
export const OWNER_CLIENTS: string[] = [
  "Aadhar Enterprises",
  "ARAVALI POWER COMPANY PVT LTD (APCPL)",
  "Devyani Agro Vision_Sale",
  "DK AGRO INDUSTRIES",
  "Enertatva Energies Private Limited",
  "ENVIRO ENABLERS INDIA PRIVATE LIMITED",
  "HTPS, KASIMPUR",
  "Jhajjar Power Limited",
  "Kanha Traders",
  "Libra Trading Company",
  "LUPIN LIMITED",
  "MH CONTAINERS PRIVATE LIMITED",
  "NABHA POWER LIMITED",
  "NTPC LIMITED ( Mouda )",
  "NTPC LIMITED VINDHYANCHAL",
  "NTPC LTD ( Khargone )",
  "NTPC LTD ( SOLAPUR )",
  "NTPC TANDA",
  "PUNJAB RENEWABLE ENERGY SYSTEMS PRIVATE LIMITED",
  "Radhe Agro Products-Solapur Vendor",
  "RS TRADERS",
  "Sandhu Fuel Briquette_Jharli SALES",
  "SHIV SHAKTI ENTERPRISES",
  "Shree Shyaam Electrosystem Private Limited",
  "Somani Biofuels Pvt Ltd",
  "Tarun Fluo Chem Pvt. Ltd.",
  "Walbha Industries Pvt. Ltd",
];
