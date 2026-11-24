import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { currentProcessSpaceHash, currentProcessStartedAtMs } from "./controller-process-identity.js";
import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { PROCESS_IDENTITY_RECORDED, recordedLocalExecutionStopped } from "./native-local-process-stop.js";

const support = await getEmbeddedPostgresTestSupport();

// Phase 2: a bound local execution is judged by the shared prover
// (proveOwnerGone), in the PID space the row recorded.
(support.supported ? describe : describe.skip)("recordedLocalExecutionStopped", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let companyId: string;
  let agentId: string;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("native-local-stop-");
    db = createDb(database.connectionString, { maxConnections: 2 });
    companyId = randomUUID(); agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Local stop", issuePrefix: `L${companyId.slice(0, 7)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Agent", role: "general", adapterType: "codex_local",
      status: "idle" });
  }, 60_000);
  afterAll(async () => { await db?.$client.end({ timeout: 1 }); await database?.cleanup(); });

  /** A failed run with its process identity bound by the launch event. */
  async function execution(input: { pid: number; startedAt: Date; processHostHash: string | null; host?: string }) {
    const [run] = await db.insert(heartbeatRuns).values({ companyId, agentId, status: "failed", runtimeMode: "native",
      processPid: input.pid, processGroupId: input.pid, processStartedAt: input.startedAt,
      processHostHash: input.processHostHash }).returning();
    await appendHeartbeatRunEvent(db, { companyId, runId: run!.id, agentId, eventType: PROCESS_IDENTITY_RECORDED,
      payload: { targetKind: "local", hostname: input.host ?? hostname(), processPid: input.pid, processGroupId: input.pid,
        processStartedAt: input.startedAt.toISOString() } });
    return run!;
  }
  const deadPid = 2_000_000_001;
  const minuteAgo = () => new Date(Date.now() - 60_000);
  const ownStart = async () => new Date((await currentProcessStartedAtMs())!);

  it("is stopped when its dead PID was recorded in this PID space", async () => {
    expect(await recordedLocalExecutionStopped(db, await execution({ pid: deadPid, startedAt: minuteAgo(),
      processHostHash: currentProcessSpaceHash() }))).toBe(true);
  });

  it("is never stopped by a dead PID recorded in another PID space", async () => {
    expect(await recordedLocalExecutionStopped(db, await execution({ pid: deadPid, startedAt: minuteAgo(),
      processHostHash: "another-pid-space" }))).toBe(false);
  });

  // Fork: a redeploy recreates the container, so its hostname and PID space change (AMP-553).
  it("is stopped when recorded in an earlier container of a single-container instance", async () => {
    const beforeThisServer = new Date((await ownStart()).getTime() - 60_000);
    const earlier = { pid: deadPid, startedAt: beforeThisServer, host: "5d0841dec740" };
    expect(await recordedLocalExecutionStopped(db, await execution({ ...earlier, processHostHash: null }))).toBe(false);
    vi.stubEnv("PAPERCLIP_EXCLUSIVE_INSTANCE_CONTAINER", "true");
    try {
      expect(await recordedLocalExecutionStopped(db, await execution({ ...earlier, processHostHash: null }))).toBe(true);
      expect(await recordedLocalExecutionStopped(db, await execution({ ...earlier, processHostHash: "another-pid-space" }))).toBe(true);
      // Recorded after this server started: not an earlier container.
      expect(await recordedLocalExecutionStopped(db, await execution({ ...earlier, startedAt: new Date(),
        processHostHash: null }))).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it("keeps the host-bound proof for a row saved before its PID space", async () => {
    expect(await recordedLocalExecutionStopped(db, await execution({ pid: deadPid, startedAt: minuteAgo(),
      processHostHash: null }))).toBe(true);
  });

  it("is not stopped while the same process is alive", async () => {
    expect(await recordedLocalExecutionStopped(db, await execution({ pid: process.pid, startedAt: await ownStart(),
      processHostHash: currentProcessSpaceHash() }))).toBe(false);
  });

  it("is stopped when a later process reused its PID and leads the group", async () => {
    // This test process started definitely after the recorded execution.
    const recorded = new Date((await ownStart()).getTime() - 5_000);
    // A group with this id is either empty or led by this later process, so
    // it cannot hold the recorded execution's children.
    expect(await recordedLocalExecutionStopped(db, await execution({ pid: process.pid, startedAt: recorded,
      processHostHash: currentProcessSpaceHash() }))).toBe(true);
  });
});
