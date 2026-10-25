// Reuse sanitized stage/type/code mechanics, never the earlier release authorization.
import { ReleaseDiagnostics as PreviousDiagnostics } from "./phase3a-release-diagnostics.js";
import { ReleaseError } from "./production-release-core.js";
export { safeError, type ReleaseStage } from "./phase3a-release-diagnostics.js";
export class ReleaseDiagnostics extends PreviousDiagnostics {
  override failure(error: unknown) {
    const result = super.failure(error);
    if (
      error instanceof ReleaseError &&
      error.message ===
        "Phase 3C backup receipt/target/checksum/freshness mismatch. Migration is blocked."
    ) {
      result.diagnostic.guard = "BACKUP_RECEIPT_MISMATCH_OR_EXPIRED";
      result.diagnostic.hint =
        "Backup receipt, target, checksum or original 24-hour freshness mismatch. Migration remains blocked.";
    }
    return {
      ...result,
      error:
        "Phase 3C production release step failed; merge/deployment remain blocked",
    };
  }
}
