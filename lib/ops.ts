/**
 * Biome AI OS — Issues · Meetings · Forms (server only)
 * -------------------------------------------------------------------
 * Three roadmap sections that share one storage pattern, kept together
 * so they stay consistent:
 *
 *   29 · Issue & Incident Management — priority, owner, evidence,
 *        timeline, status, resolution; similar past issues by keywords.
 *   12 · Meeting Assistant — a transcript (recorded in the browser or
 *        pasted) becomes summary + decisions + action items → tasks.
 *   13 · Smart Form Builder — forms with typed fields, submissions, and
 *        an optional task on every submission.
 *
 * All three feed the Work Engine (a new issue or a form submission can
 * raise a task) and the Communication Center (their events show on a
 * party's timeline).
 */

import path from "path";
import crypto from "crypto";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";

function store<T>(name: string, empty: T) {
  const file = () => path.join(paths.root, "work", `${name}.json`);
  return {
    load: (): T => readJson<T>(file(), empty),
    save: (v: T) => { ensureDir(path.dirname(file())); writeJsonAtomic(file(), v); },
  };
}

/* ------------------------------------------------------------------ */
/* 29 · Issues                                                          */
/* ------------------------------------------------------------------ */

export type IssueKind = "operational" | "financial" | "vendor" | "technical" | "site_incident" | "damaged_material" | "vehicle";
export type IssueStatus = "open" | "investigating" | "resolved" | "closed";
export type IssuePriority = "critical" | "high" | "medium" | "low";

export interface IssueEvent { at: string; by: string; note: string }
export interface IssueEvidence { id: string; name: string; file: string; mimeType: string; ocrText?: string }

export interface Issue {
  id: string;
  kind: IssueKind;
  title: string;
  description: string;
  priority: IssuePriority;
  status: IssueStatus;
  ownerId: string | null;
  ownerName: string | null;
  party: string;              // vendor / client / vehicle it concerns
  plant: string | null;
  evidence: IssueEvidence[];
  timeline: IssueEvent[];
  resolution: string;
  raisedBy: string;
  raisedByName: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  taskId: string | null;
}

const issues = store<{ issues: Issue[] }>("issues", { issues: [] });
export const loadIssues = () => issues.load().issues;
export const saveIssues = (list: Issue[]) => issues.save({ issues: list });

export const ISSUE_KINDS: { id: IssueKind; label: string; actions: string[] }[] = [
  { id: "damaged_material", label: "Damaged material", actions: ["Create complaint to vendor", "Attach photo evidence", "Create investigation task", "Hold payment until resolved"] },
  { id: "vehicle", label: "Vehicle issue", actions: ["Create maintenance request", "Notify transporter", "Create incident report", "Reassign the trip"] },
  { id: "operational", label: "Operational issue", actions: ["Create investigation task", "Notify plant manager", "Log on the coordination trip"] },
  { id: "financial", label: "Financial issue", actions: ["Send for accounts review", "Create finance task", "Flag in Decisions"] },
  { id: "vendor", label: "Vendor issue", actions: ["Send vendor notice", "Update vendor performance", "Create follow-up task"] },
  { id: "technical", label: "Technical problem", actions: ["Create support ticket", "Notify developer"] },
  { id: "site_incident", label: "Site incident", actions: ["Create incident report", "Notify plant manager and admin", "Attach evidence"] },
];

export function blankIssue(by: { id: string; name: string }, kind: IssueKind): Issue {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), kind, title: "", description: "", priority: "medium", status: "open",
    ownerId: null, ownerName: null, party: "", plant: null, evidence: [], timeline: [{ at: now, by: by.name, note: "Issue raised" }],
    resolution: "", raisedBy: by.id, raisedByName: by.name, createdAt: now, updatedAt: now, resolvedAt: null, taskId: null,
  };
}

