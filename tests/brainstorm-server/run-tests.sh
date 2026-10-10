#!/usr/bin/env bash
# brainstorm-server 离线套件统一入口（Git Bash 运行；零第三方 npm 依赖）。
#
# 7 个 node 套件命名为 *.check.js（而非 *.test.js）：避免被 `npm test`
# （node --test 自动发现）重复执行，统一由本入口显式驱动。
# 3 个 bash 套件验证 start-server.sh / stop-server.sh / Windows 生命周期决策。
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

fail=0
for f in ws-protocol helper browser-launcher branding auth server lifecycle; do
  echo "===== node $f.check.js ====="
  node "$f.check.js" || fail=1
done

for t in start-server stop-server windows-lifecycle; do
  echo "===== bash $t.test.sh ====="
  bash "$t.test.sh" || fail=1
done

if [ "$fail" -ne 0 ]; then
  echo "brainstorm-server 套件存在失败"
  exit 1
fi
echo "brainstorm-server 全部通过"
