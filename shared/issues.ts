import { z } from "zod";
import type { Member } from "./schema.js";
export const issueCategories = {
  helium_refill: "Helium refill",
  instrument_malfunction: "Instrument malfunction",
  consumables_maintenance: "Consumables / maintenance",
  proposal_writing: "Proposal-writing needs",
  purchase_approval: "Purchase approval",
  measurement_assistance: "Measurement assistance",
  general_decision: "General decisions",
} as const;
export const issuePriorities = ["low", "normal", "high", "urgent"] as const;
export const issueStatuses = [
  "open",
  "acknowledged",
  "in_progress",
  "blocked",
  "resolved",
] as const;
export type IssueStatus = (typeof issueStatuses)[number];
export const issueStatusLabels: Record<IssueStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
};
export const issueTransitions: Record<IssueStatus, IssueStatus[]> = {
  open: ["acknowledged"],
  acknowledged: ["in_progress", "blocked", "resolved"],
  in_progress: ["blocked", "resolved"],
  blocked: ["in_progress", "resolved"],
  resolved: ["open"],
};
const text = (max: number) => z.string().trim().max(max);
export const issueLink = z.object({
  label: text(150).min(1),
  url: z
    .url()
    .max(1000)
    .refine((v) => {
      const u = new URL(v);
      return (
        ["https:", "http:"].includes(u.protocol) && !u.username && !u.password
      );
    }, "Use an HTTP(S) link without credentials."),
});
export const issueSchema = z
  .object({
    title: text(180).min(3),
    description: text(8000).min(5),
    category: z.enum(
      Object.keys(issueCategories) as [
        keyof typeof issueCategories,
        ...(keyof typeof issueCategories)[],
      ],
    ),
    priority: z.enum(issuePriorities).default("normal"),
    dueDate: z.iso.date().nullable().default(null),
    instrumentId: z.string().uuid().nullable().default(null),
    sampleId: z.string().uuid().nullable().default(null),
    project: text(500).default(""),
    assigneeId: z.string().uuid().nullable().default(null),
    supervisorAttention: z.boolean().default(false),
    dataLinks: z.array(issueLink).max(10).default([]),
  })
  .strict();
export type IssueInput = z.infer<typeof issueSchema>;
export const issueVersion = z.object({ version: z.number().int().positive() });
export const issueUpdate = issueSchema
  .extend({ version: z.number().int().positive() })
  .strict();
export const issueAction = issueVersion
  .extend({ status: z.enum(issueStatuses), reason: text(2000).default("") })
  .strict();
export const issueComment = z
  .object({
    body: text(4000).min(1),
    dataLinks: z.array(issueLink).max(10).default([]),
  })
  .strict();
export const issueManager = (role: Member["appRole"]) =>
  role === "supervisor" || role === "administrator";
export type Issue = IssueInput & {
  id: string;
  code: string;
  reporterId: string;
  reporterName: string;
  assigneeName: string | null;
  instrumentName: string | null;
  sampleCode: string | null;
  sampleCompound: string | null;
  status: IssueStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  acknowledgedBy: string | null;
  acknowledgedName: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedName: string | null;
  resolvedAt: string | null;
};
export type IssueEvent = {
  id: string;
  actorId: string;
  actorName: string;
  kind: "created" | "updated" | "status";
  fromStatus: IssueStatus | null;
  toStatus: IssueStatus;
  reason: string;
  createdAt: string;
  before: Issue | null;
  after: Issue;
};
export type IssueCommentItem = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  dataLinks: IssueInput["dataLinks"];
  createdAt: string;
};
export type IssueDetail = Issue & {
  events: IssueEvent[];
  comments: IssueCommentItem[];
};
export type IssueOptions = {
  people: { id: string; fullName: string; active: boolean }[];
  instruments: { id: string; name: string; archived: boolean }[];
  samples: { id: string; code: string; compound: string; archived: boolean }[];
};
export type IssueSummary = {
  urgent: Issue[];
  assigned: Issue[];
  supervisor: Issue[];
  counts: { urgent: number; assigned: number; supervisor: number };
};
export const canDiscussIssue = (u: Member, i: Issue) =>
  issueManager(u.appRole) || i.reporterId === u.id || i.assigneeId === u.id;
export const canEditIssue = (u: Member, i: Issue) =>
  issueManager(u.appRole) || i.reporterId === u.id;
export function availableIssueActions(u: Member, i: Issue) {
  return issueTransitions[i.status].filter((s) =>
    s === "open"
      ? canDiscussIssue(u, i)
      : issueManager(u.appRole) || i.assigneeId === u.id,
  );
}