/** Similar past issues — keyword overlap on title/description/party. */
export function similarIssues(issue: Pick<Issue, "title" | "description" | "party" | "kind">, all = loadIssues()): { issue: Issue; score: number }[] {
  const words = new Set(`${issue.title} ${issue.description} ${issue.party}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return all
    .filter((i) => i.status === "resolved" || i.status === "closed")
    .map((i) => {
      const w2 = `${i.title} ${i.description} ${i.party}`.toLowerCase().split(/[^a-z0-9]+/);
      const hits = w2.filter((w) => words.has(w)).length;
      return { issue: i, score: hits + (i.kind === issue.kind ? 2 : 0) + (i.party && i.party === issue.party ? 3 : 0) };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* 12 · Meetings                                                        */
/* ------------------------------------------------------------------ */

export interface ActionItem { id: string; owner: string; task: string; deadline: string | null; taskId: string | null }
export interface Meeting {
  id: string;
  title: string;
  heldOn: string;
  attendees: string[];
  transcript: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  createdBy: string;
  createdAt: string;
}

const meetings = store<{ meetings: Meeting[] }>("meetings", { meetings: [] });
export const loadMeetings = () => meetings.load().meetings;
export const saveMeetings = (list: Meeting[]) => meetings.save({ meetings: list });

/**
 * Deterministic extraction — the floor every meeting gets even with no
 * model loaded. Decisions are lines that decide; action items are lines
 * where someone is to do something, with a deadline if one is named.
 */
export function extractFromTranscript(text: string): { summary: string; decisions: string[]; actionItems: Omit<ActionItem, "id" | "taskId">[] } {
  const lines = text.split(/\n+|(?<=[.!?])\s+/).map((l) => l.trim()).filter((l) => l.length > 8);
  const decisions = lines.filter((l) => /\b(decided|agreed|final|will be|must|should|confirm(ed)?|approved|tay hua|decision)\b/i.test(l)).slice(0, 8);
  const actionRe = /^(?:action[:\-\s]*)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)?|Accounts|Manager|Coordinator|Plant|Admin)\s*(?:[-–:]|to|will|should|has to|needs to|ko)\s+(.+)$/;
  const dateRe = /(?:\b(?:by|before|till|until|on)\s+)?\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/i;
  const actionItems: Omit<ActionItem, "id" | "taskId">[] = [];
  for (const l of lines) {
    // A decision line is not an action item, even when it names someone.
    if (/^(decided|decision|agreed)\b/i.test(l)) continue;
    const m = l.match(actionRe);
    if (!m) continue;
    const dl = l.match(dateRe);
    actionItems.push({ owner: m[1], task: m[2].replace(/\.$/, ""), deadline: dl ? resolveDeadline(dl[1]) : null });
  }
  const summary = lines.slice(0, 3).join(" ").slice(0, 400) || text.slice(0, 400);
  return { summary, decisions, actionItems: actionItems.slice(0, 12) };
}

function resolveDeadline(word: string): string | null {
  const w = word.toLowerCase();
  const now = new Date();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (w === "today") return now.toISOString().slice(0, 10);
  if (w === "tomorrow") return new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const di = days.indexOf(w);
  if (di >= 0) { const diff = (di - now.getDay() + 7) % 7 || 7; return new Date(now.getTime() + diff * 86400000).toISOString().slice(0, 10); }
  const dm = w.match(/(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
  if (dm) { const y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : now.getFullYear(); return `${y}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`; }
  const parsed = Date.parse(`${word} ${now.getFullYear()}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/* ------------------------------------------------------------------ */
/* 13 · Forms                                                           */
/* ------------------------------------------------------------------ */

export type FieldType = "text" | "number" | "dropdown" | "date" | "photo" | "file" | "signature" | "location" | "checkbox";
export interface FormField { id: string; label: string; type: FieldType; required: boolean; options?: string[] }
export interface FormDef {
  id: string; name: string; description: string; fields: FormField[];
  /** Raise a Work task on every submission, owned by this role. */
  taskOnSubmit: string | null;
  active: boolean; createdBy: string; createdAt: string;
}
export interface FormSubmission {
  id: string; formId: string; values: Record<string, any>; files: { fieldId: string; name: string; file: string }[];
  submittedBy: string; submittedByName: string; submittedAt: string; plant: string | null; taskId: string | null;
}

const forms = store<{ forms: FormDef[]; submissions: FormSubmission[] }>("forms", { forms: [], submissions: [] });
export const loadForms = () => forms.load();
export const saveForms = (v: { forms: FormDef[]; submissions: FormSubmission[] }) => forms.save(v);

export const FORM_TEMPLATES: { name: string; description: string; fields: Omit<FormField, "id">[] }[] = [
  { name: "Site Inspection", description: "Daily site walk", fields: [
    { label: "Area inspected", type: "text", required: true }, { label: "Date", type: "date", required: true },
    { label: "Condition", type: "dropdown", required: true, options: ["Good", "Needs attention", "Unsafe"] },
    { label: "Photo", type: "photo", required: false }, { label: "Location", type: "location", required: false },
    { label: "Inspector signature", type: "signature", required: true } ] },
  { name: "Vendor Evaluation", description: "Quarterly vendor review", fields: [
    { label: "Vendor", type: "text", required: true }, { label: "Quality (1-5)", type: "number", required: true },
    { label: "Timeliness (1-5)", type: "number", required: true }, { label: "Documents complete", type: "checkbox", required: false },
    { label: "Remarks", type: "text", required: false } ] },
  { name: "Complaint Form", description: "Client or vendor complaint", fields: [
    { label: "Against", type: "text", required: true }, { label: "Category", type: "dropdown", required: true, options: ["Quality", "Weight", "Delay", "Documents", "Behaviour"] },
    { label: "Details", type: "text", required: true }, { label: "Evidence", type: "file", required: false } ] },
  { name: "Vehicle Inspection", description: "Before dispatch", fields: [
    { label: "Vehicle number", type: "text", required: true }, { label: "Tyres OK", type: "checkbox", required: false },
    { label: "Tarpaulin OK", type: "checkbox", required: false }, { label: "Weight slip attached", type: "checkbox", required: false },
    { label: "Photo", type: "photo", required: false }, { label: "Driver signature", type: "signature", required: true } ] },
  { name: "Expense Request", description: "Pre-approval for a spend", fields: [
    { label: "Purpose", type: "text", required: true }, { label: "Amount", type: "number", required: true },
    { label: "Needed by", type: "date", required: true }, { label: "Quotation", type: "file", required: false } ] },
];
