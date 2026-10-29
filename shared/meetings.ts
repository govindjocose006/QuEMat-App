import { z } from "zod";
import type { Member } from "./schema.js";
import { issueLink } from "./issues.js";

const validUnicode = (value: string) => !/[\u0000\uD800-\uDFFF]/u.test(value);
const unicodeMessage = "Use valid Unicode text without null characters.";
const text = (max: number) =>
  z.string().trim().max(max).refine(validUnicode, unicodeMessage);
const collaborationLink = issueLink.extend({
  label: text(150).min(1),
  url: issueLink.shape.url.refine(validUnicode, unicodeMessage),
});
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
export const meetingManager = (role: Member["appRole"]) =>
  role === "supervisor" || role === "administrator";
export const meetingFields = z.object({
  title: text(180).min(3),
  kind: z.enum(["group", "individual"]),
  attendeeIds: z
    .array(z.string().uuid())
    .min(1)
    .max(200)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Select each attendee once.",
    ),
  startsAt: instant,
  endsAt: instant,
  agenda: text(8000).default(""),
  venue: text(500).default(""),
  videoUrl: z.union([z.literal(""), collaborationLink.shape.url]).default(""),
  dataLinks: z.array(collaborationLink).max(10).default([]),
});
const validTimes = (v: { startsAt: string; endsAt: string }) =>
  new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime();
export const meetingSchema = meetingFields.strict().refine(validTimes, {
  message: "End must be after start.",
  path: ["endsAt"],
});
export const meetingUpdate = meetingFields
  .extend({
    version: z.number().int().positive(),
    reason: text(2000).default(""),
  })
  .strict()
  .refine(validTimes, {
    message: "End must be after start.",
    path: ["endsAt"],
  });
export const collaborationVersion = z
  .object({ version: z.number().int().positive() })
  .strict();
export const meetingCancel = collaborationVersion
  .extend({ reason: text(2000).default("") })
  .strict();
export const meetingNote = z
  .object({
    body: text(8000).min(1),
    dataLinks: z.array(collaborationLink).max(10).default([]),
  })
  .strict();
export const meetingAction = z
  .object({
    title: text(500).min(3),
    ownerId: z.string().uuid(),
    dueDate: z.iso.date().nullable().default(null),
  })
  .strict();
export const meetingActionStatus = collaborationVersion
  .extend({ status: z.enum(["open", "done"]) })
  .strict();
export const noticeFields = z.object({
  title: text(180).min(3),
  body: text(12000).min(1),
  pinned: z.boolean().default(false),
  expiresAt: instant.nullable().default(null),
  acknowledgementRequired: z.boolean().default(false),
  dataLinks: z.array(collaborationLink).max(10).default([]),
});
export const noticeSchema = noticeFields.strict();
export const noticeUpdate = noticeFields
  .extend({ version: z.number().int().positive() })
  .strict();
export const noticeAcknowledgement = collaborationVersion
  .extend({ confirmedRead: z.literal(true) })
  .strict();
export type MeetingInput = z.infer<typeof meetingSchema>;
export type Meeting = Omit<MeetingInput, "attendeeIds"> & {
  id: string;
  attendeeIds: string[];
  attendees: { id: string; fullName: string; active: boolean }[];
  status: "scheduled" | "cancelled";
  version: number;
  createdBy: string;
  createdName: string;
  createdAt: string;
  updatedAt: string;
};
export type MeetingEvent = {
  id: string;
  actorName: string;
  kind: string;
  reason: string;
  version: number;
  before: Meeting | null;
  after: Meeting;
  createdAt: string;
};
export type MeetingAction = z.infer<typeof meetingAction> & {
  id: string;
  ownerName: string;
  status: "open" | "done";
  version: number;
  completedBy: string | null;
  completedName: string | null;
  completedAt: string | null;
  events: {
    id: string;
    actorName: string;
    status: string;
    version: number;
    createdAt: string;
  }[];
};
export type MeetingDetail = Meeting & {
  events: MeetingEvent[];
  notes: {
    id: string;
    authorName: string;
    body: string;
    dataLinks: z.infer<typeof issueLink>[];
    createdAt: string;
  }[];
  actions: MeetingAction[];
};
export type NoticeInput = z.infer<typeof noticeSchema>;
export type Notice = NoticeInput & {
  id: string;
  status: "draft" | "published" | "withdrawn";
  version: number;
  createdBy: string;
  createdName: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expired: boolean;
  acknowledged: boolean;
};
export type NoticeDetail = Notice & {
  events: {
    id: string;
    actorName: string;
    kind: string;
    version: number;
    after: NoticeInput & { status: string };
    createdAt: string;
  }[];
  acknowledgements: {
    userId: string;
    fullName: string;
    version: number;
    createdAt: string;
  }[];
};
export type CollaborationSummary = {
  meetings: Meeting[];
  notices: Notice[];
  actions: (Omit<MeetingAction, "events"> & { meetingId: string })[];
};

const escapeCalendar = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
const utcStamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
const istStamp = (value: string) =>
  new Date(new Date(value).getTime() + 330 * 60000)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "");
// RFC 5545 uses octets (not characters); never split a UTF-8 code point.
export function foldCalendarLine(line: string) {
  let result = "",
    length = 0;
  for (const char of line) {
    const bytes = new TextEncoder().encode(char).length;
    if (length + bytes > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += char;
    length += bytes;
  }
  return result;
}
export function meetingCalendar(m: Meeting) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QuEMat//Lab Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Asia/Kolkata",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${m.id}@quemat-lab-hub`,
    `SEQUENCE:${m.version}`,
    `DTSTAMP:${utcStamp(m.updatedAt)}`,
    `CREATED:${utcStamp(m.createdAt)}`,
    `LAST-MODIFIED:${utcStamp(m.updatedAt)}`,
    `DTSTART;TZID=Asia/Kolkata:${istStamp(m.startsAt)}`,
    `DTEND;TZID=Asia/Kolkata:${istStamp(m.endsAt)}`,
    `STATUS:${m.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "CLASS:PRIVATE",
    `SUMMARY:${escapeCalendar(m.title)}`,
    `LOCATION:${escapeCalendar(m.venue)}`,
    `DESCRIPTION:${escapeCalendar([m.agenda, m.videoUrl].filter(Boolean).join("\n"))}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldCalendarLine)
    .join("\r\n");
}
