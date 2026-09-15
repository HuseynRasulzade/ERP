import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundAppError } from '../common/errors/app-error';

/**
 * DashboardService (docx spec Phase 24, sections 109-112, 150-152). A
 * dashboard's `widgets` are stored as a governed JSON array of
 * `{code, type, title, measureCode|kpiCode, dimensions, filters}`
 * entries rather than a separate `DashboardWidget` table (spec section
 * 110 lists widget TYPES as a rendering concern, not a relational one —
 * disclosed simplification, docs/MANAGEMENT_REPORTING.md section L).
 * Every widget references a governed measure/KPI code — this service
 * never accepts or stores raw SQL (spec section 151).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: { code: string; name: string; audience?: string; semanticModelVersionId?: string; widgets: Record<string, unknown>[] }) {
    return this.prisma.managementDashboard.create({ data: { tenantId, code: dto.code, name: dto.name, audience: dto.audience, semanticModelVersionId: dto.semanticModelVersionId, widgets: dto.widgets as object, status: 'DRAFT' } });
  }

  async get(tenantId: string, id: string) {
    const dashboard = await this.prisma.managementDashboard.findFirst({ where: { id, tenantId } });
    if (!dashboard) throw new NotFoundAppError('ManagementDashboard', id);
    return dashboard;
  }

  list(tenantId: string) {
    return this.prisma.managementDashboard.findMany({ where: { tenantId } });
  }

  async publish(tenantId: string, id: string) {
    const dashboard = await this.get(tenantId, id);
    return this.prisma.managementDashboard.update({ where: { id: dashboard.id }, data: { status: 'PUBLISHED' } });
  }
}
