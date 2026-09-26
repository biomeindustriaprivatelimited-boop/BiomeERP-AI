/**
 * Biome Platform — statutory minimum wages
 * -------------------------------------------------------------------
 * Seeded from the notifications in force when this was written. Read the
 * honesty note before relying on it:
 *
 *   I cannot watch a government website. Nothing in this app polls a state
 *   labour department, and a claim that it does would be worse than useless
 *   — you would stop checking. What the app does instead is know when its
 *   own figures have gone out of date and say so, loudly, on the payroll
 *   screen. Maharashtra is the reason this matters: its rates carry an
 *   explicit expiry, because the special allowance is revised every six
 *   months, so a stale table is detectable rather than merely suspected.
 *
 * Sources seeded:
 *   HARYANA — Labour Department notification 2/25/26-2 Lab dated 9 Apr 2026,
 *   under s.8(3) of the Code on Wages 2019, effective 1 Apr 2026. Four
 *   categories. The notification states the figures are BASIC rates and are
 *   not to be split into allowances, and that the daily rate is the monthly
 *   figure divided by 26 while deductions use 30 days.
 *
 *   MAHARASHTRA — Labour Commissioner notification dated 4 Feb 2026,
 *   effective 1 Jan 2026 to 30 Jun 2026. Wages are Basic + HRA + special
 *   allowance (VDA), the VDA being ₹3,900/month for that period, revised
 *   bi-annually in January and July. Rates are zone-wise; Gangakhed
 *   (Parbhani district) is outside the municipal-corporation zones.
 */

export type SkillCategory = "unskilled" | "semiskilled" | "skilled" | "highlyskilled";

export const SKILL_LABELS: Record<SkillCategory, string> = {
  unskilled: "Unskilled",
  semiskilled: "Semi-skilled",
  skilled: "Skilled",
  highlyskilled: "Highly skilled",
};

export interface WageFloor {
  monthly: number;
  daily: number;
}

export interface StateWages {
  state: string;
  /** Plant codes this table governs. */
  plants: string[];
  notification: string;
  notifiedOn: string;
  effectiveFrom: string;
  /**
   * When the notification itself stops applying. Maharashtra sets one
   * because the VDA is revised every six months; Haryana's stands until
   * superseded, so it is null.
   */
  effectiveTo: string | null;
  /** Roughly how often the state revises, used to age a table with no expiry. */
  revisionCycle: "biannual" | "annual" | "irregular";
  /** Divisor the state prescribes for a day's wage. */
  dayDivisor: number;
  floors: Record<SkillCategory, WageFloor>;
  notes: string[];
  sourceUrl: string;
}

export const WAGE_TABLES: Record<string, StateWages> = {
  HR: {
    state: "Haryana",
    plants: ["REW"],
    notification: "2/25/26-2 Lab dated 9 April 2026",
    notifiedOn: "2026-04-09",
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    revisionCycle: "irregular",
    dayDivisor: 26,
    floors: {
      unskilled: { monthly: 15220.71, daily: 585.41 },
      semiskilled: { monthly: 16780.74, daily: 645.41 },
      skilled: { monthly: 18500.81, daily: 711.56 },
      highlyskilled: { monthly: 19425.85, daily: 747.14 },
    },
    notes: [
      "First Haryana revision made under the Code on Wages, 2019 rather than the Minimum Wages Act, 1948.",
      "The notification says these are basic rates and are not to be broken into allowances. That clause is being challenged, so take advice before restructuring anyone's salary around it.",
      "A day's wage is the monthly figure divided by 26; deductions are worked out on 30 days.",
      "Trainees are paid 75% of their category, never below the unskilled rate, for at most one year.",
      "The principal employer is answerable for contractors paying the minimum too.",
    ],
    sourceUrl: "https://hrylabour.gov.in/",
  },

  MH: {
    state: "Maharashtra",
    plants: ["GKD"],
    notification: "Labour Commissioner notification dated 4 February 2026",
    notifiedOn: "2026-02-04",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-30",
    revisionCycle: "biannual",
    dayDivisor: 26,
    // Basic + special allowance (VDA ₹3,900/month) for the zone Gangakhed
    // falls in. Zone I city rates are higher and do not apply here.
    floors: {
      unskilled: { monthly: 14638, daily: 563 },
      semiskilled: { monthly: 16250, daily: 625 },
      skilled: { monthly: 17940, daily: 690 },
      highlyskilled: { monthly: 19500, daily: 750 },
    },
    notes: [
      "Maharashtra pays Basic + HRA + special allowance (VDA). The VDA was ₹3,900/month for January–June 2026.",
      "The special allowance is revised twice a year, effective 1 January and 1 July, so this table expires by design.",
      "Rates are zone-wise and scheduled-employment-wise. Gangakhed sits outside the municipal-corporation zones — confirm the exact schedule your plant falls under.",
      "An establishment with more than 50 employees pays HRA at 5% of basic + DA on top of the minimum.",
      "Maharashtra also levies professional tax, which Haryana does not.",
    ],
    sourceUrl: "https://mahakamgar.maharashtra.gov.in/",
  },
};

