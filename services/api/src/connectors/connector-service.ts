import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { ConnectorProvider, ConnectorSummary } from "@noudle-agents/protocol";
import type { RelayConfig } from "../config.js";
import type { RelayRepository } from "../database/repository.js";
import { DomainError } from "../domain/errors.js";
import type { RelayService } from "../domain/relay-service.js";
import type { ConnectorRecord } from "../model.js";

export type ConnectorFetch = (input: string, init?: RequestInit) => Promise<Response>;

const providers: ConnectorProvider[] = ["github", "resend", "notion", "stripe"];

const credentialNames: Record<ConnectorProvider, string> = {
  github: "GitHub token",
  resend: "Resend API key",
  notion: "Notion integration token",
  stripe: "Stripe API key",
};

export class ConnectorService {
  private readonly key: Buffer;

  constructor(
    private readonly repository: RelayRepository,
    private readonly relay: RelayService,
    private readonly config: RelayConfig,
    private readonly fetcher: ConnectorFetch = fetch,
  ) {
    this.key = createHash("sha256").update(config.connectorSecretKey).digest();
  }

  private id(provider: ConnectorProvider): string {
    return `cnr_${createHash("sha256").update(`${this.config.workspaceId}:${provider}`).digest("hex").slice(0, 32)}`;
  }

  private encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString("base64url")).join(".");
  }

  private summary(provider: ConnectorProvider, record: ConnectorRecord | null): ConnectorSummary {
    return {
      provider,
      connected: Boolean(record),
      accountLabel: record?.accountLabel ?? null,
      connectedAt: record?.connectedAt ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  async list(): Promise<ConnectorSummary[]> {
    const records = await this.repository.list("connectors", this.config.workspaceId);
    return providers.map((provider) => this.summary(provider, records.find((record) => record.provider === provider) ?? null));
  }

  private async verify(provider: ConnectorProvider, secret: string): Promise<string> {
    try {
      if (provider === "github") {
        const response = await this.fetcher("https://api.github.com/user", {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${secret}`,
            "user-agent": "noudleAgents",
            "x-github-api-version": "2026-03-10",
          },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { login?: unknown };
        if (typeof body.login !== "string" || !body.login) throw new Error("missing login");
        return `@${body.login}`;
      }
      if (provider === "resend") {
        const response = await this.fetcher("https://api.resend.com/domains", {
          headers: { authorization: `Bearer ${secret}` },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { data?: Array<{ name?: unknown }> };
        const domains = Array.isArray(body.data)
          ? body.data.map(({ name }) => typeof name === "string" ? name : null).filter((name): name is string => Boolean(name))
          : [];
        return domains[0] ?? "Resend";
      }
      if (provider === "notion") {
        const response = await this.fetcher("https://api.notion.com/v1/users/me", {
          headers: {
            authorization: `Bearer ${secret}`,
            "notion-version": "2026-03-11",
          },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.json() as { name?: unknown; bot?: { workspace_name?: unknown } };
        if (typeof body.bot?.workspace_name === "string" && body.bot.workspace_name) return body.bot.workspace_name;
        return typeof body.name === "string" && body.name ? body.name : "Notion";
      }
      const response = await this.fetcher("https://api.stripe.com/v1/balance", {
        headers: { authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}` },
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as { livemode?: unknown };
      return body.livemode === true ? "Live account" : "Test account";
    } catch {
      throw new DomainError(400, "connector_auth_failed", `The ${credentialNames[provider]} could not be verified`);
    }
  }

  async connect(
    provider: ConnectorProvider,
    secret: string,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<ConnectorSummary> {
    const normalized = secret.trim();
    if (normalized.length < 10) throw new DomainError(400, "connector_secret_invalid", "Enter a valid credential");
    const accountLabel = await this.verify(provider, normalized);
    const existing = await this.repository.get("connectors", this.id(provider));
    const now = new Date().toISOString();
    const record: ConnectorRecord = {
      id: this.id(provider),
      workspaceId: this.config.workspaceId,
      provider,
      accountLabel,
      encryptedSecret: this.encrypt(normalized),
      connectedAt: existing?.connectedAt ?? now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.put("connectors", record);
    const connector = this.summary(provider, record);
    await this.relay.emit({
      workspaceId: this.config.workspaceId,
      aggregateType: "connector",
      aggregateId: record.id,
      type: "connector.updated",
      actorType,
      actorId,
      payload: { action: "connected", connector },
    });
    return connector;
  }

  async disconnect(
    provider: ConnectorProvider,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<void> {
    const id = this.id(provider);
    await this.repository.delete("connectors", id);
    await this.relay.emit({
      workspaceId: this.config.workspaceId,
      aggregateType: "connector",
      aggregateId: id,
      type: "connector.updated",
      actorType,
      actorId,
      payload: { action: "disconnected", connector: this.summary(provider, null) },
    });
  }
}
