export class CompensationHandler {
  async rollback(context) {
    const failures = [];
    for (const step of [...context.completedSteps].reverse()) {
      if (typeof step.compensate !== "function") {
        continue;
      }

      try {
        await step.compensate(context);
      } catch (error) {
        failures.push({
          step: step.name,
          error: error instanceof Error ? error.message : "Compensation failed."
        });
      }
    }

    return failures;
  }
}

export const compensationHandler = new CompensationHandler();
