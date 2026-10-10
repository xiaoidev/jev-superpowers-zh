#!/usr/bin/env bash
# 双上游审计的 bash 冒烟（计划任务 9 步骤 1 权威用例）：
#   1. audit.sh --quick --no-upstream 必须退出 0 且 FAIL=0（离线可跑）
#   2. 参数错误必须 exit 2；-h 必须 exit 0
#   3. 安装器共存开关 --no-jev / --adopt-skills 静态存在
#   4. .upstream-sync.json 含 declaredDivergences
#   5. scripts/audit-divergences.json 合法且 4 项
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
check() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS+1)); echo "  PASS: $desc"
  else
    FAIL=$((FAIL+1)); echo "  FAIL: $desc"
  fi
}

echo "=== audit.test.sh ==="

out=$(bash scripts/audit.sh --quick --no-upstream 2>&1); rc=$?

echo "$out" | tail -6 | sed 's/^/  /'
check "audit.sh --quick --no-upstream 退出码为 0（实际 $rc）" test "$rc" -eq 0
check "审计汇总 FAIL=0" bash -c 'echo "$0" | grep -q "❌ FAIL: 0"' "$out"
check "审计汇总有 PASS 计数" bash -c 'echo "$0" | grep -qE "✅ PASS: [0-9]+"' "$out"

out2=$(bash scripts/audit.sh --bogus-flag 2>&1); rc2=$?
check "未知参数 exit 2（实际 $rc2）" test "$rc2" -eq 2

check "-h/--help exit 0" bash scripts/audit.sh --help

check "bin/jevzh.js 含 --no-jev" grep -q -- --no-jev bin/jevzh.js
check "bin/jevzh.js 含 --adopt-skills" grep -q -- --adopt-skills bin/jevzh.js
check "bin/jevzh.js 含 --keep-router" grep -q -- --keep-router bin/jevzh.js
check ".upstream-sync.json 声明 declaredDivergences" grep -q declaredDivergences .upstream-sync.json
check "audit-divergences.json 合法 JSON" node -e "JSON.parse(require('fs').readFileSync('scripts/audit-divergences.json','utf8'))"
check "audit-divergences.json 恰好 4 项 divergences" \
  node -e "const d=JSON.parse(require('fs').readFileSync('scripts/audit-divergences.json','utf8'));process.exit(d.divergences.length===4?0:1)"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
