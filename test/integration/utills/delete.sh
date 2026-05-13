#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# delete.sh — Delete a document from SAP Document Management Service via CMIS API
#
# Usage: ./delete.sh <objectID> [parentFolderID]
#
#   objectID      The CMIS object ID of the document to delete
#   parentFolderID  (Optional) The CMIS object ID of the parent folder.
#                   If provided, the endpoint is scoped to that folder.
#                   If omitted, defaults to the repository root.
#
# Required config in credentials.json:
#   CMIS_URL, CMIS_REPOSITORY_ID, CMIS_TOKEN_URL, CMIS_CLIENT_ID, CMIS_CLIENT_SECRET,
#   CMIS_USERNAME, CMIS_PASSWORD
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
CMIS_REPOSITORY_ID=$(json_val defaultRepositoryID)
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

# --- Parse named options (--subdomain) before positional args ---
SUBDOMAIN=""
POSITIONAL_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --subdomain) SUBDOMAIN="$2"; shift 2 ;;
    *) POSITIONAL_ARGS+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL_ARGS[@]}"

# --- Validate positional parameters ---
if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <objectID> [parentFolderID] [--subdomain <subdomain>]"
  exit 1
fi

OBJECT_ID="$1"
PARENT_FOLDER_ID="${2:-}"

# Replace provider subdomain in token URL when --subdomain is provided
if [[ -n "$SUBDOMAIN" ]]; then
  PROVIDER_SUBDOMAIN=$(echo "$CMIS_TOKEN_URL" | sed -n 's|.*://\([^.]*\)\..*|\1|p')
  CMIS_TOKEN_URL="${CMIS_TOKEN_URL/$PROVIDER_SUBDOMAIN/$SUBDOMAIN}"
fi

# --- Validate required config variables ---
for var in CMIS_URL CMIS_REPOSITORY_ID CMIS_TOKEN_URL CMIS_CLIENT_ID CMIS_CLIENT_SECRET CMIS_USERNAME CMIS_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var is not set in $CONFIG_FILE"
    exit 1
  fi
done

# --- Obtain OAuth2 access token ---
echo "Fetching OAuth2 token..."
if [[ -n "$SUBDOMAIN" ]]; then
  TOKEN_RESPONSE=$(curl -s -X POST "${CMIS_TOKEN_URL}/oauth/token" \
    --data-urlencode "grant_type=client_credentials" \
    --data-urlencode "client_id=${CMIS_CLIENT_ID}" \
    --data-urlencode "client_secret=${CMIS_CLIENT_SECRET}")
else
  TOKEN_RESPONSE=$(curl -s -X POST "${CMIS_TOKEN_URL}/oauth/token" \
    --data-urlencode "grant_type=password" \
    --data-urlencode "client_id=${CMIS_CLIENT_ID}" \
    --data-urlencode "client_secret=${CMIS_CLIENT_SECRET}" \
    --data-urlencode "username=${CMIS_USERNAME}" \
    --data-urlencode "password=${CMIS_PASSWORD}")
fi

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" \
  | grep -o '"access_token":"[^"]*"' \
  | sed 's/"access_token":"//;s/"$//')

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "ERROR: Failed to obtain access token."
  echo "Token endpoint response: $TOKEN_RESPONSE"
  exit 1
fi

# --- Build the CMIS browser endpoint URL ---
# For delete, the target object is always identified by the objectId form field.
# The parentFolderID is logged for context only; it does NOT go in the URL,
# as having ?objectId= in the URL conflicts with the objectId form field.
CMIS_ENDPOINT="${CMIS_URL}browser/${CMIS_REPOSITORY_ID}/root"

if [[ -n "${PARENT_FOLDER_ID}" ]]; then
  echo "Deleting object '${OBJECT_ID}' (parent folder: '${PARENT_FOLDER_ID}')..."
else
  echo "Deleting object '${OBJECT_ID}'..."
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$CMIS_ENDPOINT" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "cmisaction=delete" \
  -F "objectId=${OBJECT_ID}" \
  -F "allVersions=true")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "204" ]]; then
  echo "SUCCESS: Object '${OBJECT_ID}' deleted."
else
  echo "ERROR: Failed to delete object (HTTP ${HTTP_CODE})."
  echo "$BODY"
  exit 1
fi
