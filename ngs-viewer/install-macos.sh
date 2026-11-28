#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' '이 설치기는 macOS용입니다.' >&2
  exit 1
fi
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
exec node "$here/install.mjs" "$@"
