#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

# Parse optional --key and --value CLI arguments
CLI_KEY=""
CLI_VALUE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   CLI_KEY="$2";   shift 2 ;;
    --value) CLI_VALUE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found"
  exit 1
fi

# Load values from JSON credentials file using jq
json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

CF_API_ENDPOINT=$(json_val CF_API_ENDPOINT)
CF_ORG=$(json_val CF_ORG)
CF_SPACE=$(json_val CF_SPACE)
CF_USERNAME=$(json_val CF_USERNAME)
CF_PASSWORD=$(json_val CF_PASSWORD)
APP_NAME=$(json_val APP_NAME)
VAR_NAME=$(json_val VAR_NAME)
VAR_VALUE=$(json_val VAR_VALUE)

# --- Apply CLI overrides ---
[[ -n "$CLI_KEY" ]]   && VAR_NAME="$CLI_KEY"
[[ -n "$CLI_VALUE" ]] && VAR_VALUE="$CLI_VALUE"

# --- Validate required variables ---
for var in CF_API_ENDPOINT CF_ORG CF_SPACE CF_USERNAME APP_NAME VAR_NAME VAR_VALUE; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set (checked config and CLI args)"
    exit 1
  fi
done

echo "=== Cloud Foundry Environment Variable Updater ==="
echo "=================================================="

# --- CF Login ---
echo ""
echo "Logging in to Cloud Foundry..."
if [[ -n "${CF_PASSWORD:-}" ]]; then
  cf login -a "$CF_API_ENDPOINT" -u "$CF_USERNAME" -p "$CF_PASSWORD" -o "$CF_ORG" -s "$CF_SPACE" > /dev/null 2>&1
else
  cf login -a "$CF_API_ENDPOINT" -u "$CF_USERNAME" -o "$CF_ORG" -s "$CF_SPACE" > /dev/null 2>&1
fi

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
