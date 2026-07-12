#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT_DIR/backend/dist"

(
  cd "$ROOT_DIR/backend"
  GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o dist/bootstrap ./cmd/api
  cd dist
  zip -q -r bootstrap.zip bootstrap
)

echo "Built backend/dist/bootstrap.zip"

