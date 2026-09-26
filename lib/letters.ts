/**
 * Biome Platform — letter templates (server only)
 * -------------------------------------------------------------------
 * Ready-made wording for the letters the business sends: appointment,
 * appraisal, warning, termination and the rest. Two things matter here:
 *
 *   1. **A template is a starting point, never the letter.** Whatever is
 *      actually sent is stored word for word on the employee record, so a
 *      template edited next year cannot rewrite a letter already handed
 *      over. This file supplies the draft; `employee.letters[]` keeps the
 *      truth.
 *   2. **The tone is the company's, not a form's.** A warning letter that
 *      reads like a legal threat and an appreciation that reads like a
 *      form letter both do damage. These are written to be sent as they
 *      are, then adjusted.
 *
 * Placeholders are substituted from the employee record; anything unknown
 * is left visible as `{{like_this}}` rather than blanked, so nobody sends
 * a letter with a silent hole in it.
 */

export type LetterKind =
  | "appointment" | "joining" | "confirmation" | "appraisal" | "increment"
  | "appreciation" | "warning" | "final_warning" | "penalty"
  | "attendance_warning" | "termination" | "experience" | "relieving" | "salary_certificate";

export interface LetterTemplate {
  id: LetterKind;
  label: string;
  /** Grouping for the picker. */
  group: "Joining" | "Performance" | "Discipline" | "Exit" | "Other";
  subject: string;
  body: string;
  /** Shown above the editor — what this letter is for and when not to use it. */
  guidance: string;
  /** Warned about before sending, because some of these have consequences. */
  sensitive?: boolean;
}

/**
 * Every placeholder a template may use. Kept in one list so the editor can
 * show what is available rather than making people guess.
 */
export const PLACEHOLDERS = [
  "{{employee_name}}", "{{employee_code}}", "{{designation}}", "{{department}}",
  "{{work_location}}", "{{date_of_joining}}", "{{today}}", "{{month}}",
  "{{gross_salary}}", "{{new_salary}}", "{{effective_date}}", "{{notice_period}}",
  "{{incident_date}}", "{{issue}}", "{{expected}}", "{{last_working_day}}",
  "{{company_name}}", "{{issued_by}}",
] as const;

const SIGN_OFF = `
For {{company_name}}


{{issued_by}}
Authorised Signatory`;

