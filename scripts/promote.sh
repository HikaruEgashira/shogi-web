#!/usr/bin/env bash
# Point the public entry page at a published release and verify the public site.
# A release that fails verification is replaced by the release that was public before it.
set -euo pipefail
: "${SITE_BUCKET:?}" "${DISTRIBUTION_ID:?}" "${SITE_URL:?}"
release=${1:?usage: promote.sh RELEASE_COMMIT}
[[ "$release" =~ ^[a-f0-9]{40}$ ]]
bucket="s3://${SITE_BUCKET}"
switch() {
  # Entry files are copied within the bucket, so promotion and rollback need no local build.
  # REPLACE drops the release's immutable cache policy: the entry page must always revalidate.
  for file in licenses.html version.json index.html; do
    content_type=text/html
    if [[ "$file" == *.json ]]; then content_type=application/json; fi
    aws s3 cp "${bucket}/releases/$1/${file}" "${bucket}/${file}" --metadata-directive REPLACE --content-type "$content_type" --cache-control 'no-cache,max-age=0,must-revalidate' --only-show-errors
  done
  # min TTL 0 and no-cache revalidate the entry files; verify the served release while invalidation propagates.
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths / /index.html /licenses.html /version.json --query Invalidation.Id --output text
}
previous=$( (aws s3 cp "${bucket}/version.json" - 2>/dev/null || true) | sed -n 's/.*"commit":"\([a-f0-9]\{40\}\)".*/\1/p')
if [[ "$release" == "${GITHUB_SHA:-}" && "$previous" != "$release" ]] && git cat-file -e "$previous" 2>/dev/null && git merge-base --is-ancestor "$release" "$previous"; then
  echo "Keeping newer public release $previous"
  exit 0
fi
switch "$release"
if bun scripts/smoke.mjs "$SITE_URL" "$release" && bun scripts/play.mjs "$SITE_URL"; then exit 0; fi
echo "::error::${release} failed verification after promotion; restoring ${previous:-nothing}"
if [[ -n "$previous" && "$previous" != "$release" ]]; then switch "$previous"; fi
exit 1
