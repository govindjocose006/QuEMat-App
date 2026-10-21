import { z } from "zod";

import {
  academicRoles,
  appRoles,
  memberStatuses,
  operationalStatuses,
} from "./options.js";
const text = (max: number) => z.string().trim().max(max);
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128);
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: passwordSchema,
});
export const onboardingSchema = z
  .object({
    fullName: text(120).min(2),
    academicRole: z.enum(academicRoles),
    project: text(500),
    mentorId: z.string().uuid().nullable(),
    mentorPending: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const needsMentor =
      v.academicRole === "Intern" || v.academicRole === "Master’s student";
    if (needsMentor && Boolean(v.mentorId) === v.mentorPending) {
      ctx.addIssue({
        code: "custom",
        message: "Select an approved mentor or mark assignment pending.",
        path: ["mentorId"],
      });
    }
    if (!needsMentor && (v.mentorId || v.mentorPending)) {
      ctx.addIssue({
        code: "custom",
        message: "Mentor assignment applies to Master’s students and interns.",
        path: ["mentorId"],
      });
    }
  });
export const memberUpdateSchema = z.object({
  status: z.enum(memberStatuses),
  appRole: z.enum(appRoles),
  mentorId: z.string().uuid().nullable(),
  mentorPending: z.boolean(),
  version: z.number().int().positive(),
  reason: text(500).min(5, "Record a reason (at least 5 characters)."),
});
const safeUrl = z
  .url()
  .max(1000)
  .refine(
    (v) => ["https:", "http:"].includes(new URL(v).protocol),
    "Use an HTTP or HTTPS link.",
  );
export const instrumentSchema = z.object({
  name: text(150).min(2),
  category: text(80).min(2),
  location: text(200),
  description: text(2000),
  status: z.enum(operationalStatuses),
  priority: z.boolean(),
  maxTemperatureC: z.number().positive().max(10000).nullable(),
  bookingRules: text(2000),
  schedulingMode: z.enum(["internal", "allocated"]),
  coordinatorApproval: z.boolean(),
  setupMinutes: z.number().int().min(0).max(10080),
  cleanupMinutes: z.number().int().min(0).max(10080),
  trainingPolicy: text(2000),
  trainingNote: text(250),
  trainedUsers: z.array(text(120).min(1)).max(100),
  sopLinks: z
    .array(z.object({ label: text(150).min(1), url: safeUrl }))
    .max(20),
  archived: z.boolean(),
});
export type InstrumentInput = z.infer<typeof instrumentSchema>;
export type Instrument = InstrumentInput & {
  id: string;
  version: number;
  updatedAt: string;
  sortOrder: number;
};
export type Member = {
  id: string;
  email: string;
  fullName: string;
  academicRole: (typeof academicRoles)[number] | null;
  project: string;
  mentorId: string | null;
  mentorName: string | null;
  mentorPending: boolean;
  appRole: (typeof appRoles)[number];
  status: (typeof memberStatuses)[number];
  onboarded: boolean;
  version: number;
  createdAt: string;
};
export type Session = { user: Member | null; csrfToken: string };
export type AuditEntry = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entityId: string;
  details: string;
};