export const LETTER_TEMPLATES: LetterTemplate[] = [
  {
    id: "appointment",
    label: "Appointment letter",
    group: "Joining",
    subject: "Appointment as {{designation}} — {{company_name}}",
    guidance: "Issued once terms are agreed and before or on the joining date.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

We are pleased to appoint you as {{designation}} in the {{department}} department at {{work_location}}, with effect from {{date_of_joining}}.

Your gross remuneration will be Rs. {{gross_salary}} per month, subject to statutory deductions including Provident Fund and ESIC where applicable.

You will be governed by the company's rules on attendance, conduct, leave and confidentiality as they stand from time to time. Your appointment is subject to verification of the documents you have submitted.

We look forward to your association with us.
${SIGN_OFF}`,
  },
  {
    id: "joining",
    label: "Joining letter",
    group: "Joining",
    subject: "Joining confirmation — {{employee_name}}",
    guidance: "A short acknowledgement that the person has reported for duty.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

This is to confirm that you have joined {{company_name}} as {{designation}} at {{work_location}} on {{date_of_joining}}.

Please complete any pending documentation with the accounts department at the earliest so that your salary and statutory records can be processed without delay.

Welcome aboard.
${SIGN_OFF}`,
  },
  {
    id: "confirmation",
    label: "Confirmation after probation",
    group: "Joining",
    subject: "Confirmation of employment — {{employee_name}}",
    guidance: "Sent when probation is completed satisfactorily.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

We are pleased to inform you that your services have been confirmed with effect from {{effective_date}}, following the satisfactory completion of your probation.

Your designation remains {{designation}} and your other terms of employment continue unchanged.

We record our appreciation of the work you have put in so far.
${SIGN_OFF}`,
  },
  {
    id: "appraisal",
    label: "Appraisal letter",
    group: "Performance",
    subject: "Annual appraisal — {{employee_name}}",
    guidance: "Use where the review is being communicated with or without a revision.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

Following your annual performance review, we are pleased to inform you that your remuneration has been revised to Rs. {{new_salary}} per month with effect from {{effective_date}}.

This revision reflects your contribution over the past year, particularly your work at {{work_location}}. All other terms of your employment remain unchanged.

We thank you for your efforts and look forward to your continued contribution.
${SIGN_OFF}`,
  },
  {
    id: "increment",
    label: "Increment letter",
    group: "Performance",
    subject: "Revision in remuneration — {{employee_name}}",
    guidance: "A pay revision outside the annual cycle.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

We are pleased to inform you that your monthly remuneration has been revised from Rs. {{gross_salary}} to Rs. {{new_salary}} with effect from {{effective_date}}.

All other terms and conditions of your employment remain unchanged.
${SIGN_OFF}`,
  },
  {
    id: "appreciation",
    label: "Appreciation letter",
    group: "Performance",
    subject: "Thank you — {{employee_name}}",
    guidance:
      "Worth sending more often than most companies do. Name the specific thing that was done well; a general 'good work' letter reads as a formality.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

I want to record our appreciation of your work at {{work_location}} over the past period.

{{issue}}

Work of this kind does not go unnoticed, and it makes a real difference to how smoothly the plant runs. Thank you.

With appreciation,
${SIGN_OFF}`,
  },
  {
    id: "warning",
    label: "Warning letter",
    group: "Discipline",
    sensitive: true,
    subject: "Warning — {{issue}}",
    guidance:
      "A first written warning. State the incident, the date and what is expected, and give the person a chance to respond. Avoid adjectives — the facts carry more weight without them.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}
{{designation}}, {{work_location}}

Subject: Warning — {{issue}}

Dear {{employee_name}},

It has been brought to our notice that on {{incident_date}}, {{issue}}.

This does not meet the standard expected of you in your role. We expect that {{expected}}, with effect immediately.

If there are circumstances we are not aware of, please write to us within three working days so that they can be taken into account.

Please treat this as a written warning. A repetition may invite further action under the company's rules.
${SIGN_OFF}

Acknowledgement of receipt:

Signature: ____________________     Date: ____________`,
  },
  {
    id: "final_warning",
    label: "Final warning letter",
    group: "Discipline",
    sensitive: true,
    subject: "Final warning — {{issue}}",
    guidance:
      "Only after an earlier warning on the same matter. Reference that warning by date — a final warning with no first warning behind it is difficult to stand behind later.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}
{{designation}}, {{work_location}}

Subject: Final warning — {{issue}}

Dear {{employee_name}},

Despite the written warning issued to you earlier, it is noted that on {{incident_date}}, {{issue}}.

You are advised that {{expected}}. This is a final warning.

Any further instance of the same nature will leave us with no option but to proceed under the company's disciplinary rules, which may include termination of your services.

Should you wish to be heard on this, please write to us within three working days.
${SIGN_OFF}

Acknowledgement of receipt:

Signature: ____________________     Date: ____________`,
  },
  {
    id: "attendance_warning",
    label: "Attendance warning",
    group: "Discipline",
    sensitive: true,
    subject: "Attendance — {{employee_name}}",
    guidance: "Sent when attendance has not been marked or leave not applied for, after the reminders have gone unanswered.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Subject: Attendance not recorded

Dear {{employee_name}},

Our records show that your attendance for {{incident_date}} was not marked, and no leave request was received. Reminders were sent to you on the day and the following morning without a response.

Attendance is to be marked in the BIOME app by 2:00 PM each working day. Where you are unable to attend, a leave request is to be raised through the app on the same day.

Please regularise this immediately and ensure it is not repeated. Unmarked days without an approved leave request are treated as absent and are not paid.

If you are facing a difficulty in using the app, raise it under Help & Support and it will be sorted out.
${SIGN_OFF}`,
  },
  {
    id: "penalty",
    label: "Penalty letter",
    group: "Discipline",
    sensitive: true,
    subject: "Recovery towards {{issue}}",
    guidance:
      "A deduction has consequences under the Payment of Wages Act — the amount, the reason and the person's right to be heard must all be on record. Take advice before using this for anything substantial.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Subject: Recovery towards {{issue}}

Dear {{employee_name}},

With reference to the matter of {{incident_date}} concerning {{issue}}, and after considering the explanation on record, a recovery of Rs. {{new_salary}} will be made from your remuneration for {{month}}.

This is being done in accordance with the company's rules and applicable law. If you wish to make any representation against this, please do so in writing within three working days of receiving this letter.
${SIGN_OFF}`,
  },
  {
    id: "termination",
    label: "Termination letter",
    group: "Exit",
    sensitive: true,
    subject: "Termination of employment — {{employee_name}}",
    guidance:
      "The most consequential letter here. Check notice period, dues, and whether the required warnings and hearing are on record before issuing. If in doubt, take legal advice first — this template is a draft, not clearance.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}
{{designation}}, {{work_location}}

Subject: Termination of employment

Dear {{employee_name}},

With reference to the warnings issued to you and the matter of {{incident_date}} concerning {{issue}}, and having considered your response, we regret to inform you that your services with {{company_name}} stand terminated with effect from {{last_working_day}}.

Your dues, including salary for days worked and any statutory entitlements, will be settled in the normal course. You are requested to hand over all company property, records and documents in your possession to your reporting manager on or before your last working day.

We wish you well in your future endeavours.
${SIGN_OFF}`,
  },
  {
    id: "experience",
    label: "Experience letter",
    group: "Exit",
    subject: "Experience certificate — {{employee_name}}",
    guidance: "Issued on request after a person leaves. Keep it factual — dates and designation.",
    body: `Date: {{today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee_name}} (Employee Code {{employee_code}}) was employed with {{company_name}} as {{designation}} in the {{department}} department at {{work_location}} from {{date_of_joining}} to {{last_working_day}}.

During this period, we found {{employee_name}} to be sincere and hardworking in the discharge of the duties assigned.

We wish {{employee_name}} success in future endeavours.
${SIGN_OFF}`,
  },
  {
    id: "relieving",
    label: "Relieving letter",
    group: "Exit",
    subject: "Relieving letter — {{employee_name}}",
    guidance: "Confirms the person has been relieved and dues are settled.",
    body: `Date: {{today}}

To,
{{employee_name}}
Employee Code: {{employee_code}}

Dear {{employee_name}},

This is to confirm that you have been relieved from the services of {{company_name}} at the close of business on {{last_working_day}}.

All company property and records in your possession have been handed over, and your accounts stand settled.

We thank you for your services and wish you the very best.
${SIGN_OFF}`,
  },
  {
    id: "salary_certificate",
    label: "Salary certificate",
    group: "Other",
    subject: "Salary certificate — {{employee_name}}",
    guidance: "Usually asked for by a bank. Confirms designation and current gross.",
    body: `Date: {{today}}

TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee_name}} (Employee Code {{employee_code}}) is employed with {{company_name}} as {{designation}} at {{work_location}} since {{date_of_joining}}.

The current gross remuneration is Rs. {{gross_salary}} per month.

This certificate is issued on request for whatever purpose it may serve.
${SIGN_OFF}`,
  },
];

export function templateById(id: string): LetterTemplate | undefined {
  return LETTER_TEMPLATES.find((t) => t.id === id);
}

/**
 * Fill a template.
 *
 * Unknown placeholders are LEFT IN PLACE deliberately. Blanking them would
 * produce "your remuneration has been revised to Rs.  per month" and
 * somebody would send it.
 */
export function fillTemplate(text: string, values: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const v = values[key];
    if (v === null || v === undefined || v === "") return whole;
    return String(v);
  });
}

/** Which placeholders are still unfilled — shown before anything is sent. */
export function missingPlaceholders(text: string): string[] {
  return Array.from(new Set((text.match(/\{\{(\w+)\}\}/g) || [])));
}
