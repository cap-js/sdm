#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# sdm-repo-manage.sh — Manage SDM repositories (check, onboard, offboard).
#
# Usage:
#   ./sdm-repo-manage.sh check   --externalId <id>
#   ./sdm-repo-manage.sh onboard --externalId <id> [--displayName <name>] [--description <desc>]
#   ./sdm-repo-manage.sh offboard --externalId <id>
#   ./sdm-repo-manage.sh list
#
# Exit codes:
#   check:    0 = repo exists, 1 = repo NOT found, 2 = error
#   onboard:  0 = success, non-zero = failure
#   offboard: 0 = success, non-zero = failure
#   list:     0 = success, prints repo list
#
# Required config in credentials.json:
#   CMIS_URL, CMIS_TOKEN_URL, CMIS_CLIENT_ID, CMIS_CLIENT_SECRET,
#   CMIS_USERNAME, CMIS_PASSWORD
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found at $CONFIG_FILE"
  exit 2
fi

# Load values from JSON credentials file using jq
json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

CMIS_URL=$(json_val CMIS_URL)
CMIS_TOKEN_URL=$(json_val authUrlMTSDC)
if [[ "${TENANCY_MODEL:-}" == "multi" && "${TENANT:-}" == "SDMGoogleWorkspaceConsumer" ]]; then
  CMIS_TOKEN_URL=$(json_val authUrlMTGWC)
elif [[ "${TENANCY_MODEL:-}" != "multi" ]]; then
  CMIS_TOKEN_URL=$(json_val authUrl)
fi
if [[ "${TENANCY_MODEL:-}" == "multi" ]]; then
  CMIS_CLIENT_ID=$(json_val cmisClientIDMT)
  CMIS_CLIENT_SECRET=$(json_val cmisClientSecretMT)
else
  CMIS_CLIENT_ID=$(json_val cmisClientID)
  CMIS_CLIENT_SECRET=$(json_val cmisClientSecret)
fi
CMIS_USERNAME=$(json_val username)
CMIS_PASSWORD=$(json_val password)

# --- Parse command ---
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 {check|onboard|offboard|list} [options]"
  exit 2
fi

ACTION="$1"
shift

# --- Parse optional arguments ---
EXTERNAL_ID=""
DISPLAY_NAME=""
DESCRIPTION=""
SUBDOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --externalId)   EXTERNAL_ID="$2";   shift 2 ;;
    --displayName)  DISPLAY_NAME="$2";  shift 2 ;;
    --description)  DESCRIPTION="$2";   shift 2 ;;
    --subdomain)    SUBDOMAIN="$2";     shift 2 ;;
    *) echo "Unknown argument: $1"; exit 2 ;;
  esac
done

# --- Validate required config ---
for var in CMIS_URL CMIS_TOKEN_URL CMIS_CLIENT_ID CMIS_CLIENT_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in $CONFIG_FILE"
    exit 2
  fi
done

# --- Resolve token URL (replace provider subdomain with consumer if --subdomain given) ---
RESOLVED_TOKEN_URL="$CMIS_TOKEN_URL"
if [[ -n "$SUBDOMAIN" ]]; then
  # Extract provider subdomain from token URL (between :// and first .)
  PROVIDER_SUBDOMAIN=$(echo "$CMIS_TOKEN_URL" | sed -n 's|.*://\([^.]*\)\..*|\1|p')
  RESOLVED_TOKEN_URL="${CMIS_TOKEN_URL/$PROVIDER_SUBDOMAIN/$SUBDOMAIN}"
  echo "Using consumer subdomain: $SUBDOMAIN (token URL: $RESOLVED_TOKEN_URL)"
fi

