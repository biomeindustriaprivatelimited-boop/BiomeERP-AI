/**
 * Biome Platform — master data
 * -------------------------------------------------------------------
 * The vendor codes, clients and plants as supplied by the company.
 * Written once into config/ on first run, then owned by the user — the
 * app never overwrites their edits.
 *
 * Three codes collided in the source list: Shri Ganpati Enterprises,
 * SOHI Green Energy and Sss Green Energy were all given "SGE". The
 * business chose to keep the shared code exactly as issued: all three
 * carry SGE, the app highlights them in a "shared code" group, refuses
 * any NEW vendor with a duplicate code, and when a reference says SGE
 * the vendor is picked from the document's own text (see agent.js) and
 * flagged for the user to correct.
 */

const SEED_VENDORS = [
  { code: "ADR", name: "Aadhar Enterprises", aliases: ["aadhar", "aadhar enterprises"] },
  { code: "BRI", name: "Balaji Rice Industries Private Limited", aliases: ["balaji rice", "balaji rice industries private limited"] },
  { code: "BTE", name: "Bio Trend Energy (Opc) Private Limited", aliases: ["bio trend energy", "bio trend energy opc private limited"] },
  { code: "DAV", name: "Devyani Agro Vision", aliases: ["devyani agro vision"] },
  { code: "DIV", name: "Divyanshi Enterprises", aliases: ["divyanshi", "divyanshi enterprises"] },
  { code: "EAR", name: "Earth Renewables", aliases: ["earth renewables"] },
  { code: "EEI", name: "ENVIRO ENABLERS INDIA PRIVATE LIMITED", aliases: ["enviro enablers india", "enviro enablers india private limited"] },
  { code: "FUS", name: "FUELS SOLUTIONS", aliases: ["fuels solutions"] },
  { code: "GDA", name: "G D AGRO BIOMASS ENERGY", aliases: ["g d agro biomass energy"] },
  { code: "GOP", name: "Gopal Enterprises", aliases: ["gopal", "gopal enterprises"] },
  { code: "GGE", name: "GOWARA GREEN ENERGY SOLUTIONS", aliases: ["gowara green energy solutions"] },
  { code: "GRF", name: "Green Roots Fuel", aliases: ["green roots fuel"] },
  { code: "GSH", name: "GS Agro Fuels- Haryana", aliases: ["gs agro fuels haryana"] },
  { code: "GSP", name: "GS Agro Fuels- Punjab", aliases: ["gs agro fuels punjab"] },
  { code: "GAC", name: "Gurudeo Agro Company", aliases: ["gurudeo agro", "gurudeo agro company"] },
  { code: "HUS", name: "Hari Urrja Solutions", aliases: ["hari urrja solutions"] },
  { code: "IBS", name: "INNOVATIVE BIOMASS SOLUTIONS - APCPL", aliases: ["innovative biomass solutions apcpl"] },
  { code: "JDE", name: "JAI DURGA ENTERPRISES", aliases: ["jai durga", "jai durga enterprises"] },
  { code: "JDT", name: "Jai DurgaTraders", aliases: ["jai durgatraders"] },
  { code: "JSR", name: "Jai Shree Ram Trading Company", aliases: ["jai shree ram trading", "jai shree ram trading company"] },
  { code: "JI", name: "Jain Industries", aliases: ["jain", "jain industries"] },
  { code: "KBI", name: "Karan Biofuel Industries", aliases: ["karan biofuel", "karan biofuel industries"] },
  { code: "MBPL", name: "MAAKARNI BIOFUEL PVT. LTD.", aliases: ["maakarni biofuel", "maakarni biofuel pvt ltd"] },
  { code: "MRE", name: "MAHADEV RENEWABLE ENERGY", aliases: ["mahadev renewable energy"] },
  { code: "MBF", name: "Mungiya Bio Fuels", aliases: ["mungiya bio fuels"] },
  { code: "MWI", name: "Murli Wala Industries", aliases: ["murli wala", "murli wala industries"] },
  { code: "NSBF", name: "N.S. Bio Fuel", aliases: ["n s bio fuel"] },
  { code: "NAFI", name: "NIRVAAN AGRO FUEL INDUSTRIES", aliases: ["nirvaan agro fuel", "nirvaan agro fuel industries"] },
  { code: "QBLLP", name: "Quality Bioenergy Limited Liability Partnership", aliases: ["quality bioenergy liability partnership", "quality bioenergy limited liability partnership"] },
  { code: "RAP", name: "Radhe Agro Products-Solapur Vendor", aliases: ["radhe agro products solapur vendor"] },
  { code: "RAA", name: "Rao Agro Fuels", aliases: ["rao agro fuels"] },
  { code: "SPI", name: "S.P. Industries", aliases: ["s p industries"] },
  { code: "SBF", name: "Sandhu Bio Fuels_Tanda_Purchase", aliases: ["sandhu bio fuels tanda purchase"] },
  { code: "SFB", name: "Sandhu Fuel Briquette-Purchase", aliases: ["sandhu fuel briquette purchase"] },
  { code: "SRN", name: "Sanron", aliases: ["sanron"] },
  { code: "SBFI", name: "Shiv Bio Fuel Industries", aliases: ["shiv bio fuel", "shiv bio fuel industries"] },
  { code: "SBPL", name: "Shiva Biofuels Private Limited- NPL Vendor", aliases: ["shiva biofuels npl vendor", "shiva biofuels private limited npl vendor"] },
  { code: "SBI", name: "Shree Balaji Industries", aliases: ["shree balaji", "shree balaji industries"] },
  { code: "SGG", name: "SHREE GANPATI GREEN ENERGY SOLUTIONS LLP", aliases: ["shree ganpati green energy solutions", "shree ganpati green energy solutions llp"] },
  { code: "SGE", name: "Shri Ganpati Enterprises", aliases: ["shri ganpati", "shri ganpati enterprises"] },
  { code: "SBEL", name: "SHUBHSHREE BIOFUELS ENERGY LIMITED", aliases: ["shubhshree biofuels energy", "shubhshree biofuels energy limited"] },
  { code: "SAI", name: "Soami Agro Industries", aliases: ["soami agro", "soami agro industries"] },
  { code: "SGE", name: "SOHI GREEN ENERGY", aliases: ["sohi green energy", "sohi"] },
  { code: "SEFF", name: "Sps Eco Friendly Fuels", aliases: ["sps eco friendly fuels"] },
  { code: "SGE", name: "Sss Green Energy", aliases: ["sss green energy", "sss green"] },
  { code: "SB", name: "Sunbeam Biofuels", aliases: ["sunbeam biofuels"] },
  { code: "TBS", name: "Terra Biofuel Solutions", aliases: ["terra biofuel solutions"] },
  { code: "TKE", name: "TERRANOVA KL ENERGIES", aliases: ["terranova kl energies"] },
  { code: "WIPL", name: "Walbha Industries Pvt. Ltd", aliases: ["walbha", "walbha industries pvt ltd"] },
  { code: "YBL", name: "Yadav Biofuels", aliases: ["yadav biofuels"] },
  { code: "MHI", name: "M.H. Industries", aliases: ["m h industries"] },
  { code: "AA", name: "Asian Associates", aliases: ["asian associates"] },
  { code: "AT", name: "Arihant Traders", aliases: ["arihant traders"] },
];

