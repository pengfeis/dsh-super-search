#!/usr/bin/env bash
# Publish dsh-super-search to GitHub and cut the release named by package.json.
#
#   ./dist/publish.sh <github-owner>
#
# Requires: `gh auth login` (or GH_TOKEN), git identity, npm.
set -euo pipefail

OWNER="${1:?usage: publish.sh <github-owner>   e.g. pengfeis}"
REPO="dsh-super-search"
SLUG="$OWNER/$REPO"

cd "$(dirname "$0")/.."

VERSION="$(python3 -c "import json; print(json.load(open('package.json'))['version'])")"
TAG="v$VERSION"
TARBALL="dist/$REPO-$VERSION.tgz"
NOTES="dist/RELEASE-$TAG.md"

gh auth status >/dev/null 2>&1 || {
  echo "not authenticated: run 'gh auth login' first" >&2
  exit 1
}

echo "==> publishing $SLUG ($TAG) from $(pwd)"

if gh repo view "$SLUG" >/dev/null 2>&1; then
  echo "==> repository exists; pushing the branch and tags"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$SLUG.git"
  git push origin main
  git push origin --tags
else
  gh repo create "$SLUG" --public --source . --push \
    --description "Global search over DeepSeek Harness conversations: user questions and assistant answers only."
  git push origin --tags
fi

echo "==> topics"
gh repo edit "$SLUG" --add-topic dsh-plugin --add-topic dsh --add-topic search

echo "==> release $TAG"
if gh release view "$TAG" --repo "$SLUG" >/dev/null 2>&1; then
  echo "==> release $TAG already exists"
else
  rm -f dist/*.tgz dist/*.sha256
  npm pack --pack-destination dist >/dev/null
  ( cd dist && shasum -a 256 "$(basename "$TARBALL")" > "$(basename "$TARBALL").sha256" )
  gh release create "$TAG" --repo "$SLUG" \
    --title "$TAG" \
    --notes-file "$NOTES" \
    "$TARBALL" "$TARBALL.sha256"
fi

echo
echo "done: https://github.com/$SLUG"
echo "install as: plugin_manager install_bundle target=git+https://github.com/$SLUG.git#$TAG"
