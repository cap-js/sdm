#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# cf-logs-diagnose.sh — Filter recent CF app logs for subscription/onboarding
# errors. Useful after a SUBSCRIBE_FAILED to see what the app actually logged.
#
# Usage:
#   ./cf-logs-diagnose.sh [--app <appName>] [--lines <N>]
#
# If --app is not provided, uses MT_APP_NAME from credentials.json.
# --lines defaults to 100.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

CLI_APP=""
LINES=100
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)   CLI_APP="$2"; shift 2 ;;
    --lines) LINES="$2";   shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found"
  exit 1
fi

json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

APP_NAME="${CLI_APP:-$(json_val MT_APP_NAME)}"

if [[ -z "$APP_NAME" ]]; then
  echo "ERROR: APP_NAME not provided and MT_APP_NAME not set in credentials"
  exit 1
fi

echo "=== CF Log Diagnostic for app: $APP_NAME ==="
echo ""

RAW_LOGS=$(cf logs "$APP_NAME" --recent 2>&1 || true)

if [[ -z "$RAW_LOGS" ]]; then
  echo "No logs returned. Is the app running and are you logged into CF?"
  exit 1
fi

echo "--- Errors / failures / exceptions (last $LINES) ---"
echo "$RAW_LOGS" | grep -iE "error|fail|exception|timeout|denied|unauthorized|forbidden" \
  | tail -n "$LINES" || echo "(no error-level lines found)"

echo ""
echo "--- Subscription lifecycle events (last $LINES) ---"
echo "$RAW_LOGS" | grep -iE "subscri|onboard|offboard|tenant|provision|deprovision" \
  | tail -n "$LINES" || echo "(no subscription-lifecycle lines found)"

echo ""
echo "--- HTTP 4xx / 5xx responses (last 50) ---"
echo "$RAW_LOGS" | grep -iE 'HTTP/[0-9.]+\" [45][0-9][0-9]| [45][0-9][0-9] ' \
  | tail -n 50 || echo "(no 4xx/5xx lines found)"

echo ""
echo "=== End of diagnostic ==="
