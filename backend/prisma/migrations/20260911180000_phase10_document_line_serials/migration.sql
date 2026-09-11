-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "valid_from" SET DEFAULT '1970-01-01';

-- CreateTable
CREATE TABLE "document_line_serials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "serial_number" TEXT NOT NULL,
    "serial_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_line_serials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_line_serials_tenant_id_document_type_line_id_idx" ON "document_line_serials"("tenant_id", "document_type", "line_id");

-- AddForeignKey
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_line_serials" ADD CONSTRAINT "document_line_serials_serial_id_fkey" FOREIGN KEY ("serial_id") REFERENCES "serial_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

