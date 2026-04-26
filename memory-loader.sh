#!/bin/bash
# Load blocks/ as always-on context for Alfred
# Usage: ./memory-loader.sh (outputs formatted markdown)

set -euo pipefail

BLOCKSDIR="${ALFRED_MEMORY_ROOT:-/alfred}/blocks"

echo "=== BLOCKS (always-on context) ==="
echo ""

for file in "$BLOCKSDIR"/*.yaml; do
  [ -f "$file" ] || continue
  name=$(basename "$file" .yaml | sed 's/_/ / /g')
  echo "## ${name^}"
  echo '```yaml'
  cat "$file"
  echo '```'
  echo ""
done

echo "=== END BLOCKS ==="
