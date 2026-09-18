import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { TroubleshootingIncident } from "./incident-schema";
import { ensureTroubleshootingStorage } from "./storage";

export type AuditEvent = { type: string; payload: Record<string, unknown>; createdAt?: string };
export type IncidentPersistence = {
  upsertIncident(incident: TroubleshootingIncident, fingerprint: string, status: string): Promise<void>;
  appendAudit(incidentId: string, event: AuditEvent): Promise<void>;
};

export function prismaIncidentPersistence(): IncidentPersistence {
  return {
    upsertIncident: async (incident, fingerprint, status) => {
      const updatedAt = new Date();
      await db.troubleshootingIncident.upsert({ where: { id: incident.incidentId }, update: { fingerprint, projectId: incident.projectId, sceneNumber: incident.sceneNumber, stage: incident.stage, component: incident.component, status, document: incident as unknown as Prisma.InputJsonValue, checkpoint: incident.checkpoint as Prisma.InputJsonValue, attemptCount: incident.attemptCount, updatedAt }, create: { id: incident.incidentId, fingerprint, projectId: incident.projectId, sceneNumber: incident.sceneNumber, stage: incident.stage, component: incident.component, status, document: incident as unknown as Prisma.InputJsonValue, checkpoint: incident.checkpoint as Prisma.InputJsonValue, attemptCount: incident.attemptCount, updatedAt } });
    },
    appendAudit: async (incidentId, event) => { await db.troubleshootingIncidentAudit.create({ data: { incidentId, type: event.type, payload: event.payload as Prisma.InputJsonValue, createdAt: event.createdAt ? new Date(event.createdAt) : new Date() } }); },
  };
}

export class TroubleshootingIncidentRepository {
  constructor(private readonly persistence: IncidentPersistence = prismaIncidentPersistence(), private readonly ensureStorage: () => Promise<void> = ensureTroubleshootingStorage) {}
  async record(incident: TroubleshootingIncident, fingerprint: string, status: string) { await this.ensureStorage(); await this.persistence.upsertIncident(incident, fingerprint, status); }
  async audit(incidentId: string, type: string, payload: Record<string, unknown>) { await this.ensureStorage(); await this.persistence.appendAudit(incidentId, { type, payload }); }
}
