#!/bin/bash
# Phase 2 Quick Start Script
# Run this from the backend directory

set -e

echo "🚀 Phase 2 - Product Catalog Quick Start"
echo "========================================"

echo ""
echo "📦 Step 1: Installing dependencies..."
npm install

echo ""
echo "🔄 Step 2: Generating Prisma client..."
npm run prisma:generate

echo ""
echo "🗃️  Step 3: Creating database migration..."
npx prisma migrate dev --name phase2_product_catalog

echo ""
echo "🌱 Step 4: Seeding database..."
npm run prisma:seed

echo ""
echo "✅ Phase 2 setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start the backend: npm run start:dev"
echo "  2. Run tests: npm run test:e2e"
echo "  3. Check API at http://localhost:3000"
echo ""
echo "📚 Documentation:"
echo "  - API endpoints: See docs/PHASE2.md"
echo "  - Implementation: See PHASE2_IMPLEMENTATION.md"
echo "  - Checklist: See PHASE2_CHECKLIST.md"
echo ""
