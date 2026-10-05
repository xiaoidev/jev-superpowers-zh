#!/usr/bin/env bash
# scripts/run-bash-tests.sh — 全仓 bash/离线套件统一入口
#
# 覆盖：
#   tests/jev-gate/*.test.sh        门禁四件套（bridge/gate/hooks/readiness）
#   tests/audit/audit.test.sh       双上游审计的 shell 侧断言
#   tests/brainstorm-server/        头脑风暴可视化服务器（node 检查 + bash 套件）
#   tests/pi|opencode|kimi/         三宿主插件离线套件（node 显式驱动）
#
# node:test 编写的 .check.mjs/.check.js 刻意不匹配 node --test 发现规则，
# 只由本入口枚举的各 run-tests.sh 显式驱动，避免 `npm test` 重复计数。
# 云端 claude CLI 依赖套件（claude-code/explicit-skill-requests/
# skill-triggering/subagent-driven-dev）不随本入口运行。
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SUITES=(
  "tests/jev-gate/bridge.test.sh"
  "tests/jev-gate/gate.test.sh"
  "tests/jev-gate/hooks.test.sh"
  "tests/jev-gate/readiness.test.sh"
  "tests/audit/audit.test.sh"
  "tests/brainstorm-server/run-tests.sh"
  "tests/pi/run-tests.sh"
  "tests/opencode/run-tests.sh"
  "tests/kimi/run-tests.sh"
)

pass_count=0
fail_count=0
failed_suites=()

for suite in "${SUITES[@]}"; do
  echo ""
  echo "==================== ${suite} ===================="
  if bash "$suite"; then
    pass_count=$((pass_count + 1))
  else
    fail_count=$((fail_count + 1))
    failed_suites+=("$suite")
  fi
done

echo ""
echo "==================== bash 套件汇总 ===================="
echo "  通过套件: ${pass_count}"
echo "  失败套件: ${fail_count}"
if [ "$fail_count" -gt 0 ]; then
  printf '  失败清单: %s\n' "${failed_suites[*]}"
  exit 1
fi
echo "  全部通过"
