import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const samples = [
  ["funny-animals", "Funny Animals", "TikTok", "Comedy", "US"],
  ["science-lab", "Science Lab", "YouTube", "Education", "Germany"],
  ["kids-stories", "Kids Stories", "TikTok", "Kids", "Vietnam"],
] as const;

async function main() {
  await prisma.user.upsert({ where: { id: "demo-user" }, update: {}, create: { id: "demo-user", email: "demo@example.com", name: "Demo User" } });
  for (const [id, name, platform, topic, targetCountry] of samples) await prisma.channel.upsert({ where: { id }, update: { name, platform, topic, targetCountry }, create: { id, userId: "demo-user", name, platform, topic, targetCountry, language: "English", audience: "General audience", contentStyle: "Short-form", visualStyle: "Stylized", timezone: "UTC", mustKeep: [], mustAvoid: [] } });
}

main().finally(() => prisma.$disconnect());
