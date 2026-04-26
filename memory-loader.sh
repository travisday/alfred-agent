#!/bin/bash
# Load blocks/ as always-on context for Alfred
# Usage: ./memory-loader.sh (outputs formatted markdown)

set -euo pipefail

BLOCKSDIR="${ALFRED_MEMORY_ROOT:-/alfred}/blocks"

echo "=== BLOCKS (always-on context) ==="
echo ""

for file in "$BLOCKSDIR"/*.yaml; do
  [ -f "$file" ] || continue
  # sed: underscores → spaces; awk: capitalize first letter (portable vs bash ${name^})
  display_name=$(basename "$file" .yaml | sed 's/_/ /g' | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  echo "## ${display_name}"
  echo '```yaml'
  cat "$file"
  echo '```'
  echo ""
done

echo "=== END BLOCKS ==="
