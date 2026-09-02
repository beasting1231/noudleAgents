import { randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import type { RelayEvent } from "@noudle-agents/protocol";
import type { EntityKind, EntityMap, NewEvent, QueueJob, Snapshot, Workspace } from "../model.js";
import { migrations } from "./migrations.js";
import type { MessageRunCommit, MessageRunCommitResult, PushSubscription, RelayRepository } from "./repository.js";

const { Pool } = pg;

const tables: Record<EntityKind, string> = {
  agents: "agents",
  conversations: "conversations",
  messages: "messages",
  tasks: "tasks",
  runs: "runs",
  approvals: "approvals",
  artifacts: "artifacts",
  computers: "computer_sessions",
  connectors: "connector_accounts",
  schedules: "schedules",
};

function eventFromRow(row: Record<string, unknown>): RelayEvent {
  return {
    id: String(row.id),
    cursor: Number(row.cursor),
    workspaceId: String(row.workspace_id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    sequence: Number(row.sequence),
    type: row.type as RelayEvent["type"],
    actorType: row.actor_type as RelayEvent["actorType"],
    actorId: row.actor_id === null ? null : String(row.actor_id),
    payload: row.payload as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function jobFromRow(row: Record<string, unknown>): QueueJob {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind),
    payload: row.payload as Record<string, unknown>,
    status: row.status as QueueJob["status"],
    attempts: Number(row.attempts),
    availableAt: new Date(String(row.available_at)).toISOString(),
    lockedAt: row.locked_at ? new Date(String(row.locked_at)).toISOString() : null,
    lockedBy: row.locked_by === null ? null : String(row.locked_by),
    error: row.error === null ? null : String(row.error),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export class PostgresRelayRepository implements RelayRepository {
  readonly kind = "postgres" as const;
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 12, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE IF NOT EXISTS relay_schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const migration of migrations) {
        const applied = await client.query("SELECT 1 FROM relay_schema_migrations WHERE version = $1", [migration.version]);
        if (applied.rowCount) continue;
        await client.query(migration.sql);
        await client.query("INSERT INTO relay_schema_migrations(version, name) VALUES ($1, $2)", [migration.version, migration.name]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const result = await this.pool.query("SELECT * FROM workspaces WHERE id = $1", [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row
      ? {
          id: String(row.id),
          name: String(row.name),
          ownerId: String(row.owner_id),
          profile: (row.profile && typeof row.profile === "object" ? row.profile : {}) as Record<string, string>,
          createdAt: new Date(String(row.created_at)).toISOString(),
          updatedAt: new Date(String(row.updated_at)).toISOString(),
        }
      : null;
  }

  async putWorkspace(workspace: Workspace): Promise<void> {
    await this.pool.query(
      `INSERT INTO workspaces(id, name, owner_id, profile, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, owner_id=excluded.owner_id, profile=excluded.profile, updated_at=excluded.updated_at`,
      [workspace.id, workspace.name, workspace.ownerId, JSON.stringify(workspace.profile), workspace.createdAt, workspace.updatedAt],
    );
  }

  async list<K extends EntityKind>(kind: K, workspaceId: string): Promise<EntityMap[K][]> {
    const result = await this.pool.query(`SELECT data FROM ${tables[kind]} WHERE workspace_id = $1 ORDER BY created_at`, [workspaceId]);
    return result.rows.map((row: { data: EntityMap[K] }) => row.data);
  }

  async get<K extends EntityKind>(kind: K, id: string): Promise<EntityMap[K] | null> {
    const result = await this.pool.query(`SELECT data FROM ${tables[kind]} WHERE id = $1`, [id]);
    return (result.rows[0]?.data as EntityMap[K] | undefined) ?? null;
  }

  async put<K extends EntityKind>(kind: K, value: EntityMap[K]): Promise<void> {
    const columns = ["id", "workspace_id", "data", "created_at", "updated_at"];
    const updatedAt = "updatedAt" in value ? String(value.updatedAt) : value.createdAt;
    const params: unknown[] = [value.id, value.workspaceId, JSON.stringify(value), value.createdAt, updatedAt];
    if (kind === "messages") {
      columns.push("conversation_id", "client_operation_id");
      const message = value as EntityMap["messages"];
      params.push(message.conversationId, message.clientOperationId);
    } else if (kind === "tasks") {
      columns.push("parent_task_id");
      params.push((value as EntityMap["tasks"]).parentTaskId);
    } else if (kind === "artifacts") {
      const artifact = value as EntityMap["artifacts"];
      columns.push("logical_id", "version", "parent_artifact_id", "checksum", "storage_key");
      params.push(artifact.logicalId, artifact.version, artifact.parentArtifactId, artifact.checksum, artifact.storageKey);
    } else if (kind === "schedules") {
      const schedule = value as EntityMap["schedules"];
      columns.push("enabled", "next_run_at", "locked_at", "locked_by");
      params.push(schedule.enabled, schedule.nextRunAt, null, null);
    }
    const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
    const result = await this.pool.query(
      `INSERT INTO ${tables[kind]}(${columns.join(",")}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at${kind === "schedules" ? ", enabled=excluded.enabled, next_run_at=excluded.next_run_at, locked_at=NULL, locked_by=NULL" : ""}
       WHERE ${tables[kind]}.workspace_id=excluded.workspace_id
       RETURNING id`,
      params,
    );
    if (result.rowCount === 0) throw new Error(`Entity id '${value.id}' already belongs to another workspace`);
  }

  async delete(kind: EntityKind, id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM ${tables[kind]} WHERE id = $1`, [id]);
    return Boolean(result.rowCount);
  }

  async snapshot(workspaceId: string): Promise<Snapshot> {
    const [agents, conversations, messages, tasks, approvals, cursor] = await Promise.all([
      this.list("agents", workspaceId),
      this.list("conversations", workspaceId),
      this.list("messages", workspaceId),
      this.list("tasks", workspaceId),
      this.list("approvals", workspaceId),
      this.currentCursor(workspaceId),
    ]);
    return { agents, conversations, messages, tasks, approvals, cursor };
  }

  private async appendWithClient(client: PoolClient, event: NewEvent): Promise<RelayEvent> {
    const aggregateKey = `${event.workspaceId}:${event.aggregateType}:${event.aggregateId}`;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [aggregateKey]);
    const sequenceResult = await client.query(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM relay_events WHERE workspace_id=$1 AND aggregate_type=$2 AND aggregate_id=$3",
      [event.workspaceId, event.aggregateType, event.aggregateId],
    );
    const sequence = Number(sequenceResult.rows[0]?.sequence ?? 1);
    const id = `evt_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const result = await client.query(
      `INSERT INTO relay_events(id,workspace_id,aggregate_type,aggregate_id,sequence,type,actor_type,actor_id,payload,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, event.workspaceId, event.aggregateType, event.aggregateId, sequence, event.type, event.actorType, event.actorId, JSON.stringify(event.payload), createdAt],
    );
    return eventFromRow(result.rows[0] as Record<string, unknown>);
  }

  async appendEvent(event: NewEvent): Promise<RelayEvent> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const stored = await this.appendWithClient(client, event);
      await client.query("COMMIT");
      return stored;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listEvents(workspaceId: string, after: number, limit = 1000): Promise<RelayEvent[]> {
    const result = await this.pool.query(
      "SELECT * FROM relay_events WHERE workspace_id=$1 AND cursor>$2 ORDER BY cursor LIMIT $3",
      [workspaceId, after, limit],
    );
    return result.rows.map((row: Record<string, unknown>) => eventFromRow(row));
  }

  async currentCursor(workspaceId: string): Promise<number> {
    const result = await this.pool.query("SELECT COALESCE(MAX(cursor),0) AS cursor FROM relay_events WHERE workspace_id=$1", [workspaceId]);
    return Number(result.rows[0]?.cursor ?? 0);
  }

  async commitMessageRun(input: MessageRunCommit): Promise<MessageRunCommitResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${input.message.workspaceId}:send-message:${input.idempotencyKey}`,
      ]);
      const existing = await client.query(
        "SELECT response FROM idempotency_keys WHERE workspace_id=$1 AND operation='send-message' AND key=$2",
        [input.message.workspaceId, input.idempotencyKey],
      );
      if (existing.rowCount) {
        await client.query("COMMIT");
        const response = existing.rows[0]?.response as { message: EntityMap["messages"]; runId: string };
        return { ...response, created: false, events: [] };
      }

      await client.query(
        `INSERT INTO messages(id,workspace_id,conversation_id,client_operation_id,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,
        [input.message.id, input.message.workspaceId, input.message.conversationId, input.message.clientOperationId, JSON.stringify(input.message), input.message.createdAt],
      );
      await client.query(
        "INSERT INTO runs(id,workspace_id,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5)",
        [input.run.id, input.run.workspaceId, JSON.stringify(input.run), input.run.createdAt, input.run.updatedAt],
      );
      await this.insertJob(client, input.job);
      const events: RelayEvent[] = [];
      for (const event of input.events) events.push(await this.appendWithClient(client, event));
      const response = { message: input.message, runId: input.run.id };
      await client.query(
        "INSERT INTO idempotency_keys(workspace_id,operation,key,response) VALUES($1,'send-message',$2,$3)",
        [input.message.workspaceId, input.idempotencyKey, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return { ...response, created: true, events };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertJob(client: PoolClient, job: QueueJob): Promise<void> {
    await client.query(
      `INSERT INTO queue_jobs(id,workspace_id,kind,payload,status,attempts,available_at,locked_at,locked_by,error,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO NOTHING`,
      [job.id, job.workspaceId, job.kind, JSON.stringify(job.payload), job.status, job.attempts, job.availableAt, job.lockedAt, job.lockedBy, job.error, job.createdAt, job.updatedAt],
    );
  }

  async enqueue(job: QueueJob): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.insertJob(client, job);
    } finally {
      client.release();
    }
  }

  async claim(workspaceId: string, workerId: string, kinds: string[]): Promise<QueueJob | null> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM queue_jobs
         WHERE (status='queued' AND available_at<=now() OR status='running' AND locked_at<now()-interval '5 minutes')
           AND workspace_id=$2
           AND kind=ANY($3::text[])
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE queue_jobs SET status='running', attempts=attempts+1, locked_at=now(), locked_by=$1, updated_at=now()
       WHERE id=(SELECT id FROM candidate) RETURNING *`,
      [workerId, workspaceId, kinds],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? jobFromRow(row) : null;
  }

  async completeJob(id: string): Promise<void> {
    await this.pool.query("UPDATE queue_jobs SET status='completed',updated_at=now() WHERE id=$1", [id]);
  }

  async failJob(id: string, error: string, retryAt: string | null): Promise<void> {
    await this.pool.query(
      "UPDATE queue_jobs SET status=$2,available_at=COALESCE($3,available_at),locked_at=NULL,locked_by=NULL,error=$4,updated_at=now() WHERE id=$1",
      [id, retryAt ? "queued" : "failed", retryAt, error],
    );
  }

  async claimDueSchedule(workspaceId: string, workerId: string, now: string): Promise<EntityMap["schedules"] | null> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT id FROM schedules
         WHERE workspace_id=$1 AND enabled=true AND next_run_at<=$3
           AND (locked_at IS NULL OR locked_at<$3::timestamptz-interval '5 minutes')
         ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE schedules SET locked_at=$3,locked_by=$2
       WHERE id=(SELECT id FROM candidate) RETURNING data`,
      [workspaceId, workerId, now],
    );
    return (result.rows[0]?.data as EntityMap["schedules"] | undefined) ?? null;
  }

  async releaseScheduleClaim(id: string): Promise<void> {
    await this.pool.query("UPDATE schedules SET locked_at=NULL,locked_by=NULL WHERE id=$1", [id]);
  }

  async listPushSubscriptions(workspaceId: string): Promise<PushSubscription[]> {
    const result = await this.pool.query(
      "SELECT token,workspace_id,platform,device_id,created_at,updated_at FROM push_subscriptions WHERE workspace_id=$1",
      [workspaceId],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      token: String(row.token),
      workspaceId: String(row.workspace_id),
      platform: row.platform as "ios" | "android",
      deviceId: row.device_id === null ? null : String(row.device_id),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async putPushSubscription(subscription: PushSubscription): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions(token,workspace_id,platform,device_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(token) DO UPDATE SET workspace_id=excluded.workspace_id,platform=excluded.platform,device_id=excluded.device_id,updated_at=excluded.updated_at`,
      [subscription.token, subscription.workspaceId, subscription.platform, subscription.deviceId, subscription.createdAt, subscription.updatedAt],
    );
  }

  async deletePushSubscription(workspaceId: string, token: string): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM push_subscriptions WHERE workspace_id=$1 AND token=$2", [workspaceId, token]);
    return Boolean(result.rowCount);
  }
}
