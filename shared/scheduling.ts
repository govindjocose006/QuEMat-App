import { z } from "zod";
const text = (max = 2000) => z.string().trim().max(max);
const id = z.string().uuid();
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
export const sampleSchema = z.object({
  compound: text(200).min(1),
  project: text(500).default(""),
  batch: text(200).default(""),
  preparedOn: z.iso.date().nullable().default(null),
  origin: z.enum(["internal", "external"]).default("internal"),
  physicalForm: text(200).default(""),
  quantity: text(200).default(""),
  storage: text(500).default(""),
  notes: text().default(""),
  archived: z.boolean().default(false),
});
export type SampleInput = z.infer<typeof sampleSchema>;
export type Sample = SampleInput & {
  id: string;
  code: string;
  ownerId: string;
  ownerName: string;
  version: number;
  createdAt: string;
};
export const detailSchema = z
  .object({
    temperatureMin: z.number().finite().optional(),
    temperatureMax: z.number().finite().optional(),
    temperatureUnit: z.enum(["K", "°C"]).default("K"),
    fieldMin: z.number().finite().optional(),
    fieldMax: z.number().finite().optional(),
    fieldUnit: z.enum(["T", "Oe"]).default("T"),
    sequence: text(500).default(""),
    sampleMass: text(100).default(""),
    mounting: text().default(""),
    accessories: text(1000).default(""),
    targetTemperatureC: z.number().positive().optional(),
    stages: text().default(""),
    atmosphere: text(500).default(""),
    crucible: text(500).default(""),
    targetMaterial: text(500).default(""),
    substrate: text(500).default(""),
    mode: z.enum(["RF", "DC", "other"]).default("RF"),
    gas: text(200).default(""),
    pressure: text(100).default(""),
    power: text(100).default(""),
    duration: text(100).default(""),
    thickness: text(100).default(""),
    preparation: text().default(""),
    cleaning: text().default(""),
  })
  .superRefine((v, c) => {
    if (
      v.temperatureMin !== undefined &&
      v.temperatureMax !== undefined &&
      v.temperatureMin > v.temperatureMax
    )
      c.addIssue({
        code: "custom",
        message: "Temperature minimum must not exceed maximum.",
      });
    if (
      v.fieldMin !== undefined &&
      v.fieldMax !== undefined &&
      v.fieldMin > v.fieldMax
    )
      c.addIssue({
        code: "custom",
        message: "Field minimum must not exceed maximum.",
      });
  });
export const bookingSchema = z
  .object({
    instrumentId: id,
    operatorId: id,
    participantIds: z.array(id).max(30).default([]),
    sampleIds: z.array(id).min(1).max(30),
    measurementType: text(150).min(1),
    project: text(500).default(""),
    startsAt: instant,
    endsAt: instant,
    setupNotes: text().default(""),
    details: detailSchema,
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "End must be after start.",
    path: ["endsAt"],
  });
export const blockSchema = z
  .object({
    instrumentId: id,
    startsAt: instant,
    endsAt: instant,
    reason: text(1000).min(3),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "End must be after start.",
  });
export const actionSchema = z.object({
  version: z.number().int().positive(),
  action: z.enum([
    "confirm",
    "reject",
    "checkin",
    "complete",
    "interrupt",
    "cancel",
    "overrun",
  ]),
  summary: text().default(""),
  handoverNotes: text().default(""),
  unloaded: z.boolean().default(false),
  dataLink: z
    .union([
      z.literal(""),
      z
        .url()
        .max(1000)
        .refine((v) => ["http:", "https:"].includes(new URL(v).protocol)),
    ])
    .default(""),
  overrunUntil: instant.optional(),
});
export type BookingInput = z.infer<typeof bookingSchema>;
export type Booking = {
  id: string;
  instrumentId: string;
  instrumentName: string;
  category: string;
  bookedBy: string;
  bookerName: string;
  operatorId: string | null;
  operatorName: string;
  kind: "booking" | "maintenance";
  status:
    | "requested"
    | "confirmed"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "interrupted"
    | "rejected";
  startsAt: string;
  endsAt: string;
  reservedStart: string;
  reservedEnd: string;
  setupMinutes: number;
  cleanupMinutes: number;
  measurementType: string;
  project: string;
  sampleSnapshots: Sample[];
  participants: { id: string; name: string }[];
  details: z.infer<typeof detailSchema>;
  setupNotes: string;
  allocationReference: string;
  actualStart: string | null;
  actualEnd: string | null;
  unloaded: boolean;
  completionSummary: string;
  dataLink: string;
  handoverNotes: string;
  overrunUntil: string | null;
  version: number;
  updatedAt: string;
};
export type Availability = {
  id: string;
  instrumentId: string;
  startsAt: string;
  endsAt: string;
  reference: string;
};
export type Notification = {
  id: string;
  bookingId: string | null;
  weeklyReportId: string | null;
  meetingId: string | null;
  noticeId: string | null;
  issueId: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
};
export type Operator = { id: string; fullName: string };
export { managesOperations } from "./scheduling-ui.js";
