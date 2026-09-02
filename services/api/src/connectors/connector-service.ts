import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  ConnectorAuthType,
  ConnectorProvider,
  ConnectorRequestInput,
  ConnectorResponse,
  ConnectorSummary,
  CreateCustomConnectorInput,
} from "@noudle-agents/protocol";
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

const builtinMeta: Record<ConnectorProvider, {
  name: string;
  baseUrl: string;
  authType: ConnectorAuthType;
  headerName: string | null;
  authPrefix: string;
}> = {
  github: { name: "GitHub", baseUrl: "https://api.github.com/", authType: "bearer", headerName: null, authPrefix: "Bearer " },
  resend: { name: "Resend", baseUrl: "https://api.resend.com/", authType: "bearer", headerName: null, authPrefix: "Bearer " },
  notion: { name: "Notion", baseUrl: "https://api.notion.com/v1/", authType: "bearer", headerName: null, authPrefix: "Bearer " },
  stripe: { name: "Stripe", baseUrl: "https://api.stripe.com/v1/", authType: "basic", headerName: null, authPrefix: "" },
};

const blockedRequestHeaders = new Set(["authorization", "cookie", "host", "proxy-authorization", "x-api-key"]);

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

  private decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue] = value.split(".");
    if (!ivValue || !tagValue || !encryptedValue) throw new Error("Stored connector secret is invalid");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  }

  private summary(provider: ConnectorProvider, record: ConnectorRecord | null): ConnectorSummary {
    const meta = builtinMeta[provider];
    return {
      id: record?.id ?? this.id(provider),
      provider,
      kind: "builtin",
      name: meta.name,
      baseUrl: meta.baseUrl,
      authType: meta.authType,
      headerName: meta.headerName,
      connected: Boolean(record),
      accountLabel: record?.accountLabel ?? null,
      createdByType: record?.createdByType ?? null,
      createdById: record?.createdById ?? null,
      connectedAt: record?.connectedAt ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  private customSummary(record: ConnectorRecord): ConnectorSummary {
    return {
      id: record.id,
      provider: record.provider,
      kind: "custom",
      name: record.name,
      baseUrl: record.baseUrl,
      authType: record.authType,
      headerName: record.headerName,
      connected: true,
      accountLabel: record.accountLabel,
      createdByType: record.createdByType,
      createdById: record.createdById,
      connectedAt: record.connectedAt,
      updatedAt: record.updatedAt,
    };
  }

  async list(): Promise<ConnectorSummary[]> {
    const records = await this.repository.list("connectors", this.config.workspaceId);
    const builtins = providers.map((provider) => this.summary(provider, records.find((record) => record.provider === provider) ?? null));
    const custom = records.filter((record) => record.kind === "custom").map((record) => this.customSummary(record));
    return [...builtins, ...custom.sort((left, right) => left.name.localeCompare(right.name))];
  }

  private normalizeBaseUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new DomainError(400, "connector_https_required", "Connector base URL must use HTTPS");
    if (url.username || url.password || url.search || url.hash) {
      throw new DomainError(400, "connector_url_invalid", "Connector base URL cannot include credentials, a query, or a fragment");
    }
    const hostname = url.hostname.toLowerCase();
    const ipVersion = isIP(hostname);
    const blockedIpv4 = ipVersion === 4 && (
      hostname.startsWith("10.") || hostname.startsWith("127.") || hostname.startsWith("169.254.") || hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
    const blockedIpv6 = ipVersion === 6 && (hostname === "::1" || hostname.toLowerCase().startsWith("fc") || hostname.toLowerCase().startsWith("fd") || hostname.toLowerCase().startsWith("fe8"));
    if (blockedIpv4 || blockedIpv6 || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      throw new DomainError(400, "connector_host_forbidden", "Connector base URL must use a public host");
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url.toString();
  }

  private async validateAgent(actorType: "user" | "agent", actorId: string): Promise<void> {
    if (actorType === "agent") await this.relay.getAgent(actorId);
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
    await this.validateAgent(actorType, actorId);
    const normalized = secret.trim();
    if (normalized.length < 10) throw new DomainError(400, "connector_secret_invalid", "Enter a valid credential");
    const accountLabel = await this.verify(provider, normalized);
    const existing = await this.repository.get("connectors", this.id(provider));
    const now = new Date().toISOString();
    const record: ConnectorRecord = {
      id: this.id(provider),
      workspaceId: this.config.workspaceId,
      provider,
      kind: "builtin",
      name: builtinMeta[provider].name,
      baseUrl: builtinMeta[provider].baseUrl,
      authType: builtinMeta[provider].authType,
      headerName: builtinMeta[provider].headerName,
      authPrefix: builtinMeta[provider].authPrefix,
      accountLabel,
      encryptedSecret: this.encrypt(normalized),
      createdByType: existing?.createdByType ?? actorType,
      createdById: existing?.createdById ?? actorId,
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

  async createCustom(
    input: CreateCustomConnectorInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<ConnectorSummary> {
    await this.validateAgent(actorType, actorId);
    const secret = input.secret.trim();
    if (secret.length < 3) throw new DomainError(400, "connector_secret_invalid", "Enter a valid credential");
    const baseUrl = this.normalizeBaseUrl(input.baseUrl);
    const headerName = input.authType === "header" ? (input.headerName?.trim() || "X-API-Key") : null;
    if (headerName && !/^[A-Za-z0-9-]+$/.test(headerName)) {
      throw new DomainError(400, "connector_header_invalid", "Connector header name is invalid");
    }
    const now = new Date().toISOString();
    const record: ConnectorRecord = {
      id: `cnr_${randomUUID()}`,
      workspaceId: this.config.workspaceId,
      provider: `custom-${randomUUID()}`,
      kind: "custom",
      name: input.name.trim(),
      baseUrl,
      authType: input.authType,
      headerName,
      authPrefix: input.authType === "bearer" ? "Bearer " : input.authPrefix,
      accountLabel: new URL(baseUrl).hostname,
      encryptedSecret: this.encrypt(secret),
      createdByType: actorType,
      createdById: actorId,
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.put("connectors", record);
    const connector = this.customSummary(record);
    await this.relay.emit({
      workspaceId: this.config.workspaceId,
      aggregateType: "connector",
      aggregateId: record.id,
      type: "connector.updated",
      actorType,
      actorId,
      payload: { action: "created", connector },
    });
    return connector;
  }

  private async record(idOrProvider: string): Promise<ConnectorRecord> {
    const direct = await this.repository.get("connectors", idOrProvider);
    if (direct) return direct;
    const match = (await this.repository.list("connectors", this.config.workspaceId)).find((record) => record.provider === idOrProvider);
    if (!match) throw new DomainError(404, "connector_not_found", "Connector was not found");
    return match;
  }

  async request(
    id: string,
    input: ConnectorRequestInput,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<ConnectorResponse> {
    await this.validateAgent(actorType, actorId);
    const record = await this.record(id);
    const baseUrl = this.normalizeBaseUrl(record.baseUrl ?? builtinMeta[record.provider as ConnectorProvider]?.baseUrl ?? "");
    if (/^[a-z][a-z\d+.-]*:/i.test(input.path) || input.path.split("/").includes("..")) {
      throw new DomainError(400, "connector_path_invalid", "Connector request path must stay under its configured base URL");
    }
    const target = new URL(input.path.replace(/^\/+/, ""), baseUrl);
    if (target.origin !== new URL(baseUrl).origin) throw new DomainError(400, "connector_origin_mismatch", "Connector request cannot change origin");
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      if (!blockedRequestHeaders.has(name.toLowerCase())) headers[name] = value;
    }
    const secret = this.decrypt(record.encryptedSecret);
    if (record.authType === "basic") headers.authorization = `Basic ${Buffer.from(record.provider === "stripe" ? `${secret}:` : secret).toString("base64")}`;
    else if (record.authType === "bearer") headers.authorization = `${record.authPrefix || "Bearer "}${secret}`;
    else headers[record.headerName || "X-API-Key"] = `${record.authPrefix}${secret}`;
    const response = await this.fetcher(target.toString(), {
      method: input.method,
      headers,
      ...(input.method !== "GET" && input.method !== "DELETE" && input.body !== null ? { body: input.body } : {}),
      redirect: "manual",
    });
    const responseHeaders: Record<string, string> = {};
    for (const [name, value] of response.headers.entries()) {
      if (name === "content-type" || name === "retry-after" || name.startsWith("x-ratelimit")) responseHeaders[name] = value;
    }
    const body = (await response.text()).slice(0, 2_000_000);
    await this.relay.emit({
      workspaceId: this.config.workspaceId,
      aggregateType: "connector",
      aggregateId: record.id,
      type: "connector.updated",
      actorType,
      actorId,
      payload: { action: "used", connectorId: record.id, method: input.method, path: target.pathname, status: response.status },
    });
    return { status: response.status, ok: response.ok, headers: responseHeaders, body };
  }

  async disconnect(
    idOrProvider: string,
    actorType: "user" | "agent" = "user",
    actorId = this.config.ownerId,
  ): Promise<void> {
    await this.validateAgent(actorType, actorId);
    const record = await this.record(idOrProvider);
    await this.repository.delete("connectors", record.id);
    const connector = record.kind === "custom" ? { ...this.customSummary(record), connected: false } : this.summary(record.provider as ConnectorProvider, null);
    await this.relay.emit({
      workspaceId: this.config.workspaceId,
      aggregateType: "connector",
      aggregateId: record.id,
      type: "connector.updated",
      actorType,
      actorId,
      payload: { action: record.kind === "custom" ? "deleted" : "disconnected", connector },
    });
  }
}
