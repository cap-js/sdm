#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/../credentials.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found"
  exit 1
fi

# Load values from JSON credentials file using jq
json_val() { jq -r ".$1 // empty" "$CONFIG_FILE"; }

CF_USERNAME=$(json_val username)
CF_PASSWORD=$(json_val password)
if [[ "${TENANT:-}" == "SDMGoogleWorkspaceConsumer" ]]; then
  CONSUMER_SUBACCOUNT_ID=$(json_val consumerSubaccountIdMT2)
else
  CONSUMER_SUBACCOUNT_ID=$(json_val consumerSubaccountIdMT1)
fi
SAAS_APP_NAME=$(json_val SAAS_APP_NAME)
BTP_CLI_URL=$(json_val BTP_CLI_URL)
BTP_GLOBAL_ACCOUNT_SUBDOMAIN=$(json_val BTP_GLOBAL_ACCOUNT_SUBDOMAIN)
ROLE_COLLECTION_NAME=$(json_val ROLE_COLLECTION_NAME)
APP_ROLE_FILTER=$(json_val APP_ROLE_FILTER)
ROLE_ASSIGNMENT_EMAILS="$CF_USERNAME"

CONSUMER_USER="$CF_USERNAME"
CONSUMER_PASS="$CF_PASSWORD"
BTP_URL="${BTP_CLI_URL:-https://cli.btp.cloud.sap}"

# --- Validate required variables ---
for var in CONSUMER_USER CONSUMER_SUBACCOUNT_ID SAAS_APP_NAME; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required variable $var is not set in config"
    exit 1
  fi
done

echo "=== BTP Subaccount SaaS Subscription ==="
echo "=========================================="

# --- BTP Login ---
echo ""
echo "Logging in to SAP BTP..."
LOGIN_ARGS=(--url "$BTP_URL" --user "$CONSUMER_USER")
if [[ -n "${CONSUMER_PASS:-}" ]]; then
  LOGIN_ARGS+=(--password "$CONSUMER_PASS")
fi
if [[ -n "${BTP_GLOBAL_ACCOUNT_SUBDOMAIN:-}" ]]; then
  LOGIN_ARGS+=(--subdomain "$BTP_GLOBAL_ACCOUNT_SUBDOMAIN")
fi
if ! LOGIN_OUT=$(btp login "${LOGIN_ARGS[@]}" 2>&1); then
  echo "ERROR: btp login failed:"
  echo "$LOGIN_OUT"
  exit 1
fi

# --- Check current subscription status ---
GET_ARGS=(--subaccount "$CONSUMER_SUBACCOUNT_ID" --of-app "$SAAS_APP_NAME")
if [[ -n "${SAAS_APP_PLAN:-}" ]]; then
  GET_ARGS+=(--plan "$SAAS_APP_PLAN")
fi

# Use list to find the exact app row and check its state
# Use -w (whole word) so "NOT_SUBSCRIBED" does NOT match "SUBSCRIBED"
CURRENT_STATE=$(btp list accounts/subscription --subaccount "$CONSUMER_SUBACCOUNT_ID" 2>/dev/null \
  | grep -F "$SAAS_APP_NAME" | grep -ow "SUBSCRIBED" | head -1 || true)

if [[ "$CURRENT_STATE" == "SUBSCRIBED" ]]; then
  echo ""
  echo "Already subscribed to '$SAAS_APP_NAME' — skipping subscription step."
else
  # --- Subscribe to SaaS application at subaccount level ---
  echo ""
  echo "Subscribing to SaaS application..."
  echo "  Subaccount: $CONSUMER_SUBACCOUNT_ID"
  echo "  App: $SAAS_APP_NAME"
  SUBSCRIBE_ARGS=(--subaccount "$CONSUMER_SUBACCOUNT_ID" --to-app "$SAAS_APP_NAME")
  if [[ -n "${SAAS_APP_PLAN:-}" ]]; then
    SUBSCRIBE_ARGS+=(--plan "$SAAS_APP_PLAN")
  fi
  if ! SUBSCRIBE_OUT=$(btp subscribe accounts/subaccount "${SUBSCRIBE_ARGS[@]}" 2>&1); then
    echo "ERROR: btp subscribe failed:"
    echo "$SUBSCRIBE_OUT"
    exit 1
  fi

  # --- Wait for subscription to complete ---
  echo ""
  echo "Waiting for subscription to be ready..."
  while true; do
    STATE=$(btp get accounts/subscription "${GET_ARGS[@]}" 2>/dev/null | grep -i "status:" | awk '{print $2}' || true)
    if echo "$STATE" | grep -qi "SUBSCRIBED"; then
      echo "Subscription is active."
      break
    elif echo "$STATE" | grep -qi "SUBSCRIBE_FAILED"; then
      echo "ERROR: Subscription failed."
      exit 1
    else
      echo "  State: ${STATE:-pending} — waiting 10s..."
      sleep 10
    fi
  done
fi

echo ""
echo "Done."

# --- Create role collection from app roles and assign to configured email IDs ---

# Parse comma-separated arrays and strip surrounding whitespace from each element
IFS=',' read -ra _emails_raw  <<< "${ROLE_ASSIGNMENT_EMAILS:-}"
IFS=',' read -ra _colls_raw   <<< "${ROLE_COLLECTION_NAME:-}"

