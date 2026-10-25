import { z } from "zod";
import type { Member } from "./schema.js";
const text = (n: number) => z.string().trim().max(n);
export const orderStatuses = [
  "requested",
  "ordered",
  "part_received",
  "received",
  "cancelled",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export const orderLabels: Record<OrderStatus, string> = {
  requested: "Requested",
  ordered: "Ordered",
  part_received: "Part received",
  received: "Received",
  cancelled: "Cancelled",
};
export const quantity = z
  .number()
  .positive()
  .max(1000000)
  .refine(
    (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001,
    "Use at most three decimal places.",
  );
export const money = z.number().int().min(0).max(100000000000).nullable();
export const requestSchema = z
  .object({
    chemical: text(200).min(2),
    casNumber: text(80).default(""),
    purity: text(150).default(""),
    catalogue: text(150).default(""),
    quantity,
    unit: z.enum(["g", "kg", "mg", "mL", "L", "bottle", "pack", "piece"]),
    purpose: text(2000).min(3),
    project: text(300).default(""),
    preferredSupplier: text(200).default(""),
    estimatedCostPaise: money.default(null),
    notes: text(4000).default(""),
  })
  .strict();
export type ChemicalRequest = z.infer<typeof requestSchema>;
export const recordOrderSchema = z
  .object({
    version: z.number().int().positive(),
    supplier: text(200).min(2),
    orderedBy: z.string().uuid(),
    orderedOn: z.iso.date(),
    expectedOn: z.iso.date().nullable().default(null),
    costPaise: money,
    reference: text(200).default(""),
  })
  .strict();
export const receiveSchema = z
  .object({
    version: z.number().int().positive(),
    quantity,
    receivedOn: z.iso.date(),
    notes: text(2000).default(""),
  })
  .strict();
export const cancelSchema = z
  .object({
    version: z.number().int().positive(),
    reason: text(2000).default(""),
  })
  .strict();
export type ChemicalOrder = ChemicalRequest & {
  id: string;
  code: string;
  requesterId: string;
  requesterName: string;
  status: OrderStatus;
  version: number;
  receivedQuantity: number;
  supplier: string;
  orderedBy: string | null;
  orderedName: string | null;
  orderedOn: string | null;
  expectedOn: string | null;
  costPaise: number | null;
  reference: string;
  createdAt: string;
  updatedAt: string;
};
export type OrderEvent = {
  id: string;
  actorName: string;
  kind: string;
  version: number;
  createdAt: string;
  before: ChemicalOrder | null;
  after: ChemicalOrder;
  reason: string;
};
export type Delivery = {
  id: string;
  quantity: number;
  receivedOn: string;
  receivedName: string;
  notes: string;
  createdAt: string;
};
export type OrderDetail = ChemicalOrder & {
  events: OrderEvent[];
  deliveries: Delivery[];
};
export const orderManager = (u: Member) =>
  ["administrator", "supervisor"].includes(u.appRole);
export const canManageOrder = (u: Member, o: ChemicalOrder) =>
  orderManager(u) || o.requesterId === u.id;
export function rupees(paise: number | null) {
  return paise === null
    ? "Not recorded"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
      }).format(paise / 100);
}
// Use exact integer paise, never binary float multiplication for entered costs.
export function parseRupees(s: string): number | null {
  if (!s.trim()) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s.trim()))
    throw Error("Enter an INR amount with at most two decimal places.");
  const [a, b = ""] = s.trim().split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
