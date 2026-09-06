import { describe, expect, it } from "vitest";
import { getDailyReportJobs } from "./report-scheduler-policy";

describe("daily report scheduler policy", () => {
  it("prepares during the 05:00 window and publishes during the 06:00 window", () => {
    expect(getDailyReportJobs({ date: "2026-09-06", hour: 5, minute: 5 })).toEqual(["daily.report.prepare"]);
    expect(getDailyReportJobs({ date: "2026-09-06", hour: 6, minute: 0 })).toEqual(["daily.report.publish"]);
  });
  it("is quiet outside the ten-minute windows", () => {
    expect(getDailyReportJobs({ date: "2026-09-06", hour: 5, minute: 10 })).toEqual([]);
    expect(getDailyReportJobs({ date: "2026-09-06", hour: 7, minute: 0 })).toEqual([]);
  });
});
