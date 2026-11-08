#!/usr/bin/env bash
# Builds and signs release/Ultron.apk without Gradle, using only aapt2 + zipalign + apksigner.
# Works with Android SDK build-tools or Debian/Ubuntu packages:
#   sudo apt install aapt apksigner zipalign android-sdk-platform-23
#
# Env overrides: ANDROID_JAR, AAPT2, ZIPALIGN, APKSIGNER, KEYSTORE, KEY_ALIAS, KEY_PASS
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HERE/watchface/src/main"
OUT="$HERE/build/apk"
ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
AAPT2="${AAPT2:-aapt2}"
ZIPALIGN="${ZIPALIGN:-zipalign}"
APKSIGNER="${APKSIGNER:-apksigner}"
KEYSTORE="${KEYSTORE:-$HOME/.android/ultron.keystore}"
KEY_ALIAS="${KEY_ALIAS:-ultron}"
KEY_PASS="${KEY_PASS:-ultronprotocol}"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"

rm -rf "$OUT" && mkdir -p "$OUT/compiled" "$HERE/release"

echo "> compiling resources"
"$AAPT2" compile --dir "$SRC/res" -o "$OUT/compiled/res.zip"

echo "> linking"
# Gradle injects the package from build.gradle's namespace; do the same here
sed 's|<manifest |<manifest package="com.ultronprotocol.watchface" |' "$SRC/AndroidManifest.xml" > "$OUT/AndroidManifest.xml"
"$AAPT2" link -o "$OUT/unsigned.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$OUT/AndroidManifest.xml" \
  --min-sdk-version 34 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 xml -0 ttf -0 png \
  "$OUT/compiled/res.zip"

echo "> aligning"
"$ZIPALIGN" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "> creating signing key $KEYSTORE"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -storepass "$KEY_PASS" -keypass "$KEY_PASS" \
    -dname "CN=Ultron Watch Face, O=Fan build" >/dev/null 2>&1
fi

echo "> signing"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEY_PASS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version 34 --v4-signing-enabled false \
  --out "$HERE/release/Ultron.apk" "$OUT/aligned.apk"
"$APKSIGNER" verify --min-sdk-version 34 "$HERE/release/Ultron.apk"
echo "> done: $HERE/release/Ultron.apk ($(du -h "$HERE/release/Ultron.apk" | cut -f1))"
