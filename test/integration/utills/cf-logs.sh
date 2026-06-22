#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# cf-logs.sh — Fetch recent CF app logs and print them to stdout.
#
# Usage: ./cf-logs.sh [--app <appName>]
#
# If --app is not provided, uses APP_NAME from credentials.json.
# Assumes user is already logged in to CF.
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

# Parse optional --app argument
CLI_APP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app) CLI_APP="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found"
  exit 1
fi

# Load values from JSON credentials file using jq
json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

APP_NAME=$(json_val APP_NAME)

# Apply CLI override
[[ -n "$CLI_APP" ]] && APP_NAME="$CLI_APP"

# Validate
if [[ -z "${APP_NAME:-}" ]]; then
  echo "ERROR: APP_NAME is not set"
  exit 1
fi

# Fetch recent logs
echo "Retrieving logs for app $APP_NAME..."
cf logs "$APP_NAME" --recent
