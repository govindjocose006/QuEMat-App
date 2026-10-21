#!/usr/bin/env bash
set -euo pipefail
cd /workspace/QuEMat-App
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("QuEMat requires Node.js 24")'
npm --cache /workspace/.cache/npm ci
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
fi
npm run build
# Prepare only the local development database. Hosted Neon changes are explicit operator steps.
DATABASE_URL= VERCEL=0 NODE_ENV=development LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/postgres npm run db:migrate
DATABASE_URL= VERCEL=0 NODE_ENV=development LOCAL_DATABASE_PATH=/workspace/QuEMat-App/data/postgres npm run db:seed
