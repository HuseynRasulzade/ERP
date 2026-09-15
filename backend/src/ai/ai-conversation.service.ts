import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AIConversationService {
  constructor(private readonly prisma: PrismaService) {}

  start(tenantId: string, userId: string, assistantCode: string, organizationId?: string, title?: string) {
    return this.prisma.aIConversation.create({ data: { tenantId, userId, assistantCode, organizationId, title } });
  }

  list(tenantId: string, userId: string) {
    return this.prisma.aIConversation.findMany({ where: { tenantId, userId }, orderBy: { startedAt: 'desc' } });
  }

  close(tenantId: string, id: string) {
    return this.prisma.aIConversation.update({ where: { id }, data: { status: 'CLOSED' } });
  }
}
