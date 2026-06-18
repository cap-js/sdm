# Helper Scripts & Utilities

This folder contains shell scripts and Java helper classes for managing SAP Document Management Service (SDM/CMIS) objects and Cloud Foundry / BTP subscription lifecycle tasks.

All scripts read their configuration from [`credentials.json`](../credentials.json) located at `test/integration/credentials.json`. Fill in your values in that file before running any script. Scripts require `jq` to be installed for JSON parsing.

---

## Configuration file

### `credentials.json`

Central JSON configuration file used by every script and the JavaScript integration tests. Located at `test/integration/credentials.json`.

| Section | Keys |
|---|---|
| App / Auth | `appUrl`, `authUrl`, `clientID`, `clientSecret`, `username`, `password` |
| Multi-tenancy | `appUrlMT`, `authUrlMTSDC`, `authUrlMTGWC`, `clientIDMT`, `clientSecretMT` |
| Cloud Foundry (provider) | `CF_API_ENDPOINT`, `CF_ORG`, `CF_SPACE`, `CF_USERNAME`, `CF_PASSWORD`, `APP_NAME` |
| CF env-var update | `VAR_NAME`, `VAR_VALUE` |
| Consumer account | `CONSUMER_CF_API_ENDPOINT`, `CONSUMER_CF_ORG`, `CONSUMER_CF_SPACE`, `CONSUMER_CF_USERNAME`, `CONSUMER_CF_PASSWORD` |
| BTP subscription | `CONSUMER_SUBACCOUNT_ID`, `SAAS_APP_NAME`, `SAAS_APP_PLAN`, `ROLE_ASSIGNMENT_EMAILS`, `ROLE_COLLECTION_NAME`, `APP_ROLE_FILTER` |
| BTP CLI | `BTP_CLI_URL`, `BTP_GLOBAL_ACCOUNT_SUBDOMAIN` |
| CMIS / SDM | `CMIS_URL`, `CMIS_REPOSITORY_ID`, `CMIS_TOKEN_URL`, `CMIS_CLIENT_ID`, `CMIS_CLIENT_SECRET`, `CMIS_USERNAME`, `CMIS_PASSWORD`, `CMIS_FOLDER_ID` |

---

## Scripts

### `create.sh` — Upload a document to SDM

**Function**  
Uploads a local file to the SAP Document Management Service repository via the CMIS Browser Binding API. An OAuth2 access token is obtained automatically using the password grant before the upload.

**Required config (`credentials.json`)**  
`CMIS_URL`, `CMIS_REPOSITORY_ID`, `CMIS_TOKEN_URL`, `CMIS_CLIENT_ID`, `CMIS_CLIENT_SECRET`, `CMIS_USERNAME`, `CMIS_PASSWORD`

**Optional config**  
`CMIS_FOLDER_ID` — fallback target folder object ID; overridden by the `parentFolderID` argument if supplied. If neither is provided the file is uploaded to the repository root.

**Parameters**

| # | Name | Default | Description |
|---|---|---|---|
| 1 | `cmisName` | — | Name the document will have inside the CMIS repository |
| 2 | `file` | — | Path to the local file to upload |
| 3 | `parentFolderID` | _(CMIS_FOLDER_ID or root)_ | CMIS object ID of the parent folder to upload into. Takes precedence over `CMIS_FOLDER_ID` from `credentials.json`. |

**Shell usage**
```bash
cd helper-scripts

# Upload to the repository root (or CMIS_FOLDER_ID from credentials.json)
./create.sh "my-document.pdf" "/path/to/my-document.pdf"

# Upload into a specific parent folder
./create.sh "my-document.pdf" "/path/to/my-document.pdf" "<parentFolderObjectId>"
```

**Usage in integration tests**  
Called via `CmisDocumentHelper.createDocumentInCmis(cmisName, filePath, entityId)` inside `testUploadSingleAttachmentPDF` (Order 3). The helper automatically resolves the parent folder object ID from `entityId + "__attachments"` before calling this script:
```java
// Upload README.md into the attachments folder of the entity
CmisDocumentHelper.createDocumentInCmis("README.md", "../README.md", entityID);
```

---

### `get-object-id.sh` — Resolve a CMIS object ID by name

**Function**  
Queries the SDM repository using a CMIS SQL statement to find the `cmis:objectId` of an object (folder or document) by its `cmis:name`. The resolved ID is printed to stdout on the last line, making it easy to capture programmatically.

