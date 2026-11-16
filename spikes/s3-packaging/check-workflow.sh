#!/usr/bin/env bash
# The spike workflow may hold no secret references and no deployment
# environment (Global Constraints). Kept in a script so the pattern does not
# match its own line in the workflow file. Run from the repository root.
set -uo pipefail
if grep -nE 'secrets\.|environment:' .github/workflows/spike-s3.yml; then
  echo "::error::spike-s3.yml references secrets or an environment"
  exit 1
fi
echo "spike-s3.yml: no secret references, no environment"
