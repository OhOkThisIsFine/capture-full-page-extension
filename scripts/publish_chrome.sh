#!/usr/bin/env bash
set -euo pipefail

PACKAGE="${1:-}"

if [[ -z "$PACKAGE" || ! -f "$PACKAGE" ]]; then
  echo "Usage: $0 <chrome-package.zip>" >&2
  exit 2
fi

required=(
  CWS_CLIENT_ID
  CWS_CLIENT_SECRET
  CWS_REFRESH_TOKEN
  CWS_PUBLISHER_ID
  CWS_EXTENSION_ID
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
done

echo "Obtaining Chrome Web Store access token..."
TOKEN_JSON="$(
  curl --fail-with-body --silent --show-error     -X POST "https://oauth2.googleapis.com/token"     --data-urlencode "client_id=$CWS_CLIENT_ID"     --data-urlencode "client_secret=$CWS_CLIENT_SECRET"     --data-urlencode "refresh_token=$CWS_REFRESH_TOKEN"     --data-urlencode "grant_type=refresh_token"
)"

ACCESS_TOKEN="$(jq -er '.access_token' <<<"$TOKEN_JSON")"
ITEM="publishers/$CWS_PUBLISHER_ID/items/$CWS_EXTENSION_ID"

echo "Uploading $PACKAGE to Chrome Web Store item $CWS_EXTENSION_ID..."
UPLOAD_JSON="$(
  curl --fail-with-body --silent --show-error     -X POST     -H "Authorization: Bearer $ACCESS_TOKEN"     -H "Content-Type: application/zip"     --data-binary "@$PACKAGE"     "https://chromewebstore.googleapis.com/upload/v2/$ITEM:upload"
)"

echo "$UPLOAD_JSON" | jq .
UPLOAD_STATE="$(jq -r '.uploadState // "UPLOAD_STATE_UNSPECIFIED"' <<<"$UPLOAD_JSON")"

if [[ "$UPLOAD_STATE" == "IN_PROGRESS" ]]; then
  echo "Upload is processing; polling status..."
  for attempt in $(seq 1 60); do
    sleep 5
    STATUS_JSON="$(
      curl --fail-with-body --silent --show-error         -H "Authorization: Bearer $ACCESS_TOKEN"         "https://chromewebstore.googleapis.com/v2/$ITEM:fetchStatus"
    )"

    UPLOAD_STATE="$(jq -r '.lastAsyncUploadState // "NOT_FOUND"' <<<"$STATUS_JSON")"
    echo "Upload state: $UPLOAD_STATE"

    case "$UPLOAD_STATE" in
      SUCCEEDED)
        break
        ;;
      FAILED)
        echo "$STATUS_JSON" | jq . >&2
        echo "Chrome Web Store upload failed." >&2
        exit 1
        ;;
      IN_PROGRESS|NOT_FOUND|UPLOAD_STATE_UNSPECIFIED)
        ;;
      *)
        echo "Unexpected Chrome Web Store upload state: $UPLOAD_STATE" >&2
        echo "$STATUS_JSON" | jq . >&2
        exit 1
        ;;
    esac

    if [[ "$attempt" == "60" ]]; then
      echo "Timed out waiting for Chrome Web Store upload processing." >&2
      exit 1
    fi
  done
elif [[ "$UPLOAD_STATE" != "SUCCEEDED" ]]; then
  echo "Chrome Web Store upload did not succeed: $UPLOAD_STATE" >&2
  exit 1
fi

echo "Submitting Chrome Web Store item for review/publication..."
PUBLISH_JSON="$(
  curl --fail-with-body --silent --show-error     -X POST     -H "Authorization: Bearer $ACCESS_TOKEN"     -H "Content-Type: application/json"     -d '{"publishType":"DEFAULT_PUBLISH","blockOnWarnings":true}'     "https://chromewebstore.googleapis.com/v2/$ITEM:publish"
)"

echo "$PUBLISH_JSON" | jq .
echo "Chrome Web Store submission completed."
