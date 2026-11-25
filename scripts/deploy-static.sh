#!/usr/bin/env bash
set -euo pipefail

# Also use this entry point for manual pause/resume/rollback. flock releases the
# lock on process exit, including crashes; parallel timer/manual runs do not race.
MTP_DEPLOY_ROOT="${MTP_DEPLOY_ROOT:-/srv/mtp}"
export MTP_DEPLOY_ROOT
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec flock -n "${MTP_DEPLOY_ROOT}/state/deploy.lock" \
  env MTP_DEPLOY_LOCKED=1 node "${SCRIPT_DIR}/deploy-static.mjs" "$@"
