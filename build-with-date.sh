#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node build-with-date.js "$@"
