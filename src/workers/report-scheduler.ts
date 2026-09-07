import { db } from "@/lib/db";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { getLocalClock } from "@/modules/reports/time";
import { getDailyReportJobs } from "./report-scheduler-policy";

const queue = new LocalJobQueue();
async function tick() {
  const channels = await db.channel.findMany({ where: { status: "ACTIVE" }, select: { id: true, timezone: true } });
  for (const channel of channels) { const clock = getLocalClock(channel.timezone); for (const job of getDailyReportJobs(clock)) await queue.enqueue(job, { channelId: channel.id }, `${job}:${channel.id}:${clock.date}`); }
}
void tick();
setInterval(() => { void tick(); }, 60_000);
