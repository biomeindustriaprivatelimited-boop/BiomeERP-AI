/**
 * Biome Platform — Tally test company and the figures it MUST produce
 * -------------------------------------------------------------------
 * Used by tools/tally-mock.mjs (to answer like Tally) and
 * tools/tally-check.mjs (to assert the app's numbers).
 *
 * Amounts below are written the way an accountant reads a ledger:
 * `dr: +5 * L` is ₹5,00,000 Dr, `dr: -5 * L` is ₹5,00,000 Cr. The mock
 * converts them to Tally's XML sign (Dr NEGATIVE, Cr POSITIVE).
 *
 * Dates are relative so the check passes on any day:
 *   PREV  = a date in the PREVIOUS financial year (must NOT count in P&L)
 *   cur(n)= n days after 1 April of the current FY, but never after today
 *   FUTURE= 20 days after today (post-dated voucher; must NOT count)
 *
 * ===================== EXPECTED (company A) =====================
 * Period: FY <current> till today. All figures in rupees.
 *
 * Cash in hand      4,35,000.00   Cash 4,00,000 Dr + Rewari Plant Imprest 35,000 Dr
 *                                 (imprest sits in sub-group "Plant Petty Cash")
 * Bank balance     39,80,000.00   HDFC 40,00,000 Dr + ICICI 20,000 Cr (overdrawn)
 * Bank OD / CC     60,00,000.00   SBI Cash Credit (Bank OD A/c) — NOT in bank balance
 * Receivables    1,00,50,000.00   NET: NTPC Mouda 85,00,000 Dr + NTPC Solapur
 *                                 12,50,000 Dr + APCPL 5,00,000 Dr − JPL advance
 *                                 2,00,000 Cr.  Gross 1,02,50,000; advances 2,00,000
 *                                 Debtor ledgers with a balance: 4 (NPL is nil)
 * Payables         17,15,000.50   NET: Mukesh Nandha 12,50,000 Cr + Sonpal 3,25,000.50
 *                                 Cr + Shree Ram Transport 2,40,000 Cr − Anish
 *                                 advance 1,00,000 Dr. Gross 18,15,000.50.
 *                                 Creditor ledgers with a balance: 4.
 *                                 ("Electricity Payable" is under a group merely
 *                                 NAMED "Sundry Creditors for Expenses" in Current
 *                                 Liabilities — not a creditor.)
 * Sales            85,00,000.00   Local 75,00,000 + Interstate 12,00,000 (sub-groups
 *                                 of Sales Accounts) − Sales Return 2,00,000.
 *                                 Last year's 2,00,00,000 and the post-dated
 *                                 10,00,000 are excluded.
 * Purchases        58,00,000.00   50,00,000 + 8,00,000 (sub-group "Purchase -
 *                                 Interstate"); last year's 2,10,00,000 excluded.
 * Duties & Taxes    5,28,000.00   CGST 4,50,000 + SGST 4,50,000 + IGST 2,16,000 +
 *                                 TDS 12,000 − Input IGST 6,00,000 (net payable)
 * Expenses         10,05,000.00   Freight 6,00,000 + Salary 4,00,000 + Bank Charges 5,000
 * Sales − Purch.   27,00,000.00
 *
 * Company B ("Biome Pellets & Biomass (Old Books)", static XML):
 *   cash 1,000; receivables 9,99,999 (group renamed "Trade Receivables",
 *   RESERVEDNAME Sundry Debtors); purchases 30,00,00,000 (₹30 Cr); sales null ("—").
 */

export const COMPANY_A = "Biome Industria Private Limited";
export const COMPANY_B = "Biome Pellets & Biomass (Old Books)";

export const L = 100000;

