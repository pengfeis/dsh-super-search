#!/usr/bin/env bash
# Publish dsh-super-search to GitHub and cut the v1.0.0 release.
#
#   ./dist/publish.sh <github-owner>
#
# Requires: `gh auth login` (or GH_TOKEN), git identity, npm.
set -euo pipefail

OWNER="${1:?usage: publish.sh <github-owner>   e.g. supengfei}"
REPO="dsh-super-search"
SLUG="$OWNER/$REPO"

cd "$(dirname "$0")/.."

gh auth status >/dev/null 2>&1 || {
  echo "not authenticated: run 'gh auth login' first" >&2
  exit 1
}

echo "==> publishing $SLUG from $(pwd)"

if gh repo view "$SLUG" >/dev/null 2>&1; then
  echo "==> repository exists; pushing the branch and tag"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$SLUG.git"
  git push -u origin main
  git push origin --tags
else
  gh repo create "$SLUG" --public --source . --push \
    --description "Global search over DeepSeek Harness conversations: user questions and assistant answers only."
  git push origin --tags
fi

echo "==> topics"
gh repo edit "$SLUG" --add-topic dsh-plugin --add-topic dsh --add-topic search

echo "==> release v1.0.0"
if gh release view v1.0.0 --repo "$SLUG" >/dev/null 2>&1; then
  echo "==> release v1.0.0 already exists"
else
  npm pack --pack-destination dist >/dev/null
  ( cd dist && shasum -a 256 "$REPO-1.0.0.tgz" > "$REPO-1.0.0.tgz.sha256" )
  gh release create v1.0.0 --repo "$SLUG" \
    --title "v1.0.0" \
    --notes-file dist/RELEASE-v1.0.0.md \
    "dist/$REPO-1.0.0.tgz" "dist/$REPO-1.0.0.tgz.sha256"
fi

echo
echo "done: https://github.com/$SLUG"
echo "install as: plugin_manager install_bundle target=git+https://github.com/$SLUG.git#v1.0.0"
