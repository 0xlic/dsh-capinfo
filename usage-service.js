import { Service } from '@deepseek-ai/cordis';

/** Read-only daily spending and token history for Host consumers. */
export class CapinfoUsageService extends Service {
  constructor(ctx, usage) {
    super(ctx, 'capinfoUsage');
    this.getSnapshot = () => usage.snapshot();
    // The dashboard headline only: today's cost, today's tokens and the balance
    // sample behind the cost. Raw values, no history or presentation coupling.
    this.today = () => {
      const snapshot = usage.snapshot();
      return {amount: snapshot.amount, tokens: snapshot.totalTokens, refreshedAt: snapshot.amountUpdatedAt};
    };
  }
}
