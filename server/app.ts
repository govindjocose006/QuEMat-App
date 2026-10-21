import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { ipKeyGenerator } from "express-rate-limit";
import { ipAddress } from "@vercel/functions";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import {
  credentialsSchema,
  onboardingSchema,
  memberUpdateSchema,
  instrumentSchema,
  type Member,
} from "../shared/schema.js";
import {
  audit,
  instruments,
  member,
  saveInstrument,
  type DB,
  type SQL,
} from "./db.js";
import { digest, hashPassword, verifyPassword } from "./auth.js";

type Options = {
  origin: string;
  production?: boolean;
  vercel?: boolean;
  trustProxyHops?: number;
  serveClient?: boolean;
  authLimit?: number;
};
type StoredSession = {
  tokenHash: string;
  userId: string | null;
  csrfToken: string;
  expiresAt: number;
};
type Context = { session: StoredSession; user: Member | null };
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}
const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const context = (res: Response) => res.locals.context as Context;

export function createApp(db: DB, options: Options) {
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    options.vercel ? false : (options.trustProxyHops ?? 0),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": options.production ? [] : null,
        },
      },
      strictTransportSecurity: options.production ? undefined : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    if (
      !(
        await db.query(
          "SELECT 1 FROM schema_migrations WHERE name='001_foundation.sql'",
        )
      ).length
    )
      fail(503, "Database migrations are required.");
    res.json({ status: "ok" });
  });
  async function startSession(res: Response, userId: string | null) {
    const token = randomBytes(32).toString("hex");
    const session: StoredSession = {
      tokenHash: digest(token),
      userId,
      csrfToken: randomBytes(32).toString("hex"),
      expiresAt: Date.now() + (userId ? 12 * 60 * 60_000 : 30 * 60_000),
    };
    await db.query("INSERT INTO sessions VALUES ($1,$2,$3,$4)", [
      session.tokenHash,
      session.userId,
      session.csrfToken,
      session.expiresAt,
    ]);
    res.cookie("quemat_session", token, {
      httpOnly: true,
      secure: !!options.production,
      sameSite: "strict",
      path: "/",
      maxAge: session.expiresAt - Date.now(),
    });
    res.locals.context = {
      session,
      user: userId ? await member(db, userId) : null,
    };
    return session;
  }
  app.use("/api", async (req, res, next) => {
    const token = req.cookies.quemat_session;
    let session =
      typeof token === "string"
        ? (
            await db.query<StoredSession>(
              'SELECT token_hash AS "tokenHash",user_id AS "userId",csrf_token AS "csrfToken",expires_at AS "expiresAt" FROM sessions WHERE token_hash=$1 AND expires_at>$2',
              [digest(token), Date.now()],
            )
          )[0]
        : undefined;
    const user = session?.userId ? await member(db, session.userId) : null;
    if (session && session.userId && (!user || user.status === "inactive")) {
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        session.tokenHash,
      ]);
      session = undefined;
    }
    if (!session && req.path === "/session" && req.method === "GET") {
      await db.query("DELETE FROM sessions WHERE expires_at<=$1", [Date.now()]);
      await startSession(res, null);
    } else if (session) res.locals.context = { session, user };
    else
      return next(
        new HttpError(401, "Your session has expired. Please sign in again."),
      );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("origin") !== options.origin)
        return next(
          new HttpError(
            403,
            "This request did not come from the configured app origin.",
          ),
        );
      const csrf = req.get("x-csrf-token") ?? "";
      if (
        !/^[a-f0-9]{64}$/.test(csrf) ||
        !safeEqual(csrf, context(res).session.csrfToken)
      )
        return next(
          new HttpError(
            403,
            "Security token expired. Refresh the page and try again.",
          ),
        );
    }
    next();
  });
  app.get("/api/session", (_req, res) =>
    res.json({
      user: context(res).user,
      csrfToken: context(res).session.csrfToken,
    }),
  );
  async function authLimiter(req: Request, res: Response, next: NextFunction) {
    const ip = options.vercel
      ? ipAddress(new Headers({ "x-real-ip": req.get("x-real-ip") ?? "" })) ||
        "unknown-vercel-client"
      : (req.ip ?? "unknown-client");
    const key = digest(ipKeyGenerator(ip));
    const now = Date.now(),
      nextReset = now + 15 * 60_000;
    await db.query("DELETE FROM rate_limits WHERE reset_at<$1", [now]);
    const [row] = await db.query<{ hits: number; reset_at: number }>(
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES ($1,1,$2)
      ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<=$3 THEN 1 ELSE rate_limits.hits+1 END,
      reset_at=CASE WHEN rate_limits.reset_at<=$3 THEN $2 ELSE rate_limits.reset_at END RETURNING hits,reset_at`,
      [key, nextReset, now],
    );
    if (row.hits > (options.authLimit ?? 30)) {
      res.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((row.reset_at - now) / 1000))),
      );
      res
        .status(429)
        .json({
          error: "Too many sign-in attempts. Please try again in 15 minutes.",
        });
      return;
    }
    next();
  }
  app.use("/api/auth", authLimiter);
  async function rotate(res: Response, id: string | null) {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      context(res).session.tokenHash,
    ]);
    const session = await startSession(res, id);
    return {
      user: id ? await member(db, id) : null,
      csrfToken: session.csrfToken,
    };
  }
  app.post("/api/auth/register", async (req, res) => {
    if (context(res).user)
      fail(409, "Sign out before registering another account.");
    const input = credentialsSchema.parse(req.body),
      passwordHash = await hashPassword(input.password),
      id = randomUUID();
    await db.write(async (tx) => {
      if (
        (await tx.query("SELECT 1 FROM users WHERE email=$1", [input.email]))
          .length
      )
        fail(
          409,
          "Unable to register this email. Try signing in or contact the lab administrator.",
        );
      await tx.query(
        "INSERT INTO users(id,email,password_hash,created_at) VALUES ($1,$2,$3,$4)",
        [id, input.email, passwordHash, new Date().toISOString()],
      );
      await audit(tx, id, "account.registered", id);
    });
    res.status(201).json(await rotate(res, id));
  });
  const dummyHash = hashPassword(randomBytes(32).toString("hex"));
  app.post("/api/auth/login", async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const [row] = await db.query<{
      id: string;
      password_hash: string;
      status: string;
    }>("SELECT id,password_hash,status FROM users WHERE email=$1", [
      input.email,
    ]);
    const valid = await verifyPassword(
      input.password,
      row?.password_hash ?? (await dummyHash),
    );
    if (!valid || !row || row.status === "inactive")
      fail(401, "Email or password is incorrect, or the account is inactive.");
    await audit(db, row.id, "account.signed_in", row.id);
    res.json(await rotate(res, row.id));
  });
  app.post("/api/logout", async (_req, res) => {
    const { user } = context(res);
    if (user) await audit(db, user.id, "account.signed_out", user.id);
    res.set("Clear-Site-Data", '"cache", "storage"');
    res.json(await rotate(res, null));
  });
  function signedIn(_req: Request, res: Response, next: NextFunction) {
    if (!context(res).user)
      return next(new HttpError(401, "Sign in to continue."));
    next();
  }
  function approved(_req: Request, res: Response, next: NextFunction) {
    const user = context(res).user;
    if (!user) return next(new HttpError(401, "Sign in to continue."));
    if (user.status !== "approved" || !user.onboarded)
      return next(
        new HttpError(
          403,
          "Complete onboarding and wait for administrator approval.",
        ),
      );
    next();
  }
  function administrator(req: Request, res: Response, next: NextFunction) {
    approved(req, res, (error?: unknown) => {
      if (error) return next(error);
      if (context(res).user?.appRole !== "administrator")
        return next(
          new HttpError(403, "Administrator permission is required."),
        );
      next();
    });
  }
  async function requireAdministrator(tx: SQL, res: Response) {
    const actor = await member(tx, context(res).user!.id);
    if (
      !actor ||
      actor.status !== "approved" ||
      actor.appRole !== "administrator"
    )
      fail(403, "Administrator permission is required.");
  }
  app.get("/api/mentors", signedIn, async (_req, res) => {
    res.json(
      await db.query(
        `SELECT id,full_name AS "fullName",academic_role AS "academicRole" FROM users WHERE status='approved' AND onboarded=1 AND academic_role IN ('PhD student','Postdoc') ORDER BY full_name`,
      ),
    );
  });
  async function validateMentor(tx: SQL, id: string | null, self: string) {
    if (
      id &&
      (id === self ||
        !(
          await tx.query(
            "SELECT 1 FROM users WHERE id=$1 AND status='approved' AND onboarded=1 AND academic_role IN ('PhD student','Postdoc')",
            [id],
          )
        ).length)
    )
      fail(400, "Choose an approved PhD student or Postdoc as mentor.");
  }
  app.put("/api/onboarding", signedIn, async (req, res) => {
    const user = context(res).user!,
      input = onboardingSchema.parse(req.body);
    await db.write(async (tx) => {
      if ((await member(tx, user.id))?.status !== "pending")
        fail(
          409,
          "Onboarding is already approved. Ask an administrator to update your membership.",
        );
      await validateMentor(tx, input.mentorId, user.id);
      await tx.query(
        "UPDATE users SET full_name=$1,academic_role=$2,project=$3,mentor_id=$4,mentor_pending=$5,onboarded=1,version=version+1 WHERE id=$6",
        [
          input.fullName,
          input.academicRole,
          input.project,
          input.mentorId,
          +input.mentorPending,
          user.id,
        ],
      );
      await audit(tx, user.id, "onboarding.submitted", user.id);
    });
    res.json(await member(db, user.id));
  });
  app.post("/api/password", signedIn, authLimiter, async (req, res) => {
    const input = z
        .object({
          currentPassword: z.string().max(128),
          newPassword: credentialsSchema.shape.password,
        })
        .parse(req.body),
      user = context(res).user!;
    const [row] = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [user.id],
    );
    if (!(await verifyPassword(input.currentPassword, row.password_hash)))
      fail(400, "The current password is incorrect.");
    const passwordHash = await hashPassword(input.newPassword);
    await db.write(async (tx) => {
      const changed = await tx.query(
        "UPDATE users SET password_hash=$1,version=version+1 WHERE id=$2 AND password_hash=$3 AND status<>'inactive' RETURNING id",
        [passwordHash, user.id, row.password_hash],
      );
      if (!changed.length)
        fail(
          409,
          "This account changed while updating your password. Sign in again.",
        );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await audit(tx, user.id, "account.password_changed", user.id);
    });
    res.json(await rotate(res, user.id));
  });
  app.get("/api/instruments", approved, async (req, res) => {
    const includeArchived = req.query.includeArchived === "true";
    if (includeArchived && context(res).user?.appRole !== "administrator")
      fail(403, "Only administrators can view archived instruments.");
    res.json(await instruments(db, includeArchived));
  });
  app.post("/api/instruments", administrator, async (req, res) => {
    const input = instrumentSchema.parse(req.body),
      id = randomUUID();
    await db.write(async (tx) => {
      await requireAdministrator(tx, res);
      await saveInstrument(tx, input, id, false);
      await audit(tx, context(res).user!.id, "instrument.created", id, {
        after: input,
      });
    });
    res
      .status(201)
      .json((await instruments(db, true)).find((i) => i.id === id));
  });
  app.put("/api/instruments/:id", administrator, async (req, res) => {
    const { version, ...fields } = instrumentSchema
        .extend({ version: z.number().int().positive() })
        .parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      await requireAdministrator(tx, res);
      const before = (await instruments(tx, true)).find((i) => i.id === id);
      if (!before) fail(404, "Instrument not found.");
      if (before.version !== version)
        fail(
          409,
          "This instrument changed in another session. Reload before editing.",
        );
      await saveInstrument(tx, fields, id, true);
      await audit(
        tx,
        context(res).user!.id,
        fields.archived !== before.archived
          ? fields.archived
            ? "instrument.archived"
            : "instrument.restored"
          : "instrument.updated",
        id,
        { before, after: fields },
      );
    });
    res.json((await instruments(db, true)).find((i) => i.id === id));
  });
  app.get("/api/admin/members", administrator, async (_req, res) => {
    const ids = await db.query<{ id: string }>(
      "SELECT id FROM users ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,created_at DESC",
    );
    res.json(await Promise.all(ids.map((u) => member(db, u.id))));
  });
  app.patch("/api/admin/members/:id", administrator, async (req, res) => {
    const input = memberUpdateSchema.parse(req.body),
      id = String(req.params.id);
    await db.write(async (tx) => {
      await requireAdministrator(tx, res);
      const before = await member(tx, id);
      if (!before) fail(404, "Member not found.");
      if (before.version !== input.version)
        fail(
          409,
          "This membership changed in another session. Reload before editing.",
        );
      if (input.status === "approved" && !before.onboarded)
        fail(400, "This member must complete onboarding before approval.");
      if (
        before.appRole === "administrator" &&
        before.status === "approved" &&
        (input.appRole !== "administrator" || input.status !== "approved")
      ) {
        if (
          !(
            await tx.query(
              "SELECT 1 FROM users WHERE id<>$1 AND app_role='administrator' AND status='approved'",
              [id],
            )
          ).length
        )
          fail(
            409,
            "The last active administrator cannot be deactivated or demoted.",
          );
      }
      const needsMentor =
        before.academicRole === "Intern" ||
        before.academicRole === "Master’s student";
      if (needsMentor && Boolean(input.mentorId) === input.mentorPending)
        fail(400, "Select a mentor or flag the assignment as pending.");
      if (!needsMentor && (input.mentorId || input.mentorPending))
        fail(400, "Mentor assignments apply to Master’s students and interns.");
      await validateMentor(tx, input.mentorId, id);
      await tx.query(
        "UPDATE users SET status=$1,app_role=$2,mentor_id=$3,mentor_pending=$4,version=version+1 WHERE id=$5",
        [input.status, input.appRole, input.mentorId, +input.mentorPending, id],
      );
      if (input.status !== "approved" && before.status === "approved") {
        const mentees = await tx.query<{ id: string }>(
          "SELECT id FROM users WHERE mentor_id=$1",
          [id],
        );
        for (const mentee of mentees) {
          await tx.query(
            "UPDATE users SET mentor_id=NULL,mentor_pending=1,version=version+1 WHERE id=$1",
            [mentee.id],
          );
          await audit(
            tx,
            context(res).user!.id,
            "mentor.reassignment_required",
            mentee.id,
            { previousMentorId: id },
          );
        }
      }
      if (input.status !== "approved" || input.appRole !== before.appRole)
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await audit(tx, context(res).user!.id, "membership.updated", id, {
        before: {
          status: before.status,
          appRole: before.appRole,
          mentorId: before.mentorId,
          mentorPending: before.mentorPending,
        },
        after: {
          status: input.status,
          appRole: input.appRole,
          mentorId: input.mentorId,
          mentorPending: input.mentorPending,
        },
        reason: input.reason,
      });
    });
    res.json(await member(db, id));
  });
  app.get("/api/admin/audit", administrator, async (_req, res) => {
    res.json(
      await db.query(
        `SELECT a.id,a.created_at AS "createdAt",COALESCE(u.full_name,'System') AS "actorName",a.action,a.entity_id AS "entityId",a.details FROM audit_events a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.created_at DESC,a.sequence DESC LIMIT 200`,
      ),
    );
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "This endpoint does not exist.")),
  );
  if (options.serveClient) {
    app.use(express.static(resolve("dist/client"), { index: false }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve("dist/client/index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(" "),
          });
        return;
      }
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError && "body" in error) {
        res.status(400).json({ error: "Invalid JSON request." });
        return;
      }
      if (
        typeof error === "object" &&
        error &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        res.status(413).json({ error: "Request is too large." });
        return;
      }
      console.error(
        "Request failed:",
        error instanceof Error ? error.name : "unknown error",
      );
      res
        .status(500)
        .json({
          error:
            "The request could not be completed. Please retry or contact the administrator.",
        });
    },
  );
  return app;
}
