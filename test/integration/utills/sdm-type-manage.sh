#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# sdm-type-manage.sh — Manage CMIS Secondary Types in an SDM repository.
#
# Usage:
#   ./sdm-type-manage.sh register-type --externalId <repo-ext-id> --typeFile <path-to-type.json> [--subdomain <consumer-subdomain>]
#   ./sdm-type-manage.sh get-type      --externalId <repo-ext-id> --typeId <type-id>             [--subdomain <consumer-subdomain>]
#
# Exit codes:
#   register-type: 0 = created OR already exists (idempotent),
#                  1 = repository not found,
#                  2 = error (auth, network, or non-recoverable HTTP)
#   get-type:      0 = type exists in repository (HTTP 200, body contains the typeId),
#                  1 = type NOT found (HTTP 404 or HTTP 200 but body lacks typeId),
#                  2 = error
#
# Required config in credentials.json:
#   CMIS_URL, authUrl/authUrlMTSDC/authUrlMTGWC, cmisClientID/cmisClientIDMT,
#   cmisClientSecret/cmisClientSecretMT, username, password
#
# When --subdomain is provided:
#   - The OAuth token is obtained via client_credentials against the consumer's UAA URL
#     (provider subdomain in token URL is replaced by the given consumer subdomain).
#   - This matches the auth pattern used by sdm-repo-manage.sh for consumer-scoped operations.
#
# When the env var CMIS_ACCESS_TOKEN is set, the OAuth fetch is skipped — the test
# harness pre-fetches the token once in beforeAll and threads it through here.
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

# Trailing slash for URL building
CMIS_URL="${CMIS_URL%/}/"

# --- Parse command ---
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 {register-type|get-type} [options]"
  exit 2
fi

ACTION="$1"
shift

EXTERNAL_ID=""
TYPE_FILE=""
TYPE_ID=""
SUBDOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --externalId)  EXTERNAL_ID="$2"; shift 2 ;;
    --typeFile)    TYPE_FILE="$2";   shift 2 ;;
    --typeId)      TYPE_ID="$2";     shift 2 ;;
    --subdomain)   SUBDOMAIN="$2";   shift 2 ;;
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
  PROVIDER_SUBDOMAIN=$(echo "$CMIS_TOKEN_URL" | sed -n 's|.*://\([^.]*\)\..*|\1|p')
  RESOLVED_TOKEN_URL="${CMIS_TOKEN_URL/$PROVIDER_SUBDOMAIN/$SUBDOMAIN}"
  echo "Using consumer subdomain: $SUBDOMAIN (token URL: $RESOLVED_TOKEN_URL)"
fi

