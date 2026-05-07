#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# get-object-id.sh — Find the CMIS object ID for an object by name in the SDM repository.
#
# Usage: ./get-object-id.sh <cmisName> [folderID] [cmisType]
#
#   cmisName    The cmis:name of the object to look up
#   folderID    (Optional) CMIS object ID of the parent folder to search in.
#               If omitted, searches the entire repository.
#   cmisType    (Optional) CMIS type to query. Defaults to 'cmis:folder'.
#               Use 'cmis:document' to find uploaded files.
#
# On success, the resolved CMIS object ID is printed to stdout and the script
# exits with code 0.  On failure the script exits with a non-zero code.
#
# Required config in credentials.json:
#   CMIS_URL, CMIS_REPOSITORY_ID, CMIS_TOKEN_URL,
#   CMIS_CLIENT_ID, CMIS_CLIENT_SECRET, CMIS_USERNAME, CMIS_PASSWORD
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found at $CONFIG_FILE"
  exit 1
fi

# Load values from JSON credentials file using jq
json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

CMIS_URL=$(json_val CMIS_URL)
CMIS_REPOSITORY_ID=$(json_val CMIS_REPOSITORY_ID)
CMIS_TOKEN_URL=$(json_val CMIS_TOKEN_URL)
CMIS_CLIENT_ID=$(json_val CMIS_CLIENT_ID)
CMIS_CLIENT_SECRET=$(json_val CMIS_CLIENT_SECRET)
CMIS_USERNAME=$(json_val CMIS_USERNAME)
CMIS_PASSWORD=$(json_val CMIS_PASSWORD)

# --- Validate positional parameters ---
if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <cmisName> [folderID] [cmisType]"
  exit 1
fi

CMIS_NAME="$1"
PARENT_FOLDER_ID="${2:-}"
CMIS_TYPE="${3:-cmis:folder}"

# --- Validate required config variables ---
for var in CMIS_URL CMIS_REPOSITORY_ID CMIS_TOKEN_URL CMIS_CLIENT_ID CMIS_CLIENT_SECRET CMIS_USERNAME CMIS_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in $CONFIG_FILE"
    exit 1
  fi
done

# --- Obtain OAuth2 access token (password grant) ---
echo "Fetching OAuth2 token..."
TOKEN_RESPONSE=$(curl -s -X POST "${CMIS_TOKEN_URL}/oauth/token" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=${CMIS_CLIENT_ID}" \
  --data-urlencode "client_secret=${CMIS_CLIENT_SECRET}" \
  --data-urlencode "username=${CMIS_USERNAME}" \
  --data-urlencode "password=${CMIS_PASSWORD}")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" \
  | grep -o '"access_token":"[^"]*"' \
  | sed 's/"access_token":"//;s/"$//')

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: Failed to obtain access token."
  echo "Token endpoint response: $TOKEN_RESPONSE"
  exit 1
fi

# --- Execute CMIS query to find the folder by name ---
# The CMIS Browser Binding query endpoint is the repository URL (no /root).
QUERY_URL="${CMIS_URL}browser/${CMIS_REPOSITORY_ID}"

if [[ -n "${PARENT_FOLDER_ID}" ]]; then
  CMIS_QUERY="SELECT cmis:objectId FROM ${CMIS_TYPE} WHERE cmis:name = '${CMIS_NAME}' AND IN_FOLDER('${PARENT_FOLDER_ID}')"
  echo "Searching for ${CMIS_TYPE} '${CMIS_NAME}' inside folder '${PARENT_FOLDER_ID}'..."
else
  CMIS_QUERY="SELECT cmis:objectId FROM ${CMIS_TYPE} WHERE cmis:name = '${CMIS_NAME}'"
  echo "Searching for ${CMIS_TYPE} '${CMIS_NAME}' in repository..."
fi
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X GET "${QUERY_URL}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -G \
  --data-urlencode "cmisselector=query" \
  --data-urlencode "q=${CMIS_QUERY}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: CMIS query failed (HTTP ${HTTP_CODE})."
  echo "$BODY"
  exit 1
fi

# --- Parse the objectId from the JSON response ---
# The response is a CMIS query result; each entry has cmis:objectId.value
OBJECT_ID=$(echo "$BODY" \
  | grep -o '"cmis:objectId"[^}]*"value":"[^"]*"' \
  | head -1 \
  | grep -o '"value":"[^"]*"' \
  | sed 's/"value":"//;s/"$//')

if [[ -z "$OBJECT_ID" ]]; then
  echo "ERROR: No ${CMIS_TYPE} found with name '${CMIS_NAME}'."
  echo "Query response: $BODY"
  exit 1
fi

echo "Found object ID for '${CMIS_NAME}': ${OBJECT_ID}"
