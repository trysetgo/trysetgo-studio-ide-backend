import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { compensationHandler } from "./CompensationHandler.mjs";
import { TransactionContext } from "./TransactionContext.mjs";

export class TransactionCoordinator {
  async run({ name, metadata = {}, projectId, steps, user }) {
    const context = new TransactionContext({ name, metadata, projectId, user });
    await this.audit("Transaction.Started", context);

    try {
      for (const step of steps) {
        const result = await step.execute(context);
        context.completedSteps.push(step);
        context.setResult(step.name, result);
      }

      await this.audit("Transaction.Committed", context);
      return {
        ok: true,
        context,
        results: context.results
      };
    } catch (error) {
      const compensationFailures = await compensationHandler.rollback(context);
      await this.audit("Transaction.RolledBack", context, {
        error: error instanceof Error ? error.message : "Transaction failed.",
        compensationFailures
      });
      await this.audit("Transaction.Failed", context, {
        error: error instanceof Error ? error.message : "Transaction failed."
      });
      throw error;
    }
  }

  async audit(action, context, metadata = {}) {
    await rbacRepository.recordAuditEvent({
      action,
      projectId: context.projectId,
      user: context.user,
      metadata: {
        transactionId: context.id,
        transactionName: context.name,
        ...context.metadata,
        ...metadata
      }
    });
  }
}

export const transactionCoordinator = new TransactionCoordinator();
