/**
 * Durable audit trail writer (INV-8). Writes are best-effort and must never
 * block or fail the user flow: a write error is logged and swallowed. Unlike the
 * log stream (lib/logger.ts), the audit table intentionally records actor
 * identity, which is its purpose as a compliance artifact.
 */
import { db } from "../db/db";
import { logSecurityEvent } from "./logger";

export interface AuditEntry {
  action: string;
  tableName?: string;
  recordId?: string;
  oldData?: unknown;
  newData?: unknown;
  actorId?: string;
  actorEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const oldJson = entry.oldData === undefined ? null : JSON.stringify(entry.oldData);
  const newJson = entry.newData === undefined ? null : JSON.stringify(entry.newData);
  try {
    await db.exec`
      INSERT INTO audit_log
        (action, table_name, record_id, old_data, new_data, actor_id, actor_email, ip_address, user_agent)
      VALUES
        (${entry.action}, ${entry.tableName ?? null}, ${entry.recordId ?? null},
         ${oldJson}::jsonb, ${newJson}::jsonb,
         ${entry.actorId ?? null}, ${entry.actorEmail ?? null},
         ${entry.ipAddress ?? null}, ${entry.userAgent ?? null})
    `;
  } catch {
    logSecurityEvent("audit.write_failed", { action: entry.action });
  }
}