# --- Obtain OAuth2 access token (or reuse pre-fetched one) ---
get_token() {
  if [[ -n "${CMIS_ACCESS_TOKEN:-}" ]]; then
    ACCESS_TOKEN="$CMIS_ACCESS_TOKEN"
    return
  fi

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

# --- Resolve internal CMIS repo ID from externalId ---
# The repo's internal ID is needed for browser-binding endpoints (browser/{repoId}).
resolve_repo_id() {
  if [[ -z "$EXTERNAL_ID" ]]; then
    echo "ERROR: --externalId is required"
    exit 2
  fi

  local LIST_RESPONSE LIST_HTTP_CODE LIST_BODY
  LIST_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "${CMIS_URL}rest/v2/repositories" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json")
  LIST_HTTP_CODE=$(echo "$LIST_RESPONSE" | tail -n1)
  LIST_BODY=$(echo "$LIST_RESPONSE" | sed '$d')

  if [[ "$LIST_HTTP_CODE" != "200" ]]; then
    echo "ERROR: Failed to list repositories (HTTP ${LIST_HTTP_CODE})."
    echo "$LIST_BODY"
    exit 2
  fi

  REPO_ID=$(echo "$LIST_BODY" | python3 -c "
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
    echo "NOT_FOUND: No repository with externalId '${EXTERNAL_ID}'."
    exit 1
  fi
}

# ===========================================================================
# ACTION: register-type — POST a CMIS type definition to the browser binding
# ===========================================================================
# CMIS browser binding accepts createType via:
#   POST {CMIS_URL}browser/{repoId}
#   form fields: cmisaction=createType, type=<JSON type definition>
# ===========================================================================
action_register_type() {
  if [[ -z "$TYPE_FILE" ]]; then
    echo "ERROR: --typeFile is required for register-type"
    exit 2
  fi
  if [[ ! -f "$TYPE_FILE" ]]; then
    echo "ERROR: Type file not found: $TYPE_FILE"
    exit 2
  fi

  get_token
  resolve_repo_id
  echo "Registering CMIS secondary type from '${TYPE_FILE}' in repository '${EXTERNAL_ID}' (id: ${REPO_ID})..."

  # Read type JSON; the CMIS browser binding accepts the type definition as
  # the value of the 'type' form field.
  local TYPE_JSON
  TYPE_JSON=$(cat "$TYPE_FILE")

  # Extract typeId for logging / idempotency check.
  local INCOMING_TYPE_ID
  INCOMING_TYPE_ID=$(echo "$TYPE_JSON" | jq -r '.id // empty')
  echo "Type id from file: ${INCOMING_TYPE_ID:-<unknown>}"

  local CREATE_RESPONSE CREATE_HTTP_CODE CREATE_BODY
  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${CMIS_URL}browser/${REPO_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -F "cmisaction=createType" \
    -F "type=${TYPE_JSON}")
  CREATE_HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -n1)
  CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '$d')

  case "$CREATE_HTTP_CODE" in
    200|201)
      echo "SUCCESS: Type '${INCOMING_TYPE_ID}' registered (HTTP ${CREATE_HTTP_CODE})."
      exit 0
      ;;
    409|422|400)
      # Idempotency: SDM may return one of these when the type already exists.
      # Treat as success only if the response body indicates a duplicate / already-exists.
      if echo "$CREATE_BODY" | grep -qiE 'already exist|duplicate|exists already|conflict'; then
        echo "ALREADY_EXISTS: Type '${INCOMING_TYPE_ID}' already registered (HTTP ${CREATE_HTTP_CODE}). Treating as success."
        exit 0
      fi
      echo "ERROR: Failed to register type '${INCOMING_TYPE_ID}' (HTTP ${CREATE_HTTP_CODE})."
      echo "$CREATE_BODY"
      exit 1
      ;;
    *)
      echo "ERROR: Failed to register type '${INCOMING_TYPE_ID}' (HTTP ${CREATE_HTTP_CODE})."
      echo "$CREATE_BODY"
      exit 2
      ;;
  esac
}

# ===========================================================================
# ACTION: get-type — verify a CMIS type definition is registered
# ===========================================================================
# CMIS browser binding lookup:
#   GET {CMIS_URL}browser/{repoId}?cmisselector=typeDefinition&typeId=<id>
# ===========================================================================
action_get_type() {
  if [[ -z "$TYPE_ID" ]]; then
    echo "ERROR: --typeId is required for get-type"
    exit 2
  fi

  get_token
  resolve_repo_id
  echo "Fetching type definition for '${TYPE_ID}' in repository '${EXTERNAL_ID}' (id: ${REPO_ID})..."

  local GET_RESPONSE GET_HTTP_CODE GET_BODY
  GET_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X GET "${CMIS_URL}browser/${REPO_ID}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -G \
    --data-urlencode "cmisselector=typeDefinition" \
    --data-urlencode "typeId=${TYPE_ID}")
  GET_HTTP_CODE=$(echo "$GET_RESPONSE" | tail -n1)
  GET_BODY=$(echo "$GET_RESPONSE" | sed '$d')

  if [[ "$GET_HTTP_CODE" == "200" ]] && echo "$GET_BODY" | grep -q "\"id\":\"${TYPE_ID}\""; then
    echo "FOUND: Type '${TYPE_ID}' is registered (HTTP 200)."
    exit 0
  fi

  if [[ "$GET_HTTP_CODE" == "404" ]] || [[ "$GET_HTTP_CODE" == "200" ]]; then
    echo "NOT_FOUND: Type '${TYPE_ID}' is not registered (HTTP ${GET_HTTP_CODE})."
    echo "$GET_BODY"
    exit 1
  fi

  echo "ERROR: Unexpected HTTP ${GET_HTTP_CODE} when querying type '${TYPE_ID}'."
  echo "$GET_BODY"
  exit 2
}

# --- Dispatch ---
case "$ACTION" in
  register-type)  action_register_type ;;
  get-type)       action_get_type ;;
  *)
    echo "Unknown action: $ACTION"
    echo "Usage: $0 {register-type|get-type} [options]"
    exit 2
    ;;
esac