**Required config (`credentials.json`)**  
`CMIS_URL`, `CMIS_REPOSITORY_ID`, `CMIS_TOKEN_URL`, `CMIS_CLIENT_ID`, `CMIS_CLIENT_SECRET`, `CMIS_USERNAME`, `CMIS_PASSWORD`

**Parameters**

| # | Name | Default | Description |
|---|---|---|---|
| 1 | `cmisName` | — | `cmis:name` of the object to look up |
| 2 | `folderID` | _(repository root)_ | CMIS object ID of the parent folder to search within |
| 3 | `cmisType` | `cmis:folder` | CMIS type to query — use `cmis:document` to find uploaded files |

**Shell usage**
```bash
# Find a folder by name anywhere in the repository
./get-object-id.sh "entityId__attachments"

# Find a document inside a specific folder
./get-object-id.sh "sample.pdf" "<parentFolderObjectId>" "cmis:document"
```

**Usage in integration tests**  
Called internally by `CmisDocumentHelper` (both `createDocumentInCmis` and `deleteDocumentFromCmis`) to resolve folder and document object IDs before upload or deletion. Not called directly from the test class.

---

### `delete.sh` — Delete a document from SDM

**Function**  
Sends a CMIS `delete` action to remove a document from the repository by its object ID. An OAuth2 access token is obtained automatically before the request.

**Required config (`credentials.json`)**  
`CMIS_URL`, `CMIS_REPOSITORY_ID`, `CMIS_TOKEN_URL`, `CMIS_CLIENT_ID`, `CMIS_CLIENT_SECRET`, `CMIS_USERNAME`, `CMIS_PASSWORD`

**Parameters**

| # | Name | Default | Description |
|---|---|---|---|
| 1 | `objectID` | — | CMIS object ID of the document to delete |
| 2 | `parentFolderID` | _(optional)_ | CMIS object ID of the parent folder (used for logging; does not change the delete target) |

**Shell usage**
```bash
./delete.sh "<documentObjectId>"
./delete.sh "<documentObjectId>" "<parentFolderObjectId>"
```

**Usage in integration tests**  
Called via `CmisDocumentHelper.deleteDocumentFromCmis(entityId, fileName)` inside `testUploadSingleAttachmentPDF` (Order 3) after the PDF upload has been verified. The helper resolves folder and document object IDs automatically:
```java
// Delete sample.pdf from the attachments folder of the entity
CmisDocumentHelper.deleteDocumentFromCmis(entityID, file.getName());
```

---

### `cf-subscribe.sh` — Subscribe a BTP consumer subaccount to a SaaS app

**Function**  
Uses the BTP CLI to subscribe a consumer subaccount to a SaaS application and then assigns all app role collections to the configured email addresses.

**Required config (`credentials.json`)**  
`CONSUMER_CF_USERNAME` (or `CF_USERNAME`), `CONSUMER_SUBACCOUNT_ID`, `SAAS_APP_NAME`

**Optional config**  
`SAAS_APP_PLAN`, `ROLE_ASSIGNMENT_EMAILS`, `ROLE_COLLECTION_NAME`, `APP_ROLE_FILTER`, `BTP_CLI_URL`, `BTP_GLOBAL_ACCOUNT_SUBDOMAIN`

**Shell usage**
```bash
cd helper-scripts
./cf-subscribe.sh
```

**No direct usage in integration tests.** Run manually before a test suite to set up a consumer subscription.

---

### `cf-unsubscribe.sh` — Unsubscribe a BTP consumer subaccount

**Function**  
Uses the BTP CLI to remove a SaaS subscription from a consumer subaccount.

**Required config (`credentials.json`)**  
`CONSUMER_CF_USERNAME` (or `CF_USERNAME`), `CONSUMER_SUBACCOUNT_ID`, `SAAS_APP_NAME`

**Shell usage**
```bash
cd helper-scripts
./cf-unsubscribe.sh
```

**No direct usage in integration tests.** Run manually to tear down a consumer subscription after testing.

---

### `cf-update-env.sh` — Update a Cloud Foundry app environment variable

**Function**  
Logs in to Cloud Foundry and sets a user-provided environment variable on a CF application, then restages the app so the change takes effect.

**Required config (`credentials.json`)**  
`CF_API_ENDPOINT`, `CF_ORG`, `CF_SPACE`, `CF_USERNAME`, `APP_NAME`, `VAR_NAME`, `VAR_VALUE`

**Optional config**  
`CF_PASSWORD` — if left empty you will be prompted at runtime.

**Shell usage**
```bash
cd helper-scripts
./cf-update-env.sh
```

