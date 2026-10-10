#!/usr/bin/env bash
# Kimi 插件清单套件（node 版，零 python 依赖）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

node "$SCRIPT_DIR/kimi-manifest.check.mjs"
