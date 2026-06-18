#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

# Parse optional --key, --value, and --app CLI arguments
CLI_KEY=""
CLI_VALUE=""
CLI_APP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   CLI_KEY="$2";   shift 2 ;;
    --value) CLI_VALUE="$2"; shift 2 ;;
    --app)   CLI_APP="$2";   shift 2 ;;
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
VAR_NAME="REPOSITORY_ID"
VAR_VALUE=$(json_val defaultRepositoryID)

# --- Apply CLI overrides ---
[[ -n "$CLI_KEY" ]]   && VAR_NAME="$CLI_KEY"
[[ -n "$CLI_VALUE" ]] && VAR_VALUE="$CLI_VALUE"
[[ -n "$CLI_APP" ]]   && APP_NAME="$CLI_APP"

# --- Validate required variables ---
for var in APP_NAME VAR_NAME VAR_VALUE; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set (checked config and CLI args)"
    exit 1
  fi
done

echo "=== Cloud Foundry Environment Variable Updater ==="
echo "=================================================="

# --- Update environment variable ---
echo ""
echo "Setting environment variable on app..."
cf set-env "$APP_NAME" "$VAR_NAME" "$VAR_VALUE" > /dev/null 2>&1

# --- Restage the app to pick up the change ---
echo ""
echo "Restaging app..."
cf restage "$APP_NAME" > /dev/null 2>&1
echo "Restage complete."

echo ""
echo "Done."
