#!/usr/bin/env bash
# OpenCode 插件离线套件（直接 node import 仓内插件，无需 symlink/opencode CLI）。
# 源仓 test-plugin-loading.sh 依赖符号链接（Git for Windows 无权限）、
# test-tools.sh/test-priority.sh 需真实 opencode（集成测试，默认不跑），
# bootstrap-caching 源套件断言的缓存实现本 fork 刻意没有，均不迁移；
# 注入语义改由 opencode-plugin.check.mjs 覆盖。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

node "$SCRIPT_DIR/opencode-plugin.check.mjs"
