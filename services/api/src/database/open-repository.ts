import type { RelayConfig } from "../config.js";
import type { RelayRepository } from "./repository.js";
import { MemoryRelayRepository } from "./memory-repository.js";
import { PostgresRelayRepository } from "./postgres-repository.js";

export async function openRepository(config: RelayConfig): Promise<RelayRepository> {
  if (config.databaseUrl) {
    const postgres = new PostgresRelayRepository(config.databaseUrl);
    try {
      await postgres.initialize();
      return postgres;
    } catch (error) {
      await postgres.close().catch(() => undefined);
      if (config.requireDatabase) throw error;
      process.stderr.write(`PostgreSQL unavailable; using ephemeral in-memory storage: ${String(error)}\n`);
    }
  }
  const memory = new MemoryRelayRepository();
  await memory.initialize();
  return memory;
}