export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function fyStart(today) {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${y}-04-01`;
}

export function fyLabel(today) {
  const y = Number(fyStart(today).slice(0, 4));
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function buildCompanyA(today) {
  const F = fyStart(today);
  const fy = Number(F.slice(0, 4));
  const PREV = `${fy - 1}-10-15`;
  const T = isoDate(today);
  const cur = (n) => {
    const d = new Date(`${F}T00:00:00`);
    d.setDate(d.getDate() + n);
    const s = isoDate(d);
    return s > T ? T : s;
  };
  const f = new Date(today);
  f.setDate(f.getDate() + 20);
  const FUTURE = isoDate(f);

  const groups = [
    // Tally's predefined groups (RESERVEDNAME = own name)
    ...[
      ["Capital Account", null],
      ["Current Assets", null],
      ["Current Liabilities", null],
      ["Loans (Liability)", null],
      ["Fixed Assets", null],
      ["Sales Accounts", null],
      ["Purchase Accounts", null],
      ["Direct Expenses", null],
      ["Indirect Expenses", null],
      ["Direct Incomes", null],
      ["Indirect Incomes", null],
      ["Bank Accounts", "Current Assets"],
      ["Cash-in-Hand", "Current Assets"],
      ["Sundry Debtors", "Current Assets"],
      ["Deposits (Asset)", "Current Assets"],
      ["Sundry Creditors", "Current Liabilities"],
      ["Duties & Taxes", "Current Liabilities"],
      ["Provisions", "Current Liabilities"],
      ["Bank OD A/c", "Loans (Liability)"],
      ["Secured Loans", "Loans (Liability)"],
    ].map(([name, parent]) => ({ name, parent, reserved: name })),
    // The company's own sub-groups
    { name: "Plant Petty Cash", parent: "Cash-in-Hand" },
    { name: "Debtors - NTPC", parent: "Sundry Debtors" },
    { name: "NTPC Plants", parent: "Debtors - NTPC" },
    { name: "Creditors - Biomass Vendors", parent: "Sundry Creditors" },
    { name: "Transporters", parent: "Sundry Creditors" },
    { name: "Sundry Creditors for Expenses", parent: "Current Liabilities" },
    { name: "GST Payable", parent: "Duties & Taxes" },
    { name: "Sales - Local", parent: "Sales Accounts" },
    { name: "Sales - Interstate", parent: "Sales Accounts" },
    { name: "Purchase - Interstate", parent: "Purchase Accounts" },
  ];

  const bs = (name, parent, opening, txns) => ({ name, parent, opening, txns, pl: false });
  const pl = (name, parent, txns) => ({ name, parent, opening: 0, txns, pl: true });

  const ledgers = [
    { name: "Profit & Loss A/c", parent: null, reserved: "Profit & Loss A/c", opening: 0, txns: [], pl: false },
    bs("Share Capital", "Capital Account", -100 * L, []),

    // Cash
    bs("Cash", "Cash-in-Hand", 2 * L, [{ date: PREV, dr: 0.5 * L }, { date: cur(20), dr: 1.5 * L }]),
    bs("Rewari Plant Imprest", "Plant Petty Cash", 0, [{ date: cur(25), dr: 0.35 * L }, { date: FUTURE, dr: 0.1 * L }]),

    // Bank
    bs("HDFC Bank CA 50200012345", "Bank Accounts", 10 * L, [
      { date: PREV, dr: 5 * L },
      { date: cur(30), dr: 25 * L },
      { date: FUTURE, dr: -3 * L },
    ]),
    bs("ICICI Bank CA", "Bank Accounts", 0, [{ date: cur(35), dr: -0.2 * L }]),
    bs("SBI Cash Credit A/c", "Bank OD A/c", -50 * L, [{ date: cur(40), dr: -10 * L }]),

    // Debtors
    bs("NTPC Mouda", "NTPC Plants", 30 * L, [{ date: PREV, dr: 10 * L }, { date: cur(10), dr: 45 * L }]),
    bs("NTPC Solapur", "Debtors - NTPC", 0, [{ date: cur(40), dr: 12.5 * L }]),
    bs("Jhajjar Power Limited", "Sundry Debtors", 8 * L, [{ date: cur(40), dr: -10 * L }]),
    bs("Nabha Power Limited", "Sundry Debtors", 0, []),
    bs("APCPL", "Sundry Debtors", 0, [{ date: cur(45), dr: 5 * L }, { date: FUTURE, dr: 7 * L }]),

    // Creditors
    bs("Mukesh Nandha", "Creditors - Biomass Vendors", -5 * L, [{ date: cur(10), dr: -7.5 * L }]),
    bs("Sonpal Krishan Ramchandpura", "Creditors - Biomass Vendors", 0, [{ date: cur(15), dr: -325000.5 }]),
    bs("Anish Prithrawas", "Creditors - Biomass Vendors", 0, [{ date: cur(15), dr: 1 * L }]),
    bs("Shree Ram Transport & Co.", "Transporters", 0, [{ date: cur(20), dr: -2.4 * L }]),
    bs("Old Vendor (settled)", "Sundry Creditors", -0.5 * L, [{ date: PREV, dr: 0.5 * L }]),
    bs("Electricity Payable", "Sundry Creditors for Expenses", 0, [{ date: cur(30), dr: -0.5 * L }]),

    // Duties & Taxes
    bs("Output CGST", "GST Payable", 0, [{ date: cur(10), dr: -4.5 * L }]),
    bs("Output SGST", "GST Payable", 0, [{ date: cur(10), dr: -4.5 * L }]),
    bs("Output IGST", "Duties & Taxes", 0, [{ date: cur(40), dr: -2.16 * L }]),
    bs("Input IGST", "Duties & Taxes", 0, [{ date: cur(10), dr: 6 * L }]),
    bs("TDS Payable 194C", "Duties & Taxes", 0, [{ date: cur(20), dr: -0.12 * L }]),

    // Sales (P&L)
    pl("Sales - Biomass Pellets (Local)", "Sales - Local", [
      { date: PREV, dr: -120 * L },
      { date: cur(10), dr: -75 * L },
      { date: FUTURE, dr: -10 * L },
    ]),
    pl("Sales - Biomass Pellets (Interstate)", "Sales - Interstate", [
      { date: PREV, dr: -80 * L },
      { date: cur(40), dr: -12 * L },
    ]),
    pl("Sales Return", "Sales Accounts", [{ date: cur(50), dr: 2 * L }]),

    // Purchases (P&L)
    pl("Purchase - Biomass", "Purchase Accounts", [
      { date: PREV, dr: 210 * L },
      { date: cur(10), dr: 50 * L },
      { date: FUTURE, dr: 5 * L },
    ]),
    pl("Purchase - Biomass (Interstate)", "Purchase - Interstate", [{ date: cur(12), dr: 8 * L }]),

    // Expenses / income
    pl("Freight Inward", "Direct Expenses", [{ date: cur(10), dr: 6 * L }]),
    pl("Salary", "Indirect Expenses", [{ date: PREV, dr: 30 * L }, { date: cur(30), dr: 4 * L }]),
    pl("Bank Charges", "Indirect Expenses", [{ date: cur(30), dr: 5000 }]),
    pl("Interest Received", "Indirect Incomes", [{ date: cur(30), dr: -15000 }]),
  ];

  // A few vouchers for the bridge's BiomeVouchers report. "Tax Invoice" is
  // a sales voucher type whose name does not contain "sale".
  const vouchers = [
    {
      date: cur(10), type: "Tax Invoice", no: "BI-26-27-HR0554", party: "NTPC Mouda",
      entries: [
        { ledger: "NTPC Mouda", dr: 59 * L },
        { ledger: "Sales - Biomass Pellets (Local)", dr: -50 * L },
        { ledger: "Output CGST", dr: -4.5 * L },
        { ledger: "Output SGST", dr: -4.5 * L },
      ],
    },
    {
      date: cur(40), type: "Sales", no: "BI-26-27-HR0600", party: "NTPC Solapur",
      entries: [
        { ledger: "NTPC Solapur", dr: 14.16 * L },
        { ledger: "Sales - Biomass Pellets (Interstate)", dr: -12 * L },
        { ledger: "Output IGST", dr: -2.16 * L },
      ],
    },
    {
      date: cur(10), type: "Purchase", no: "P-101", party: "Mukesh Nandha",
      entries: [
        { ledger: "Mukesh Nandha", dr: -8.4 * L },
        { ledger: "Purchase - Biomass", dr: 8 * L },
        { ledger: "Input IGST", dr: 0.4 * L },
      ],
    },
    {
      date: cur(40), type: "Receipt", no: "R-12", party: "Jhajjar Power Limited",
      entries: [
        { ledger: "Jhajjar Power Limited", dr: -10 * L },
        { ledger: "HDFC Bank CA 50200012345", dr: 10 * L },
      ],
    },
    {
      date: FUTURE, type: "Tax Invoice", no: "BI-26-27-HR0999", party: "APCPL",
      entries: [
        { ledger: "APCPL", dr: 7 * L },
        { ledger: "Sales - Biomass Pellets (Local)", dr: -7 * L },
      ],
    },
  ];

  return { booksFrom: `${fy - 1}-04-01`, groups, ledgers, vouchers, dates: { F, PREV, FUTURE, T, cur } };
}

/** Hand-computed expectations (see the table at the top of this file). */
export const EXPECTED_A = {
  cashInHand: 435000,
  bankBalance: 3980000,
  bankOverdraft: 6000000,
  liquidTotal: 4415000,
  receivables: 10050000,
  receivablesGross: 10250000,
  advancesFromCustomers: 200000,
  payables: 1715000.5,
  payablesGross: 1815000.5,
  advancesToVendors: 100000,
  sales: 8500000,
  purchases: 5800000,
  taxLiability: 528000,
  expenses: 1005000,
  otherIncome: 15000,
  grossMargin: 2700000,
};

export const EXPECTED_A_COUNTS = { debtors: 4, creditors: 4, customerAdvances: 1, vendorAdvances: 1 };

export const EXPECTED_B = {
  cashInHand: 1000,
  receivables: 999999,
  purchases: 300000000,
  sales: null,
};

/** Month-by-month from the bridge vouchers (sales/purchases = amounts on
 *  Sales/Purchase ledgers, excluding GST; the post-dated one is out). */
export function expectedMonthly(today) {
  const { cur } = buildCompanyA(today).dates;
  const m = new Map();
  const add = (date, k, v) => {
    const key = date.slice(0, 7);
    const row = m.get(key) || { sales: 0, purchases: 0, receipts: 0 };
    row[k] += v;
    m.set(key, row);
  };
  add(cur(10), "sales", 50 * L);
  add(cur(40), "sales", 12 * L);
  add(cur(10), "purchases", 8 * L);
  add(cur(40), "receipts", 10 * L);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v }));
}
