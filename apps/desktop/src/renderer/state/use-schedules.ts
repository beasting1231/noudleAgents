import type { RelayApiClient } from "@noudle-agents/api-client";
import type { CreateScheduleInput, Schedule, UpdateScheduleInput } from "@noudle-agents/protocol";
import { useCallback, useEffect, useState } from "react";
import type { ConnectionMode } from "./relay-state";

const demoSchedules: Schedule[] = [
  {
    id: "schedule-demo-digest",
    workspaceId: "workspace_local",
    triggerType: "cron",
    agentId: "agent-orbit",
    conversationId: "conversation-orbit",
    title: "Morning project digest",
    prompt: "Review active work and send me a concise progress digest with blockers.",
    cronExpression: "0 9 * * 1-5",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    enabled: true,
    nextRunAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    lastRunAt: null,
    latestRunId: null,
    webhookToken: null,
    createdByType: "user",
    createdById: "user_local_owner",
    createdAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function useSchedules(client: RelayApiClient, connection: ConnectionMode, cursor: number) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (connection === "live") {
      try {
        const next = await client.listSchedules();
        setSchedules(next);
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Schedules could not be loaded.");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (connection === "demo") {
      setSchedules((current) => current.length > 0 ? current : structuredClone(demoSchedules));
      setLoading(false);
    }
  }, [client, connection]);

  useEffect(() => { void sync(); }, [sync, cursor]);

  const createSchedule = useCallback(async (input: CreateScheduleInput) => {
    if (connection === "live") {
      const schedule = await client.createSchedule(input);
      setSchedules((current) => [...current, schedule]);
      return schedule;
    }
    const now = new Date().toISOString();
    const triggerType = input.triggerType ?? "cron";
    const schedule: Schedule = {
      id: `schedule-${crypto.randomUUID()}`,
      workspaceId: "workspace_local",
      triggerType,
      agentId: input.agentId,
      conversationId: input.conversationId ?? "conversation-orbit",
      title: input.title,
      prompt: input.prompt,
      cronExpression: input.cronExpression ?? "0 9 * * *",
      timezone: input.timezone ?? "UTC",
      enabled: input.enabled ?? true,
      nextRunAt: input.enabled === false || triggerType === "webhook" ? null : new Date(Date.now() + 60 * 60_000).toISOString(),
      lastRunAt: null,
      latestRunId: null,
      webhookToken: triggerType === "webhook" ? crypto.randomUUID().replaceAll("-", "") : null,
      createdByType: "user",
      createdById: "user_local_owner",
      createdAt: now,
      updatedAt: now,
    };
    setSchedules((current) => [...current, schedule]);
    return schedule;
  }, [client, connection]);

  const updateSchedule = useCallback(async (id: string, input: UpdateScheduleInput) => {
    if (connection === "live") {
      const schedule = await client.updateSchedule(id, input);
      setSchedules((current) => current.map((candidate) => candidate.id === id ? schedule : candidate));
      return schedule;
    }
    const current = schedules.find((candidate) => candidate.id === id);
    if (!current) throw new Error("Schedule not found.");
    const triggerType = input.triggerType ?? current.triggerType;
    const schedule: Schedule = {
      ...current,
      triggerType,
      agentId: input.agentId ?? current.agentId,
      conversationId: input.conversationId ?? current.conversationId,
      title: input.title ?? current.title,
      prompt: input.prompt ?? current.prompt,
      cronExpression: input.cronExpression ?? current.cronExpression,
      timezone: input.timezone ?? current.timezone,
      enabled: input.enabled ?? current.enabled,
      nextRunAt: input.enabled === false || triggerType === "webhook" ? null : (current.nextRunAt ?? new Date(Date.now() + 60 * 60_000).toISOString()),
      webhookToken: triggerType === "webhook" ? (current.webhookToken ?? crypto.randomUUID().replaceAll("-", "")) : null,
      updatedAt: new Date().toISOString(),
    };
    setSchedules((items) => items.map((candidate) => candidate.id === id ? schedule : candidate));
    return schedule;
  }, [client, connection, schedules]);

  const deleteSchedule = useCallback(async (id: string) => {
    if (connection === "live") await client.deleteSchedule(id);
    setSchedules((current) => current.filter((candidate) => candidate.id !== id));
  }, [client, connection]);

  const webhookUrl = useCallback((schedule: Schedule) => schedule.triggerType === "webhook" && schedule.webhookToken
    ? `${client.baseUrl}/v1/webhooks/${encodeURIComponent(schedule.id)}/${encodeURIComponent(schedule.webhookToken)}`
    : null, [client.baseUrl]);

  return { schedules, loading, error, sync, createSchedule, updateSchedule, deleteSchedule, webhookUrl };
}
