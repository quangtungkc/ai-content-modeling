import type { PrismaClient, Channel } from "@prisma/client";

export interface ChannelRepository {
  findByIdForUser(id: string, userId: string): Promise<Channel | null>;
}

export class PrismaChannelRepository implements ChannelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByIdForUser(id: string, userId: string) {
    return this.prisma.channel.findFirst({ where: { id, userId } });
  }
}