/**
 * Our own plants. In a manufacturing supply the plant code takes the
 * vendor's place in the reference: BDC/810/REW/810.
 */
const SEED_PLANTS = [
  {
    code: "REW",
    name: "Rewari Plant",
    aliases: ["rewari", "rew", "khaleta"],
    weightAdjustmentKg: 0,
  },
  {
    code: "GKD",
    name: "Gangakhed Plant",
    aliases: ["gangakhed", "gkd"],
    // Documents for this plant are raised 400-500 kg above the weighbridge
    // figure, so quantity matching must allow for it or every Gangakhed
    // supply looks like a mismatch.
    weightAdjustmentKg: 500,
  },
];

const SEED_CLIENT_NAMES = [
  { name: "Aadhar Enterprises", aliases: ["aadhar", "aadhar enterprises"] },
  { name: "ARAVALI POWER COMPANY PVT LTD", aliases: ["aravali power", "aravali power company pvt ltd"] },
  { name: "Devyani Agro Vision_Sale", aliases: ["devyani agro vision sale"] },
  { name: "DK AGRO INDUSTRIES", aliases: ["dk agro", "dk agro industries"] },
  { name: "Enertatva Energies Private Limited", aliases: ["enertatva energies", "enertatva energies private limited"] },
  { name: "ENVIRO ENABLERS INDIA PRIVATE LIMITED", aliases: ["enviro enablers india", "enviro enablers india private limited"] },
  { name: "HTPS, KASIMPUR", aliases: ["htps kasimpur"] },
  { name: "Jhajjar Power Limited", aliases: ["jhajjar power", "jhajjar power limited"] },
  { name: "Kanha Traders", aliases: ["kanha traders"] },
  { name: "Libra Trading Company", aliases: ["libra trading", "libra trading company"] },
  { name: "LUPIN LIMITED", aliases: ["lupin", "lupin limited"] },
  { name: "MH CONTAINERS PRIVATE LIMITED", aliases: ["mh containers", "mh containers private limited"] },
  { name: "NABHA POWER LIMITED", aliases: ["nabha power", "nabha power limited"] },
  { name: "NTPC LIMITED ( Mouda )", aliases: ["ntpc limited mouda", "ntpc mouda"] },
  { name: "NTPC LIMITED VINDHYANCHAL", aliases: ["ntpc limited vindhyanchal", "ntpc vindhyanchal"] },
  { name: "NTPC LTD ( Khargone )", aliases: ["ntpc khargone", "ntpc ltd khargone"] },
  { name: "NTPC LTD ( SOLAPUR )", aliases: ["ntpc ltd solapur", "ntpc solapur"] },
  { name: "NTPC TANDA", aliases: ["ntpc tanda"] },
  { name: "PUNJAB RENEWABLE ENERGY SYSTEMS PRIVATE LIMITED", aliases: ["punjab renewable energy systems", "punjab renewable energy systems private limited"] },
  { name: "Radhe Agro Products-Solapur Vendor", aliases: ["radhe agro products solapur vendor"] },
  { name: "RS TRADERS", aliases: ["rs traders"] },
  { name: "Sandhu Fuel Briquette_Jharli SALES", aliases: ["sandhu fuel briquette jharli sales"] },
  { name: "SHIV SHAKTI ENTERPRISES", aliases: ["shiv shakti", "shiv shakti enterprises"] },
  { name: "Shree Shyaam Electrosystem Private Limited", aliases: ["shree shyaam electrosystem", "shree shyaam electrosystem private limited"] },
  { name: "Somani Biofuels Pvt Ltd", aliases: ["somani biofuels", "somani biofuels pvt ltd"] },
  { name: "Tarun Fluo Chem Pvt. Ltd.", aliases: ["tarun fluo chem", "tarun fluo chem pvt ltd"] },
  { name: "Walbha Industries Pvt. Ltd", aliases: ["walbha", "walbha industries pvt ltd"] },
];

module.exports = { SEED_VENDORS, SEED_PLANTS, SEED_CLIENT_NAMES };