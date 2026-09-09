#!/bin/bash
# Phase 3 Quick Start Script (also completes any pending Phase 2 DB work)
# Run this from the backend directory:
#   cd "C:\Users\cafar\OneDrive\Desktop\ERP-main\ERP-main\backend"
#
# IMPORTANT: re-running the seed is mandatory, not optional. The Phase 2/3
# permission codes (unit_of_measure.*, product_*, unit_conversion.*,
# counterparty.*, price_list.*, product_price.*) are granted to TENANT_ADMIN
# at seed time — a DB seeded before Phase 2/3 will 403 on every new endpoint
# until `npm run prisma:seed` runs again (seed is idempotent via upserts).

set -e

echo "Phase 3 - Counterparty & Pricing Quick Start"
echo "============================================"

echo ""
echo "[1/5] Installing dependencies..."
npm install

echo ""
echo "[2/5] Generating Prisma client..."
npm run prisma:generate

echo ""
echo "[3/5] Creating database migration (Phase 2 + Phase 3)..."
npx prisma migrate dev --name phase2_product_catalog_phase3_pricing

echo ""
echo "[4/5] Seeding database (permissions, currencies, enums)..."
npm run prisma:seed

echo ""
echo "[5/5] Typechecking..."
npx tsc --noEmit -p tsconfig.json

echo ""
echo "Setup complete! Next:"
echo "  1. Start the backend: npm run start:dev"
echo "  2. Run all e2e tests: npm run test:e2e"
echo "     (expects Phase 0 + Phase 1 + Phase 2 + Phase 3 suites green)"
