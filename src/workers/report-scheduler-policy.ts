import type { LocalClock } from "@/modules/reports/time";

export type ReportJob = "daily.report.prepare" | "daily.report.publish";

export function getDailyReportJobs(clock: LocalClock): ReportJob[] {
  if (clock.minute >= 10) return [];
  if (clock.hour === 5) return ["daily.report.prepare"];
  if (clock.hour === 6) return ["daily.report.publish"];
  return [];
}
