import {
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { credentialsSchema } from "../shared/schema.js";
import { audit, type DB } from "./db.js";
const derive = promisify(scrypt);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex"),
    hash = (await derive(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [scheme, salt, stored] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !stored) return false;
  const hash = (await derive(password, salt, 64)) as Buffer,
    expected = Buffer.from(stored, "hex");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}
export async function bootstrapAdmin(
  db: DB,
  email: string,
  password: string,
  fullName: string,
) {
  const input = credentialsSchema.parse({ email, password });
  if (fullName.trim().length < 2 || fullName.trim().length > 120)
    throw new Error("Enter a full name between 2 and 120 characters.");
  const passwordHash = await hashPassword(input.password);
  return db.write(async (tx) => {
    if (
      (await tx.query("SELECT 1 FROM users WHERE app_role='administrator'"))
        .length
    )
      throw new Error(
        "An administrator already exists. Ask an active administrator to manage access.",
      );
    if (
      (await tx.query("SELECT 1 FROM users WHERE email=$1", [input.email]))
        .length
    )
      throw new Error(
        "This email already has an account. Existing accounts are not silently promoted.",
      );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO users(id,email,password_hash,full_name,app_role,status,onboarded,created_at) VALUES ($1,$2,$3,$4,'administrator','approved',1,$5)",
      [
        id,
        input.email,
        passwordHash,
        fullName.trim(),
        new Date().toISOString(),
      ],
    );
    await audit(tx, id, "administrator.bootstrapped", id, {
      method: "trusted operator CLI",
    });
    return id;
  });
}