**Usage in integration tests**  
Called via `CfEnvHelper.updateEnv(key, value)`. Not used by any currently active test but available for tests that need to toggle app configuration (e.g. switching a repository ID) between test runs:
```java
CfEnvHelper.updateEnv("REPOSITORY_ID", "<newRepoId>");
```

---

## Java Helper Classes

The scripts are not called directly from test methods. Instead, three Java utility classes provide a clean interface:

### `ShellScriptRunner`

Low-level runner that executes a shell script in a subprocess and streams its output.

| Method | Returns | Description |
|---|---|---|
| `ShellScriptRunner.run(scriptPath, args...)` | `int` exit code | Runs a script; streams stdout with `[script]` prefix and stderr with `[script-err]` prefix |
| `ShellScriptRunner.runAndCaptureOutput(scriptPath, args...)` | `String` last stdout line | Runs a script and returns the last non-empty stdout line; useful for scripts that print a single result value |

Script paths are relative to the Maven working directory (project root), e.g.:
```
src/test/java/integration/com/sap/cds/sdm/utils/create.sh
```

---

### `CmisDocumentHelper`

High-level helper for CMIS document operations. Wraps `ShellScriptRunner` and resolves object IDs automatically.

| Method | Description |
|---|---|
| `createDocumentInCmis(cmisName, filePath, entityId)` | Resolves the `entityId__attachments` folder ID, then uploads the file via `create.sh` |
| `deleteDocumentFromCmis(entityId, fileName)` | Resolves the folder ID and the document object ID, then deletes the document via `delete.sh` |

**Usage in integration tests**

```java
// Order 3 — after verifying a successful PDF upload and save:
CmisDocumentHelper.createDocumentInCmis("README.md", "../README.md", entityID);
CmisDocumentHelper.deleteDocumentFromCmis(entityID, file.getName());
```

---

### `CfEnvHelper`

Helper for updating CF app environment variables. Wraps `cf-update-env.sh` via `ShellScriptRunner`.

| Method | Description |
|---|---|
| `updateEnv(key, value)` | Sets `key=value` on the CF app and restages it |

```java
CfEnvHelper.updateEnv("REPOSITORY_ID", "<newRepoId>");
```

---

## Active test cases & script/helper usage

| Order | Test method | Script / helper invoked |
|---|---|---|
| 1 | `testCreateEntityAndCheck` | — |
| 2 | `testUpdateEmptyEntity` | — |
| 3 | `testUploadSingleAttachmentPDF` | `CmisDocumentHelper.createDocumentInCmis` → `create.sh` (via `get-object-id.sh`) then `CmisDocumentHelper.deleteDocumentFromCmis` → `delete.sh` (via `get-object-id.sh`) |
| 4 | `testUploadVirusFileInScannedRepo` | — |

### Test 3 — `testUploadSingleAttachmentPDF`

Uploads `sample.pdf`, verifies it in draft mode, saves the entity, then verifies the active attachment. On success it also uploads `README.md` to the CMIS repository (as a secondary CMIS-direct test) and immediately deletes `sample.pdf` from CMIS to clean up:

```java
if (response.equals("OK")) {
    testStatus = true;
    CmisDocumentHelper.createDocumentInCmis("README.md", "../README.md", entityID);
    CmisDocumentHelper.deleteDocumentFromCmis(entityID, file.getName());
}
```

### Test 4 — `testUploadVirusFileInScannedRepo`

Uploads the EICAR test file (path supplied via the `eicar.file.path` system property, defaulting to `eicar.com.txt`) and expects it to be **uploaded successfully** — this validates a repository where virus scanning is disabled or configured to allow the file through. The test follows the same verification pattern as Test 3:

1. Edit entity draft
2. Create attachment (EICAR file, `text/plain`)
3. Read attachment in draft mode (`readAttachmentDraft`) — must return `"OK"`
4. Save entity draft
5. Read attachment as active entity (`readAttachment`) — must return `"OK"`

The attachment ID is stored in `attachmentID2` for potential use by subsequent tests.

---

## Typical test workflow

```
1. Fill in test/integration/credentials.json with your actual values
2. (Multi-tenant only) Run cf-subscribe.sh to set up the consumer subscription
3. Place the EICAR test file at the path configured via -Deicar.file.path (or eicar.com.txt)
4. Run the integration tests — scripts are invoked automatically:
      Order 3  →  CmisDocumentHelper.createDocumentInCmis  (create.sh + get-object-id.sh)
               →  CmisDocumentHelper.deleteDocumentFromCmis (delete.sh + get-object-id.sh)
5. (Multi-tenant only) Run cf-unsubscribe.sh to tear down after testing
```