EMAILS_ARRAY=()
for _e in "${_emails_raw[@]}"; do
  _e="${_e#"${_e%%[![:space:]]*}"}"; _e="${_e%"${_e##*[![:space:]]}"}" 
  [[ -n "$_e" ]] && EMAILS_ARRAY+=("$_e")
done

COLLECTIONS_ARRAY=()
for _c in "${_colls_raw[@]}"; do
  _c="${_c#"${_c%%[![:space:]]*}"}"; _c="${_c%"${_c##*[![:space:]]}"}" 
  [[ -n "$_c" ]] && COLLECTIONS_ARRAY+=("$_c")
done

if [[ ${#COLLECTIONS_ARRAY[@]} -eq 0 ]]; then
  echo ""
  echo "No ROLE_COLLECTION_NAME configured — skipping role collection setup."
  exit 0
fi

if [[ ${#EMAILS_ARRAY[@]} -eq 0 ]]; then
  echo ""
  echo "No ROLE_ASSIGNMENT_EMAILS configured — skipping role assignment."
  exit 0
fi

ROLE_FILTER="${APP_ROLE_FILTER:-$SAAS_APP_NAME}"

echo ""
echo "=== Role Collection Setup ==="
echo "Fetching roles for app filter: '$ROLE_FILTER'..."

# After a fresh subscription, role templates can take time to be provisioned.
# Retry up to 6 times (5 minutes total) before giving up.
MATCHED_ROLES=""
ROLES_RAW=""
MAX_RETRIES=6
RETRY_INTERVAL=30
for ((attempt=1; attempt<=MAX_RETRIES; attempt++)); do
  ROLES_RAW=$(btp list security/role --subaccount "$CONSUMER_SUBACCOUNT_ID" 2>&1) || true

  if echo "$ROLES_RAW" | grep -qi "^error\|FAILED"; then
    echo "ERROR: Could not fetch roles from subaccount."
    exit 1
  fi

  # BTP CLI columns: name | appId | roleTemplateName | description
  MATCHED_ROLES=$(echo "$ROLES_RAW" \
    | grep -i "$ROLE_FILTER" \
    | awk '{print $1 "|" $3 "|" $2}' \
    || true)

  if [[ -n "$MATCHED_ROLES" ]]; then
    break
  fi

  if [[ $attempt -lt $MAX_RETRIES ]]; then
    echo "  Roles for '$ROLE_FILTER' not yet provisioned (attempt $attempt/$MAX_RETRIES) — waiting ${RETRY_INTERVAL}s..."
    sleep "$RETRY_INTERVAL"
  fi
done

if [[ -z "$MATCHED_ROLES" ]]; then
  echo "WARNING: No matching roles found after $MAX_RETRIES attempts — role templates may not be provisioned yet."
  exit 0
fi

ROLE_COUNT=$(echo "$MATCHED_ROLES" | wc -l | tr -d ' ')
echo "Found $ROLE_COUNT role(s) to assign."

# For each role collection: create it, add roles, then assign all emails
for COLLECTION_NAME in "${COLLECTIONS_ARRAY[@]}"; do
  echo ""
  echo "--- Processing role collection: '$COLLECTION_NAME' ---"

  # Create the role collection if it doesn't already exist
  # Use awk exact first-column match to avoid "test-cases-role" matching "ak-test2" as a substring
  COLLECTION_EXISTS=$(btp list security/role-collection --subaccount "$CONSUMER_SUBACCOUNT_ID" 2>/dev/null \
    | awk -v name="$COLLECTION_NAME" '$1 == name {found=1} END {print found+0}' || echo 0)
  if [[ "$COLLECTION_EXISTS" == "1" ]]; then
    echo "Role collection '$COLLECTION_NAME' already exists — skipping creation."
  else
    echo "Creating role collection '$COLLECTION_NAME'..."
    btp create security/role-collection "$COLLECTION_NAME" \
      --subaccount "$CONSUMER_SUBACCOUNT_ID" \
      --description "Auto-created role collection for $SAAS_APP_NAME" \
      > /dev/null 2>&1 \
      && echo "Role collection created." \
      || echo "WARNING: Could not create role collection — it may already exist, continuing."
  fi

  # Add each role to the collection (safe to re-run; duplicate adds are ignored)
  echo "Adding roles to collection..."
  while IFS='|' read -r RNAME RTEMPLATE RAPPID; do
    [[ -z "$RNAME" ]] && continue
    btp add security/role "$RNAME" \
      --to-role-collection "$COLLECTION_NAME" \
      --subaccount "$CONSUMER_SUBACCOUNT_ID" \
      --of-app "$RAPPID" \
      --of-role-template "$RTEMPLATE" \
      > /dev/null 2>&1 \
      && echo "  Role added successfully." \
      || echo "  WARNING: Could not add role (may already be in collection) — continuing."
  done <<< "$MATCHED_ROLES"

  # Assign the role collection to each email
  echo "Assigning role collection to users..."
  for EMAIL in "${EMAILS_ARRAY[@]}"; do
    btp assign security/role-collection "$COLLECTION_NAME" \
      --subaccount "$CONSUMER_SUBACCOUNT_ID" \
      --to-user "$EMAIL" \
      --create-user-if-missing \
      > /dev/null 2>&1 \
      && echo "  User assigned successfully." \
      || echo "  WARNING: Failed to assign role collection to a user — continuing."
  done
done

echo ""
echo "Role assignment complete."