# --- Obtain OAuth2 access token (client_credentials grant) ---
get_token() {
  local TOKEN_RESPONSE
  TOKEN_RESPONSE=$(curl -s -X POST "${RESOLVED_TOKEN_URL}/oauth/token" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=${CMIS_CLIENT_ID}" \
    --data-urlencode "client_secret=${CMIS_CLIENT_SECRET}")

  ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')

  if [[ -z "$ACCESS_TOKEN" ]]; then
    echo "ERROR: Failed to obtain access token."
    echo "Token response: $TOKEN_RESPONSE"
    exit 2
  fi
}

# ===========================================================================
# ACTION: list — List all onboarded repositories
# ===========================================================================
action_list() {
  get_token
  echo "Listing onboarded repositories..."

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "${CMIS_URL}rest/v2/repositories" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "ERROR: Failed to list repositories (HTTP ${HTTP_CODE})."
    echo "$BODY"
    exit 2
  fi

  echo "$BODY"
}

# ===========================================================================
# ACTION: check — Check if a repository with given externalId exists
# ===========================================================================
action_check() {
  if [[ -z "$EXTERNAL_ID" ]]; then
    echo "ERROR: --externalId is required for check"
    exit 2
  fi

  get_token
  echo "Checking if repository with externalId '${EXTERNAL_ID}' exists..."

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "${CMIS_URL}rest/v2/repositories" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "ERROR: Failed to list repositories (HTTP ${HTTP_CODE})."
    echo "$BODY"
    exit 2
  fi

  # Check if any repository has the matching externalId
  if echo "$BODY" | grep -q "\"externalId\":\"${EXTERNAL_ID}\""; then
    echo "FOUND: Repository with externalId '${EXTERNAL_ID}' exists."
    exit 0
  else
    echo "NOT_FOUND: No repository with externalId '${EXTERNAL_ID}'."
    exit 1
  fi
}

# ===========================================================================
# ACTION: onboard — Create/onboard a new repository
# ===========================================================================
action_onboard() {
  if [[ -z "$EXTERNAL_ID" ]]; then
    echo "ERROR: --externalId is required for onboard"
    exit 2
  fi

  # Default display name and description
  [[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="$EXTERNAL_ID"
  [[ -z "$DESCRIPTION" ]] && DESCRIPTION="Repository $EXTERNAL_ID"

  get_token
  echo "Onboarding repository with externalId '${EXTERNAL_ID}'..."

  PAYLOAD=$(cat <<EOF
{
  "repository": {
    "displayName": "${DISPLAY_NAME}",
    "description": "${DESCRIPTION}",
    "repositoryType": "internal",
    "isVersionEnabled": "false",
    "isVirusScanEnabled": "false",
    "skipVirusScanForLargeFile": "false",
    "hashAlgorithms": "MD5",
    "externalId": "${EXTERNAL_ID}",
    "repositoryParams": [
      {
        "paramName": "fileExtensions",
        "paramValue": "{\"type\":\"block\",\"list\":[\"docx\",\"pptx\",\"rtf\"]}"
      }
    ]
  }
}
EOF
)

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${CMIS_URL}rest/v2/repositories" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    echo "SUCCESS: Repository '${EXTERNAL_ID}' onboarded."
    echo "$BODY"
    exit 0
  else
    echo "ERROR: Failed to onboard repository (HTTP ${HTTP_CODE})."
    echo "$BODY"
    exit 1
  fi
}

# ===========================================================================
# ACTION: offboard — Delete/offboard a repository by externalId
# ===========================================================================
action_offboard() {
  if [[ -z "$EXTERNAL_ID" ]]; then
    echo "ERROR: --externalId is required for offboard"
    exit 2
  fi

  get_token
  echo "Offboarding repository with externalId '${EXTERNAL_ID}'..."

  # First find the repository ID from the list
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "${CMIS_URL}rest/v2/repositories" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" != "200" ]]; then
    echo "ERROR: Failed to list repositories (HTTP ${HTTP_CODE})."
    echo "$BODY"
    exit 2
  fi

  # Extract the repository ID that matches the externalId
  # The JSON structure has repositories array with id and externalId fields
  REPO_ID=$(echo "$BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
repos = data.get('repoAndConnectionInfos', data.get('repositories', []))
for r in repos:
    repo = r.get('repository', r)
    if repo.get('externalId') == '${EXTERNAL_ID}':
        print(repo.get('id', ''))
        break
" 2>/dev/null || true)

  if [[ -z "$REPO_ID" ]]; then
    echo "NOT_FOUND: No repository with externalId '${EXTERNAL_ID}' to offboard."
    exit 1
  fi

  echo "Found repository ID: ${REPO_ID} for externalId '${EXTERNAL_ID}'"

  # Delete the repository
  DEL_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X DELETE "${CMIS_URL}rest/v2/repositories/${REPO_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json")

  DEL_HTTP_CODE=$(echo "$DEL_RESPONSE" | tail -n1)
  DEL_BODY=$(echo "$DEL_RESPONSE" | sed '$d')

  if [[ "$DEL_HTTP_CODE" == "200" || "$DEL_HTTP_CODE" == "204" ]]; then
    echo "SUCCESS: Repository '${EXTERNAL_ID}' (ID: ${REPO_ID}) offboarded."
    exit 0
  else
    echo "ERROR: Failed to offboard repository (HTTP ${DEL_HTTP_CODE})."
    echo "$DEL_BODY"
    exit 1
  fi
}

# ===========================================================================
# Dispatch action
# ===========================================================================
case "$ACTION" in
  check)    action_check    ;;
  onboard)  action_onboard  ;;
  offboard) action_offboard ;;
  list)     action_list     ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Usage: $0 {check|onboard|offboard|list} [options]"
    exit 2
    ;;
esac