export function tableForPlant(plant: string): StateWages | null {
  const code = String(plant || "").toUpperCase();
  return Object.values(WAGE_TABLES).find((t) => t.plants.includes(code)) ?? null;
}

export type WageTableStatus = "current" | "expiring" | "expired" | "ageing";

export interface WageTableCheck {
  status: WageTableStatus;
  message: string;
  daysOverdue: number;
}

/**
 * Is this table still safe to pay against?
 *
 * `asOf` is a parameter rather than `new Date()` so this can be tested, and
 * so a payroll run for an earlier month is judged against the rules that
 * applied then rather than today's.
 */
export function checkWageTable(table: StateWages, asOf: Date = new Date()): WageTableCheck {
  const today = asOf.toISOString().slice(0, 10);

  if (table.effectiveTo) {
    if (today > table.effectiveTo) {
      const days = Math.floor(
        (asOf.getTime() - new Date(table.effectiveTo + "T00:00:00Z").getTime()) / 86400000
      );
      return {
        status: "expired",
        daysOverdue: days,
        message:
          `The ${table.state} table expired on ${table.effectiveTo} — ${days} day${days === 1 ? "" : "s"} ago. ` +
          (table.revisionCycle === "biannual"
            ? "The state revises the special allowance every January and July, so a newer notification exists. "
            : "") +
          `Check ${table.sourceUrl} and update the rates before running this month.`,
      };
    }
    const daysLeft = Math.floor(
      (new Date(table.effectiveTo + "T00:00:00Z").getTime() - asOf.getTime()) / 86400000
    );
    if (daysLeft <= 30) {
      return {
        status: "expiring",
        daysOverdue: 0,
        message: `The ${table.state} table runs out on ${table.effectiveTo}, in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Watch for the next notification.`,
      };
    }
    return { status: "current", daysOverdue: 0, message: `In force to ${table.effectiveTo}.` };
  }

  // No stated expiry: age it instead. A wage table more than a year old is
  // usually a table someone forgot rather than a state that stood still.
  const ageDays = Math.floor(
    (asOf.getTime() - new Date(table.effectiveFrom + "T00:00:00Z").getTime()) / 86400000
  );
  if (ageDays > 365) {
    return {
      status: "ageing",
      daysOverdue: ageDays - 365,
      message: `The ${table.state} rates have stood since ${table.effectiveFrom}, over a year. Confirm at ${table.sourceUrl} that nothing has superseded them.`,
    };
  }
  return { status: "current", daysOverdue: 0, message: `In force since ${table.effectiveFrom}.` };
}

/** Below the floor? Returns null when it is fine. */
export function checkAgainstFloor(
  plant: string,
  skill: SkillCategory,
  paid: { monthly?: number; daily?: number }
): { shortfall: number; floor: number; basis: "monthly" | "daily"; state: string } | null {
  const table = tableForPlant(plant);
  if (!table) return null;
  const floor = table.floors[skill];
  if (!floor) return null;

  if (paid.daily !== undefined && paid.daily > 0) {
    if (paid.daily + 0.005 < floor.daily) {
      return {
        shortfall: Math.round((floor.daily - paid.daily) * 100) / 100,
        floor: floor.daily,
        basis: "daily",
        state: table.state,
      };
    }
    return null;
  }
  if (paid.monthly !== undefined && paid.monthly > 0) {
    if (paid.monthly + 0.005 < floor.monthly) {
      return {
        shortfall: Math.round((floor.monthly - paid.monthly) * 100) / 100,
        floor: floor.monthly,
        basis: "monthly",
        state: table.state,
      };
    }
    return null;
  }
  return null;
}
