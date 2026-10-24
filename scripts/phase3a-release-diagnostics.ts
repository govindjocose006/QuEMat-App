// Deliberately never serializes error messages, stacks, paths, SQL or records.
import { ReleaseError } from "./production-release-core.js";

export type ReleaseStage =
  | "configuration"
  | "migration.hash"
  | "clients.version"
  | "backup.passphrase"
  | "backup.credentials.prepare"
  | "backup.dump"
  | "backup.encrypt"
  | "backup.decrypt"
  | "backup.plaintext.hash"
  | "backup.archive.list"
  | "backup.archive.full_read"
  | "backup.receipt.read"
  | "backup.archive.hash"
  | "backup.receipt.write"
  | "backup.recovery.write"
  | "database.connection_and_identity"
  | "database.history"
  | "database.read_only.begin"
  | "database.read_only.catalog"
  | "migration.begin_or_write_lock"
  | "migration.lock_timeout"
  | "migration.lock_tables"
  | "migration.baseline"
  | "migration.fingerprint.before"
  | "migration.ddl"
  | "migration.ledger"
  | "migration.schema_check"
  | "migration.fingerprint.after"
  | "migration.preservation"
  | "migration.commit"
  | "migration.completed"
  | "verification"
  | "database.close";

const systemCodes = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EACCES",
  "EPERM",
  "ENOENT",
  "EEXIST",
  "EBUSY",
  "ENOSPC",
  "EMFILE",
  "ENFILE",
  "EIO",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_SSL_TLSV1_ALERT_UNKNOWN_CA",
  "ERR_CRYPTO_INVALID_AUTH_TAG",
  "ERR_CRYPTO_INVALID_SCRYPT_PARAMS",
]);
const sqlState =
  /^(?:00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|F0|HV|P0|XX)[0-9A-Z]{3}$/;
const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "AbortError",
  "AggregateError",
  "URIError",
]);
type SafeError = {
  type: string;
  code: string | null;
  kind: string;
  guard?: string;
  hint?: string;
  cause?: SafeError;
  errors?: SafeError[];
  nativeExitCode?: number;
};
export function safeError(
  error: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): SafeError {
  const e =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof e.code === "string" &&
    (systemCodes.has(e.code) || sqlState.test(e.code))
      ? e.code
      : null;
  const result: SafeError = {
    type:
      error instanceof ReleaseError
        ? "ReleaseGuardError"
        : code && sqlState.test(code)
          ? "DatabaseError"
          : typeof e.name === "string" && errorTypes.has(e.name)
            ? e.name
            : "UnknownError",
    code,
    kind: code
      ? sqlState.test(code)
        ? "postgresql"
        : "system"
      : "unclassified",
  };
  // Classification only; even a connection error message is never printed.
  if (
    e.message === "Connection terminated due to connection timeout" ||
    e.message === "timeout exceeded when trying to connect"
  )
    result.kind = "connection_timeout";
  if (e.message === "Connection terminated unexpectedly")
    result.kind = "connection_closed";
  if (
    typeof e.message === "string" &&
    /^SASL: SCRAM-SERVER-(FIRST|FINAL)-MESSAGE: /.test(e.message)
  )
    result.kind = "authentication_protocol";
  if (
    typeof e.nativeExitCode === "number" &&
    Number.isInteger(e.nativeExitCode) &&
    e.nativeExitCode >= 0 &&
    e.nativeExitCode <= 255
  )
    result.nativeExitCode = e.nativeExitCode;
  if (error instanceof ReleaseError) {
    result.kind = "release_guard";
    if (
      e.message ===
      "Create and verify the encrypted production backup first. No migration was run."
    ) {
      result.guard = "BACKUP_REQUIRED";
      result.hint =
        "Create and verify the encrypted production backup first. No migration was run.";
    } else if (
      e.message ===
      "Phase 3A backup receipt/target/checksum/freshness mismatch. Migration is blocked."
    ) {
      result.guard = "BACKUP_RECEIPT_MISMATCH_OR_EXPIRED";
      result.hint =
        "Backup receipt, target, checksum or freshness mismatch. Migration remains blocked.";
    } else if (
      e.message ===
      "Use an interactive trusted terminal for the backup passphrase."
    ) {
      result.guard = "INTERACTIVE_TERMINAL_REQUIRED";
    } else result.guard = "RELEASE_PRECONDITION_FAILED";
  }
  if (depth < 2 && !seen.has(error)) {
    seen.add(error);
    if (e.cause && !seen.has(e.cause))
      result.cause = safeError(e.cause, depth + 1, seen);
    if (Array.isArray(e.errors))
      result.errors = e.errors
        .slice(0, 3)
        .map((x) => safeError(x, depth + 1, seen));
  }
  return result;
}
export class ReleaseDiagnostics {
  current: ReleaseStage = "configuration";
  private commitAcknowledged = false;
  private primary?: { stage: ReleaseStage; error: unknown; safe: SafeError };
  stage = (stage: ReleaseStage) => {
    this.current = stage;
    if (stage === "migration.completed") this.commitAcknowledged = true;
  };
  capture = (error: unknown) => {
    this.primary ??= { stage: this.current, error, safe: safeError(error) };
  };
  failure(error: unknown) {
    const original = this.primary;
    return {
      error:
        "Phase 3A production release step failed; merge/deployment remain blocked",
      stage: original?.stage ?? this.current,
      errorType: (original?.safe ?? safeError(error)).type,
      code: (original?.safe ?? safeError(error)).code,
      diagnostic: original?.safe ?? safeError(error),
      ...(original && original.error !== error
        ? { secondaryError: safeError(error) }
        : {}),
      databaseOutcome: this.commitAcknowledged
        ? "MIGRATION_COMMIT_ACKNOWLEDGED"
        : "NOT_ESTABLISHED_BY_ERROR_OUTPUT",
      rollbackProven: false,
      credentialsPrinted: false,
    };
  }
}
