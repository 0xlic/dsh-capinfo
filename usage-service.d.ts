import { Service, type Context } from '@deepseek-ai/cordis';

export interface CapinfoDailyUsage {
  /** YYYY-MM-DD in Asia/Shanghai. */
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Upstream reported total; already includes caches, do not add them again. */
  totalTokens: number;
  /** Responses carrying valid usage, not user conversation turns. */
  requests: number;
  updatedAt: string | null;
  /** CNY used delta since the day's first successful sample; null means unsampled. */
  amount: number | null;
  amountUpdatedAt: string | null;
}
export interface CapinfoSpendingStatus {
  status: 'pending' | 'ready' | 'unconfigured' | 'error';
  checkedAt: string | null;
  /** Fixed safe error; never contains upstream response text or credentials. */
  error: string | null;
}
/** The dashboard headline for today, as raw values for other plugins to format. */
export interface CapinfoTodayUsage {
  /** Today's CNY cost, sampled delta at full precision (format for display);
   * null means not sampled yet, never zero. */
  amount: number | null;
  /** Today's total tokens; already includes caches, do not add them again. */
  tokens: number;
  /** ISO time of the balance sample behind `amount` (the dashboard's refresh time);
   * null before the day's first successful sample. */
  refreshedAt: string | null;
}
export interface CapinfoUsageSnapshot extends CapinfoDailyUsage {
  timeZone: 'Asia/Shanghai';
  /** Latest persistence failed; in-memory counts remain available. */
  persistenceError: boolean;
  /** Ascending date order, at most the latest 30 calendar days including today.
   * Missing dates are not fabricated; snapshots do not expose raw used or key identity. */
  history: CapinfoDailyUsage[];
  spending: CapinfoSpendingStatus;
}
export class CapinfoUsageService extends Service {
  constructor(ctx: Context, usage: {snapshot(): CapinfoUsageSnapshot});
  getSnapshot(): CapinfoUsageSnapshot;
  /** Today's cost, tokens and refresh time in one call; reads the live snapshot. */
  today(): CapinfoTodayUsage;
}
declare module '@deepseek-ai/cordis' {
  interface Context { capinfoUsage: CapinfoUsageService; }
}
