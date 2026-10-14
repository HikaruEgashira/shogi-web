#!/usr/bin/env bash
set -euo pipefail
: "${SITE_BUCKET:?}" "${DISTRIBUTION_ID:?}" "${SITE_URL:?}" "${GITHUB_SHA:?}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
# Upload immutable assets first; the entry page is the release switch.
aws s3 sync dist/ "s3://${SITE_BUCKET}/releases/${GITHUB_SHA}/" --exclude '*.bin' --exclude '*.wasm' --cache-control 'public,max-age=31536000,immutable' --only-show-errors
# Precompress binary assets: CloudFront does not compress every binary MIME type.
mkdir -p .cache/publish
for file in nn.bin progress.bin yaneuraou.wasm; do
  gzip -n -9 -c "dist/engine/${file}" > ".cache/publish/${file}.gz"
  content_type=application/octet-stream
  if [[ "$file" == *.wasm ]]; then content_type=application/wasm; fi
  aws s3 cp ".cache/publish/${file}.gz" "s3://${SITE_BUCKET}/releases/${GITHUB_SHA}/engine/${file}" --content-type "$content_type" --content-encoding gzip --cache-control 'public,max-age=31536000,immutable' --only-show-errors
done
for file in licenses.html version.json index.html; do
  aws s3 cp "dist/${file}" "s3://${SITE_BUCKET}/${file}" --cache-control 'no-cache,max-age=0,must-revalidate' --only-show-errors
done
invalidation=$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths / /index.html /licenses.html /version.json --query Invalidation.Id --output text)
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION_ID" --id "$invalidation"
node scripts/smoke.mjs "$SITE_URL" "$GITHUB_SHA"
