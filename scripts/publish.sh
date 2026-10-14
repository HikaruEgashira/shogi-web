#!/usr/bin/env bash
# Upload the built release to its immutable path and verify it through the CDN before anything public changes.
set -euo pipefail
: "${SITE_BUCKET:?}" "${SITE_URL:?}" "${GITHUB_SHA:?}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
release="s3://${SITE_BUCKET}/releases/${GITHUB_SHA}"
aws s3 sync dist/ "${release}/" --exclude '*.bin' --exclude '*.wasm' --cache-control 'public,max-age=31536000,immutable' --only-show-errors
# Precompress binary assets: CloudFront does not compress every binary MIME type.
mkdir -p .cache/publish
for file in nn.bin progress.bin yaneuraou.wasm; do
  gzip -n -9 -c "dist/engine/${file}" > ".cache/publish/${file}.gz"
  content_type=application/octet-stream
  if [[ "$file" == *.wasm ]]; then content_type=application/wasm; fi
  aws s3 cp ".cache/publish/${file}.gz" "${release}/engine/${file}" --content-type "$content_type" --content-encoding gzip --cache-control 'public,max-age=31536000,immutable' --only-show-errors
done
# The candidate URL serves the complete app, so the product is played over the CDN before it can become public.
candidate="${SITE_URL%/}/releases/${GITHUB_SHA}/index.html"
bun scripts/smoke.mjs "$candidate" "$GITHUB_SHA"
bun scripts/play.mjs "$candidate"
