import Redis from "ioredis";
import { getRequiredRedisUrl } from "@/lib/env";
import { db } from "@/lib/db";
import { RedisJobQueue } from "@/lib/jobs/queue";
import { getLocalClock } from "@/modules/reports/time";
import { getDailyReportJobs } from "./report-scheduler-policy";

const redis = new Redis(getRequiredRedisUrl());
const queue = new RedisJobQueue(redis);
async function tick() {
  const channels = await db.channel.findMany({ where: { status: "ACTIVE" }, select: { id: true, timezone: true } });
  for (const channel of channels) { const clock = getLocalClock(channel.timezone); for (const job of getDailyReportJobs(clock)) await queue.enqueue(job, { channelId: channel.id }, `${job}:${channel.id}:${clock.date}`); }
}
void tick();
setInterval(() => { void tick(); }, 60_000);
