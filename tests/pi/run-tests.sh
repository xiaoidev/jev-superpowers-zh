#!/usr/bin/env bash
# pi 扩展套件（.pi/extensions/superpowers.ts 为 TS，仅 import type，运行时无类型依赖）。
# Node 22.6–23.5 需要 --experimental-strip-types 才能 import .ts；23.6+ 默认开启，
# 该 flag 仍兼容，故统一显式带上。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

node --experimental-strip-types "$SCRIPT_DIR/pi-extension.check.mjs"
