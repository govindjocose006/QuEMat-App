import { afterAll, beforeAll, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import {
  openDatabase,
  migrate,
  seed,
  instruments,
  type DB,
} from "../server/db.js";
import { bootstrapAdmin } from "../server/auth.js";
import { instrumentSchema, memberUpdateSchema } from "../shared/schema.js";
import {
  actionSchema,
  bookingSchema,
  blockSchema,
} from "../shared/scheduling.js";
import { issueAction, issueComment } from "../shared/issues.js";
import {
  recordOrderSchema,
  receiveSchema,
  cancelSchema,
} from "../shared/orders.js";

const origin = "http://localhost:5173";
const password = "Validation-synthetic-only-password!";
const validText = "Synthetic പരീക്ഷണം 测试 🧪";
const invalidCharacters = ["\u0000", "\ud800", "\udfff"];
let db: DB,
  app: ReturnType<typeof createApp>,
  admin: Awaited<ReturnType<typeof client>>;
async function client(email: string, mode: "login" | "register" = "login") {
  const agent = request.agent(app);
  let csrf = (await agent.get("/api/session")).body.csrfToken;
  const write = async (
    path: string,
    data: object | string,
    method: "post" | "put" = "post",
  ) => {
    const response = await agent[method]("/api" + path)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrf)
      .set("Content-Type", "application/json")
      .send(data);
    if (response.body.csrfToken) csrf = response.body.csrfToken;
    return response;
  };
  const response = await write("/auth/" + mode, { email, password });
  expect(response.status).toBe(mode === "login" ? 200 : 201);
  return { write, get: (path: string) => agent.get("/api" + path) };
}
beforeAll(async () => {
  db = await openDatabase({ localPath: ":memory:" });
  await migrate(db);
  await seed(db);
  await bootstrapAdmin(
    db,
    "validation@example.test",
    password,
    "Synthetic auditor",
  );
  app = createApp(db, { origin, authLimit: 1000 });
  admin = await client("validation@example.test");
}, 20000);
afterAll(async () => {
  await db.close();
});
const recordCases = (text: string) => [
  { path: "/samples", field: "compound", payload: { compound: text } },
  {
    path: "/orders",
    field: "chemical",
    payload: {
      chemical: text,
      quantity: 1,
      unit: "g",
      purpose: "Synthetic validation test",
    },
  },
  {
    path: "/issues",
    field: "title",
    payload: {
      title: text,
      description: "Synthetic validation test",
      category: "general_decision",
    },
  },
];
it.each(invalidCharacters)(
  "rejects malformed record text %j without creating records or history",
  async (character) => {
    const [before] = await db.query(
      "SELECT count(*)::int AS count FROM audit_events",
    );
    for (const { path, payload } of recordCases(
      "Synthetic " + character + " text",
    )) {
      const response = await admin.write(path, payload);
      expect(response.status, path).toBe(400);
      expect(response.body.error).toContain("valid Unicode");
    }
    expect(
      (await db.query("SELECT count(*)::int AS count FROM audit_events"))[0],
    ).toEqual(before);
  },
);
it("round-trips multilingual text and emoji, and rejects malformed edits without changing saved records", async () => {
  for (const { path, field, payload } of recordCases(validText)) {
    const created = await admin.write(path, payload);
    expect(created.status, created.body.error).toBe(201);
    expect(created.body[field]).toBe(validText);
    const invalid = await admin.write(
      path + "/" + created.body.id,
      {
        ...payload,
        [field]: "Invalid\u0000 edit",
        version: created.body.version,
      },
      "put",
    );
    expect(invalid.status, path).toBe(400);
    const saved =
      path === "/samples"
        ? (await admin.get(path)).body.find(
            (item: { id: string }) => item.id === created.body.id,
          )
        : (await admin.get(path + "/" + created.body.id)).body;
    expect(saved[field]).toBe(validText);
    expect(saved.version).toBe(created.body.version);
  }
});
it.each(invalidCharacters)(
  "rejects malformed Unicode %j in related text and link fields",
  async (character) => {
    const bad = "Synthetic " + character + " text";
    const url = "https://example.test/" + character + "data";
    const instrument = instrumentSchema.parse((await instruments(db))[0]);
    for (const fields of [
      { description: bad },
      { trainedUsers: [bad] },
      { sopLinks: [{ label: bad, url: "https://example.test/data" }] },
      { sopLinks: [{ label: "Synthetic link", url }] },
    ]) {
      const response = await admin.write("/instruments", {
        ...instrument,
        ...fields,
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("valid Unicode");
    }
    const issue = await admin.write("/issues", {
      title: "Synthetic link validation",
      description: "Synthetic validation test",
      category: "general_decision",
      dataLinks: [{ label: "Synthetic link", url }],
    });
    expect(issue.status).toBe(400);
    const id = randomUUID();
    const dates = {
      startsAt: "2030-01-01T10:00:00Z",
      endsAt: "2030-01-01T11:00:00Z",
    };
    const cases = [
      memberUpdateSchema.safeParse({
        status: "approved",
        appRole: "member",
        mentorId: null,
        mentorPending: false,
        version: 1,
        reason: bad,
      }),
      bookingSchema.safeParse({
        instrumentId: id,
        operatorId: id,
        sampleIds: [id],
        measurementType: "Synthetic",
        ...dates,
        details: { mounting: bad },
      }),
      blockSchema.safeParse({ instrumentId: id, ...dates, reason: bad }),
      actionSchema.safeParse({ version: 1, action: "complete", summary: bad }),
      actionSchema.safeParse({ version: 1, action: "complete", dataLink: url }),
      issueAction.safeParse({
        version: 1,
        status: "acknowledged",
        reason: bad,
      }),
      issueComment.safeParse({ body: bad }),
      issueComment.safeParse({
        body: "Synthetic",
        dataLinks: [{ label: "Synthetic", url }],
      }),
      recordOrderSchema.safeParse({
        version: 1,
        supplier: bad,
        orderedBy: id,
        orderedOn: "2026-01-01",
        costPaise: null,
      }),
      receiveSchema.safeParse({
        version: 1,
        quantity: 1,
        receivedOn: "2026-01-01",
        notes: bad,
      }),
      cancelSchema.safeParse({ version: 1, reason: bad }),
    ];
    for (const result of cases) {
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.message).toContain("valid Unicode");
    }
  },
);
it("validates onboarding names before storage while retaining valid multilingual profiles", async () => {
  const pending = await client("validation-pending@example.test", "register");
  const profile = {
    fullName: validText,
    academicRole: "PhD student",
    project: validText,
    mentorId: null,
    mentorPending: false,
  };
  for (const character of invalidCharacters) {
    const response = await pending.write(
      "/onboarding",
      { ...profile, fullName: "Synthetic " + character },
      "put",
    );
    expect(response.status).toBe(400);
    expect((await pending.get("/session")).body.user.onboarded).toBe(false);
  }
  const response = await pending.write("/onboarding", profile, "put");
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    fullName: validText,
    project: validText,
  });
});
it("creates and edits maximum-length instrument fields using UTF-8 and escaped JSON", async () => {
  const prefix = "https://example.test/";
  const input = instrumentSchema.parse({
    ...(await instruments(db))[0],
    name: "测".repeat(150),
    category: "测".repeat(80),
    location: "测".repeat(200),
    description: "测".repeat(2000),
    bookingRules: "测".repeat(2000),
    trainingPolicy: "测".repeat(2000),
    trainingNote: "测".repeat(250),
    trainedUsers: Array.from({ length: 100 }, (_, index) =>
      String.fromCharCode(0x4e00 + index).repeat(120),
    ),
    sopLinks: Array.from({ length: 20 }, () => ({
      label: "测".repeat(150),
      url: prefix + "测".repeat(1000 - prefix.length),
    })),
  });
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(64 * 1024);
  const created = await admin.write("/instruments", input);
  expect(created.status, created.body.error).toBe(201);
  expect(created.body).toMatchObject(input);
  const update = {
    ...input,
    version: created.body.version,
    name: "试".repeat(150),
  };
  const escaped = JSON.stringify(update).replace(
    /[^\x00-\x7f]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
  expect(Buffer.byteLength(escaped)).toBeGreaterThan(240 * 1024);
  expect(Buffer.byteLength(escaped)).toBeLessThan(256 * 1024);
  const edited = await admin.write(
    "/instruments/" + created.body.id,
    escaped,
    "put",
  );
  expect(edited.status, edited.body.error).toBe(200);
  expect(edited.body).toMatchObject({
    ...input,
    name: update.name,
    version: created.body.version + 1,
  });
});
it("keeps oversized instrument requests bounded and leaves unrelated endpoints at 64 KiB", async () => {
  for (const [path, length] of [
    ["/instruments", 256 * 1024],
    ["/orders", 64 * 1024],
  ] as const) {
    const response = await admin.write(path, { padding: "x".repeat(length) });
    expect(response.status).toBe(413);
  }
});
