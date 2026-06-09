import { randomUUID } from "node:crypto";

export class TransactionContext {
  constructor({ name, metadata = {}, projectId, user }) {
    this.id = randomUUID();
    this.name = name;
    this.metadata = metadata;
    this.projectId = projectId;
    this.user = user;
    this.startedAt = new Date().toISOString();
    this.completedSteps = [];
    this.results = {};
  }

  setResult(stepName, result) {
    this.results[stepName] = result;
  }
}
