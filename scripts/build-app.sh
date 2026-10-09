#!/bin/bash
# Builds GOCO.app from the sources in this repository (macOS only).
#
#   scripts/build-app.sh [--arch arm64|x64]
#
# Steps: compile the AppleScript applet, copy the scripts, download the
# official Node.js build from nodejs.org and verify it against SHASUMS256.txt,
# add the licenses, sign ad hoc, verify the signature and zip the result.
#
# Environment:
#   NODE_VERSION  Node.js version without "v" (default: latest LTS from nodejs.org)
#   BUILD_DIR     working directory (default: <repo>/build)
#   DIST_DIR      output directory for the ZIP (default: <repo>/dist)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-$ROOT/build}"
DIST_DIR="${DIST_DIR:-$ROOT/dist}"
ARCH="arm64"

while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$ARCH" in
  arm64|x64) ;;
  *) echo "--arch must be arm64 or x64" >&2; exit 2 ;;
esac

[ "$(uname -s)" = "Darwin" ] || { echo "This script builds a macOS app and must run on macOS." >&2; exit 1; }
for tool in osacompile codesign plutil curl shasum tar ditto; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done

BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$ROOT/app/Info.plist")"
VERSION="$(plutil -extract CFBundleShortVersionString raw "$ROOT/app/Info.plist")"
APP="$BUILD_DIR/GOCO.app"
CACHE="$BUILD_DIR/cache"
mkdir -p "$CACHE" "$DIST_DIR"

# --- Node.js: resolve version, download, verify -----------------------------
if [ -z "${NODE_VERSION:-}" ]; then
  curl -fsSL https://nodejs.org/dist/index.json -o "$CACHE/index.json"
  # index.json lists one release per line, newest first; the first entry with a
  # codename in "lts" is the latest LTS release.
  NODE_VERSION="$(grep -m1 '"lts":"' "$CACHE/index.json" | sed -E 's/.*"version":"v([^"]+)".*/\1/' || true)"
  [ -n "$NODE_VERSION" ] || { echo "Could not determine the latest Node.js LTS version." >&2; exit 1; }
fi
NODE_VERSION="${NODE_VERSION#v}"
NODE_PLATFORM="darwin-$ARCH"
NODE_BASE="node-v$NODE_VERSION-$NODE_PLATFORM"
NODE_DIR="$CACHE/node-v$NODE_VERSION"
mkdir -p "$NODE_DIR"
echo "==> GOCO $VERSION ($ARCH), Node.js v$NODE_VERSION"

if [ ! -f "$NODE_DIR/SHASUMS256.txt" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$NODE_DIR/SHASUMS256.txt"
fi
if [ ! -f "$NODE_DIR/$NODE_BASE.tar.gz" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NODE_BASE.tar.gz" -o "$NODE_DIR/$NODE_BASE.tar.gz"
fi
EXPECTED="$(grep " $NODE_BASE.tar.gz\$" "$NODE_DIR/SHASUMS256.txt" | head -n1 | awk '{print $1}')"
[ -n "$EXPECTED" ] || { echo "No checksum for $NODE_BASE.tar.gz in SHASUMS256.txt." >&2; exit 1; }
ACTUAL="$(shasum -a 256 "$NODE_DIR/$NODE_BASE.tar.gz" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  rm -f "$NODE_DIR/$NODE_BASE.tar.gz"
  echo "Checksum mismatch for $NODE_BASE.tar.gz (expected $EXPECTED, got $ACTUAL). Download removed." >&2
  exit 1
fi
echo "    SHA-256 verified: $ACTUAL"

rm -rf "$NODE_DIR/extract"
mkdir -p "$NODE_DIR/extract"
tar -xzf "$NODE_DIR/$NODE_BASE.tar.gz" -C "$NODE_DIR/extract" "$NODE_BASE/bin/node" "$NODE_BASE/LICENSE"

# --- Applet and bundle layout ------------------------------------------------
rm -rf "$APP"
mkdir -p "$BUILD_DIR"
osacompile -o "$APP" "$ROOT/app/main.applescript"
RES="$APP/Contents/Resources"
cp "$ROOT/app/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/app/applet.icns" "$RES/applet.icns"
# osacompile adds a generic icon catalog; the bundle uses applet.icns instead.
rm -f "$RES/Assets.car"
cp "$ROOT"/src/*.js "$RES/Scripts/"
cp "$NODE_DIR/extract/$NODE_BASE/bin/node" "$RES/node"
chmod 755 "$RES/node"
mkdir -p "$RES/licenses"
cp "$NODE_DIR/extract/$NODE_BASE/LICENSE" "$RES/licenses/NODE-LICENSE.txt"
cp "$ROOT/LICENSE" "$RES/licenses/GOCO-LICENSE.txt"
echo "$NODE_VERSION" > "$RES/licenses/NODE-VERSION.txt"
plutil -lint "$APP/Contents/Info.plist" >/dev/null

# --- Sign and verify ----------------------------------------------------------
xattr -cr "$APP"
codesign --force --deep --sign - --identifier "$BUNDLE_ID" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "    codesign --verify: OK"

# Syntax-check the shipped scripts with the bundled Node when it can run here.
if [ "$ARCH" = "$(uname -m | sed 's/x86_64/x64/')" ]; then
  for script in "$RES"/Scripts/*.js; do "$RES/node" --check "$script"; done
  echo "    node --check: OK"
fi

# --- Package -------------------------------------------------------------------
SUFFIX=""
[ "$ARCH" = "x64" ] && SUFFIX="-x64"
ZIP="$DIST_DIR/GOCO-$VERSION$SUFFIX.zip"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
(cd "$DIST_DIR" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256")
echo "==> $ZIP"
cat "$ZIP.sha256"
