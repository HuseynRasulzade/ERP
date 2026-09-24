import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PermissionCodes as P } from '../rbac/permission-codes';
import { CreateAttributeDto, CreateBankAccountDto, CreateEmployeeDto, CreatePersonnelDocumentDto, CreatePhysicalPersonDto, DuplicateCheckDto, UpdateEmployeeDto, UpdatePhysicalPersonDto } from './dto/hr.dto';
import { HrCtx, HrRequestContext } from './hr-context.decorator';
import { PhysicalPersonService } from './physical-person.service';
import { EmployeeService } from './employee.service';

/** Physical persons, employees and personnel documents (spec 4-7, 55-60, 112). */
@Controller('hr')
export class HrPeopleController {
  constructor(
    private readonly persons: PhysicalPersonService,
    private readonly employees: EmployeeService,
  ) {}

  @RequirePermissions(P.HR_PERSON_VIEW)
  @Get('persons')
  listPersons(@HrCtx() c: HrRequestContext, @Query('search') search?: string, @Query('active') active?: string) {
    return this.persons.list(c.tenantId, { search, active });
  }

  @RequirePermissions(P.HR_PERSON_CREATE)
  @Post('persons')
  async createPerson(@HrCtx() c: HrRequestContext, @Body() dto: CreatePhysicalPersonDto) {
    const { person, duplicateWarnings } = await this.persons.create(c.tenantId, c.userId, dto);
    return { ...person, duplicateWarnings };
  }

  @RequirePermissions(P.HR_PERSON_VIEW)
  @Post('persons/duplicate-check')
  duplicateCheck(@HrCtx() c: HrRequestContext, @Body() dto: DuplicateCheckDto) {
    return this.persons.findDuplicates(c.tenantId, dto);
  }

  @RequirePermissions(P.HR_PERSON_VIEW)
  @Get('persons/:id')
  getPerson(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.persons.get(c.tenantId, id, c.userId);
  }

  @RequirePermissions(P.HR_PERSON_EDIT)
  @Patch('persons/:id')
  updatePerson(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: UpdatePhysicalPersonDto) {
    return this.persons.update(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employees')
  listEmployees(@HrCtx() c: HrRequestContext, @Query('search') search?: string, @Query('status') status?: string) {
    return this.employees.list(c.tenantId, { search, status });
  }

  @RequirePermissions(P.HR_EMPLOYEE_CREATE)
  @Post('employees')
  createEmployee(@HrCtx() c: HrRequestContext, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(c.tenantId, c.userId, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employees/:id')
  getEmployee(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Query('asOf') asOf?: string) {
    return this.employees.getCard(c.tenantId, c.membershipId, id, asOf);
  }

  @RequirePermissions(P.HR_EMPLOYEE_CREATE)
  @Patch('employees/:id')
  updateEmployee(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employees.update(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('employees/:id/attributes')
  listAttributes(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.employees.listAttributes(c.tenantId, id);
  }

  @RequirePermissions(P.HR_EMPLOYMENT_CREATE)
  @Post('employees/:id/attributes')
  addAttribute(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: CreateAttributeDto) {
    return this.employees.addAttribute(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_VIEW_BANK_INFO)
  @Get('employees/:id/bank-accounts')
  listBankAccounts(@HrCtx() c: HrRequestContext, @Param('id') id: string) {
    return this.employees.listBankAccounts(c.tenantId, id);
  }

  @RequirePermissions(P.HR_VIEW_BANK_INFO)
  @Post('employees/:id/bank-accounts')
  addBankAccount(@HrCtx() c: HrRequestContext, @Param('id') id: string, @Body() dto: CreateBankAccountDto) {
    return this.employees.addBankAccount(c.tenantId, c.userId, id, dto);
  }

  @RequirePermissions(P.HR_EMPLOYEE_VIEW)
  @Get('documents')
  listDocuments(@HrCtx() c: HrRequestContext, @Query('ownerType') ownerType: string, @Query('ownerId') ownerId: string) {
    return this.employees.listDocuments(c.tenantId, ownerType, ownerId);
  }

  @RequirePermissions(P.HR_EMPLOYMENT_CREATE)
  @Post('documents')
  addDocument(@HrCtx() c: HrRequestContext, @Body() dto: CreatePersonnelDocumentDto) {
    return this.employees.addDocument(c.tenantId, c.userId, dto);
  }
}
