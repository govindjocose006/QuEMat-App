import { z } from "zod";
export const reportFields = {
  workCompleted: "Work completed",
  experiments: "Experiments / samples measured",
  results: "Main results",
  blockers: "Blockers",
  nextPlan: "Next week’s plan",
  helpNeeded: "Help / decisions needed",
} as const;
export function weekStart(value: string | number | Date = Date.now()) {
  const d = new Date(new Date(value).getTime() + 330 * 60000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
export function weekBounds(week: string) {
  return [
    new Date(week + "T00:00:00+05:30").toISOString(),
    new Date(addDays(week, 7) + "T00:00:00+05:30").toISOString(),
  ];
}
export function weekLabel(week: string) {
  const format = (date: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(new Date(date + "T00:00:00+05:30"));
  return `${format(week)} – ${format(addDays(week, 6))} · Asia/Kolkata`;
}
export const weekSchema = z.iso
  .date()
  .refine(
    (v) =>
      v >= "2000-01-01" &&
      v <= "2100-12-31" &&
      new Date(v + "T00:00:00Z").getUTCDay() === 1,
    "Select a Monday week start (2000–2100).",
  );
const text = (n: number) => z.string().trim().max(n);
export const reportSchema = z.object({
  project: text(500).default(""),
  workCompleted: text(6000).default(""),
  experiments: text(6000).default(""),
  results: text(6000).default(""),
  blockers: text(6000).default(""),
  nextPlan: text(6000).default(""),
  helpNeeded: text(6000).default(""),
  bookingIds: z.array(z.string().uuid()).max(20).default([]),
  sampleIds: z.array(z.string().uuid()).max(20).default([]),
  dataLinks: z
    .array(
      z.object({
        label: text(150).min(1),
        url: z
          .url()
          .max(1000)
          .refine((v) => {
            const u = new URL(v);
            return (
              ["http:", "https:"].includes(u.protocol) &&
              !u.username &&
              !u.password
            );
          }, "Use an HTTP(S) data link without credentials."),
      }),
    )
    .max(10)
    .default([]),
});
export type ReportInput = z.infer<typeof reportSchema>;
export const emptyReport: ReportInput = {
  project: "",
  workCompleted: "",
  experiments: "",
  results: "",
  blockers: "",
  nextPlan: "",
  helpNeeded: "",
  bookingIds: [],
  sampleIds: [],
  dataLinks: [],
};
export type WeeklyBooking = {
  id: string;
  instrumentName: string;
  measurementType: string;
  operatorName: string;
  status: string;
  startsAt: string;
  endsAt: string;
  actualStart: string | null;
  actualEnd: string | null;
  completionSummary: string;
  dataLink: string;
  sampleSnapshots: { id: string; code: string; compound: string }[];
};
export type WeeklySample = {
  id: string;
  code: string;
  compound: string;
  batch: string;
  project: string;
  archived: boolean;
};
export type ReportContent = ReportInput & {
  bookings: WeeklyBooking[];
  samples: WeeklySample[];
};
export type WeeklyRevision = {
  revision: number;
  content: ReportContent;
  submittedAt: string;
};
export type WeeklyComment = {
  id: string;
  revision: number;
  authorName: string;
  body: string;
  kind: "comment" | "followup";
  dueDate: string | null;
  state: "open" | "done";
  version: number;
  createdAt: string;
};
export type WeeklyReport = {
  id: string;
  ownerId: string;
  ownerName: string;
  week: string;
  version: number;
  latestRevision: number;
  firstSubmittedAt: string | null;
  hasDraft?: boolean;
  draft?: ReportInput;
  canReview: boolean;
  revisions: WeeklyRevision[];
  comments: WeeklyComment[];
  reviews: { revision: number; reviewerName: string; reviewedAt: string }[];
  actionEvents: {
    commentId: string;
    actorName: string;
    state: string;
    createdAt: string;
  }[];
};
export type WeeklyRoster = {
  id: string;
  fullName: string;
  project: string;
  active: boolean;
  eligible: boolean;
  status: "submitted" | "missing" | "optional";
  reportId: string | null;
  revision: number;
  reviewed: boolean;
  content: ReportContent | null;
  submittedAt: string | null;
  comments: WeeklyComment[];
};
export const reviewsAll = (role: string) => role === "supervisor";
export const canOpenReview = (role: string) => reviewsAll(role);
