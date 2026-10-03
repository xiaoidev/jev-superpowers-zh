#!/usr/bin/env bash
# jev-readiness 就绪检测测试（全部离线）
# 依据：docs/superpowers/specs/2026-10-03-jev-superpowers-zh-integration-design.md
#       §4.2 后端协议、§4.3 两类失败、§5.1 配置、§5.2 就绪探测
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RD="$ROOT/scripts/jev-readiness"

TMP="$(mktemp -d)"
STATE_DIR="$TMP/state"
BIN="$TMP/bin"
mkdir -p "$TMP/home" "$STATE_DIR" "$BIN"
cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

# 就绪缓存重定向到夹具目录，保证可定位、不污染系统临时目录
export HOME="$TMP/home"
export TMPDIR="$STATE_DIR"
SAVED_PATH="$PATH"

# 从真实 PATH 中剔除任何「含 jev 门禁工具」的目录，构造 CLEAN_PATH：
# 让「无工具/部分工具」用例在真实装了 jev-* 的机器上也确定。Git Bash 的
# /usr/bin、System32 等不含目标工具，原样保留；剔除以「目录含目标工具」为唯一条件。
build_clean_path() {
  local dir tool stage="" clean="" tainted
  local IFS=':'
  # 第一轮：剔除直接含目标可执行文件（git-jev 按 git 子命令载体文件名识别）的目录
  for dir in $SAVED_PATH; do
    [ -n "$dir" ] || continue
    tainted=0
    for tool in jev-axi jev-scout jev-guard supercov limpet git-jev; do
      if [ -x "$dir/$tool" ] && [ ! -d "$dir/$tool" ]; then tainted=1; break; fi
    done
    [ "$tainted" = 0 ] && stage="${stage:+$stage:}$dir"
  done
  # 第二轮：目录内 git 若支持 `git jev` 子命令（与本脚本就绪探测同口径），一并剔除；
  # 以第一轮结果为 PATH 基底，保证 Git Bash 自身 git 能正常启动并给出“无此子命令”
  for dir in $stage; do
    if [ -x "$dir/git" ] && [ ! -d "$dir/git" ] \
       && PATH="$dir:$stage" git jev --version >/dev/null 2>&1; then
      continue
    fi
    clean="${clean:+$clean:}$dir"
  done
  printf '%s' "$clean"
}
CLEAN_PATH="$(build_clean_path)"
export PATH="$BIN:$CLEAN_PATH"

PASS_COUNT=0
FAIL_COUNT=0
ok()   { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok - %s\n' "$1"; }
no()   { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_eq() { if [ "$1" = "$2" ]; then ok "$3"; else no "$3 (got [$1] want [$2])"; fi; }
assert_contains() { case "$1" in *"$2"*) ok "$3";; *) no "$3 (missing [$2])";; esac; }
assert_match() { if printf '%s' "$1" | grep -Eq "$2"; then ok "$3"; else no "$3 ([$1] !~ /$2/)"; fi; }

# 从 stdin 读 JSON，取字段（数组以逗号拼接）
jget() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const k=process.argv[1];let v=j[k];if(Array.isArray(v))v=v.join(",");process.stdout.write(String(v));});' "$1"
}

clear_state() { rm -f "$STATE_DIR"/jevzh-*.state 2>/dev/null || true; }
state_file() { ls "$STATE_DIR"/jevzh-*.state 2>/dev/null | head -1; }

# 最小伪造本地桥：/h/health 返回 laya_installed:false，/l/health 返回 true
cat > "$TMP/bridge.js" <<'EOF'
const http = require('http');
const srv = http.createServer((req, res) => {
  const laya = req.url.indexOf('/l/') === 0;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    engine: laya ? 'laya-421m' : 'laya-heuristic-fallback',
    open_weights: true,
    license: 'Apache-2.0',
    laya_installed: laya
  }));
});
srv.listen(0, '127.0.0.1', () => {
  require('fs').writeFileSync(process.argv[2], String(srv.address().port));
});
EOF
PORTFILE="$TMP/port"
node "$TMP/bridge.js" "$PORTFILE" &
BRIDGE_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -s "$PORTFILE" ] && break
  sleep 0.1
done
PORT="$(cat "$PORTFILE")"
HURL="http://127.0.0.1:$PORT/h"
LURL="http://127.0.0.1:$PORT/l"
CLOSED_URL="http://127.0.0.1:1"

ALL_SIX="jev-axi,jev-scout,jev-guard,git-jev,supercov,limpet"

# 运行 readiness --json，结果写入 OUT / RC；用法：rd_run <project> [额外参数...]
rd_run() {
  local proj="$1"; shift
  OUT="$(bash "$RD" --project "$proj" "$@" --json 2>"$TMP/rd.err")"
  RC=$?
}
rd_human() {
  local proj="$1"; shift
  OUT="$(bash "$RD" --project "$proj" "$@" 2>"$TMP/rd.err")"
  RC=$?
}

mkproj() { mkdir -p "$1"; }
putcfg() { printf '%s' "$2" > "$1/.jevzh.json"; }

simple_stub() { printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/$1"; chmod +x "$BIN/$1"; }

install_six_stubs() {
  rm -f "$BIN"/* 2>/dev/null || true
  for t in jev-axi jev-scout jev-guard supercov limpet; do simple_stub "$t"; done
  cat > "$BIN/git" <<'EOF'
#!/usr/bin/env bash
# 被 exec 为 git 时，桩内 $1=jev、$2=子命令（脚本路径占 $0）
case "${1:-}" in
  jev)
    case "${2:-}" in
      --version) exit 0 ;;
    esac ;;
esac
exit 0
EOF
  chmod +x "$BIN/git"
}

# ---------------------------------------------------------------------------
# 组 1：无任何工具（真实 git 无 jev 子命令，git-jev 同样判缺）
# ---------------------------------------------------------------------------
P1="$TMP/p1"; mkproj "$P1"
ENV_CLEAN='TYPESAFE_API_KEY= TYPESAFE_BASE_URL= JEVZH_BACKEND= JEVZH_STRICT='

clear_state
env -u TYPESAFE_BASE_URL -u TYPESAFE_API_KEY -u JEVZH_BACKEND -u JEVZH_STRICT \
  bash "$RD" --project "$P1" --json > "$TMP/o1" 2>"$TMP/e1"
RC=$?
OUT="$(cat "$TMP/o1")"
assert_eq "$RC" "0" "1.1 无工具无配置：退出码恒 0"
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "1.2 无工具：state=DEGRADED"
assert_eq "$(jget missingTools <<<"$OUT")" "$ALL_SIX" "1.3 missingTools 含固定顺序 6 项"
assert_eq "$(jget backend <<<"$OUT")" "none" "1.4 无后端可达：backend=none"

clear_state
putcfg "$P1" '{"backend":"off","strict":false}'
rd_run "$P1"
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "1.5 backend=off：DEGRADED"
assert_eq "$(jget backend <<<"$OUT")" "none" "1.6 backend=off：backend=none"

# auto + 显式不可达 baseUrl（离线、连接拒绝瞬时返回），同样 DEGRADED
clear_state
rm -f "$P1/.jevzh.json"
TYPESAFE_BASE_URL="$CLOSED_URL" rd_run "$P1"
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "1.7 auto+不可达 URL：仍 DEGRADED"

# ---------------------------------------------------------------------------
# 组 2：6 工具齐 + backend=off → DEGRADED
# ---------------------------------------------------------------------------
install_six_stubs
P2="$TMP/p2"; mkproj "$P2"; putcfg "$P2" '{"backend":"off"}'
clear_state
rd_run "$P2"
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "2.1 6 工具+off：DEGRADED"
assert_eq "$(jget missingTools <<<"$OUT")" "" "2.2 missingTools 为空"

# ---------------------------------------------------------------------------
# 组 3：6 工具齐 + 伪造本地桥 → LOCAL(heuristic) / FULL(laya)
# ---------------------------------------------------------------------------
P3="$TMP/p3"; mkproj "$P3"
clear_state
TYPESAFE_BASE_URL="$HURL" rd_run "$P3"
assert_eq "$(jget state <<<"$OUT")" "LOCAL" "3.1 heuristic 桥：LOCAL"
assert_eq "$(jget backend <<<"$OUT")" "heuristic" "3.2 backend=heuristic"
assert_eq "$(jget missingTools <<<"$OUT")" "" "3.3 工具齐"

clear_state
TYPESAFE_BASE_URL="$LURL" rd_run "$P3"
assert_eq "$(jget state <<<"$OUT")" "FULL" "3.4 laya 桥：FULL"
assert_eq "$(jget backend <<<"$OUT")" "laya" "3.5 backend=laya"

# backend=local + json.baseUrl（无环境变量）也走本地桥探测
clear_state
putcfg "$P3" "{\"backend\":\"local\",\"baseUrl\":\"$HURL\"}"
rd_run "$P3"
assert_eq "$(jget backend <<<"$OUT")" "heuristic" "3.6 json backend=local+baseUrl：heuristic"
rm -f "$P3/.jevzh.json"

# backend=cloud 但云端不可达 → none（带真实样式 key，经不可达 URL 探测，离线）
clear_state
TYPESAFE_API_KEY="sk-fake-not-local" TYPESAFE_BASE_URL="$CLOSED_URL" JEVZH_BACKEND="cloud" rd_run "$P3"
assert_eq "$(jget backend <<<"$OUT")" "none" "3.7 cloud 不可达：backend=none"
assert_eq "$(jget state <<<"$OUT")" "PARTIAL" "3.8 工具齐但 backend=none：PARTIAL"

# ---------------------------------------------------------------------------
# 组 4：仅 3 个 stub → PARTIAL，清单准确
# ---------------------------------------------------------------------------
rm -f "$BIN"/*
simple_stub jev-axi; simple_stub jev-scout; simple_stub supercov
P4="$TMP/p4"; mkproj "$P4"
clear_state
TYPESAFE_BASE_URL="$CLOSED_URL" rd_run "$P4"
assert_eq "$(jget state <<<"$OUT")" "PARTIAL" "4.1 部分工具：PARTIAL"
assert_eq "$(jget missingTools <<<"$OUT")" "jev-guard,git-jev,limpet" "4.2 missingTools 正确"
install_six_stubs

# ---------------------------------------------------------------------------
# 组 5：配置优先级 env > json > 默认
# ---------------------------------------------------------------------------
P5="$TMP/p5"; mkproj "$P5"
clear_state
putcfg "$P5" '{"backend":"auto","strict":false}'
JEVZH_STRICT=1 TYPESAFE_BASE_URL="$HURL" rd_run "$P5"
assert_eq "$(jget strict <<<"$OUT")" "true" "5.1 JEVZH_STRICT=1 覆盖 json false"

clear_state
putcfg "$P5" '{"backend":"auto","strict":true}'
TYPESAFE_BASE_URL="$HURL" rd_run "$P5"
assert_eq "$(jget strict <<<"$OUT")" "true" "5.2 json strict true 无 env 生效"

clear_state
rm -f "$P5/.jevzh.json"
TYPESAFE_BASE_URL="$HURL" rd_run "$P5"
assert_eq "$(jget strict <<<"$OUT")" "false" "5.3 默认 strict=false"

clear_state
putcfg "$P5" '{"backend":"auto","strict":true}'
JEVZH_BACKEND=off rd_run "$P5"
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "5.4 JEVZH_BACKEND=off 覆盖 json auto"
assert_eq "$(jget strict <<<"$OUT")" "true" "5.5 strict 仍取 json true"

# "local" 不是真实云 key：auto + local key + 不可达 URL → none（不触发云路径）
clear_state
rm -f "$P5/.jevzh.json"
TYPESAFE_API_KEY=local TYPESAFE_BASE_URL="$CLOSED_URL" rd_run "$P5"
assert_eq "$(jget backend <<<"$OUT")" "none" "5.6 TYPESAFE_API_KEY=local 不视为云 key"

# ---------------------------------------------------------------------------
# 组 6：state 文件字段、--cached、--mark-notified
# ---------------------------------------------------------------------------
P6="$TMP/p6"; mkproj "$P6"; putcfg "$P6" '{"backend":"off"}'
clear_state
rd_run "$P6"
SF="$(state_file)"
assert_match "$SF" "jevzh-.+\.state$" "6.1 缓存文件落在系统临时目录"

# 字段齐全且类型正确
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const keys=Object.keys(j).sort().join(",");
if(keys!=="backend,missingTools,notified,state,strict,ts") throw new Error("字段不符: "+keys);
if(typeof j.state!=="string") throw new Error("state 非字符串");
if(!Array.isArray(j.missingTools)) throw new Error("missingTools 非数组");
if(!["cloud","laya","heuristic","none"].includes(j.backend)) throw new Error("backend 非法");
if(typeof j.strict!=="boolean") throw new Error("strict 非布尔");
if(typeof j.notified!=="boolean") throw new Error("notified 非布尔");
if(typeof j.ts!=="number"||j.ts<=0) throw new Error("ts 非数字");
process.stdout.write("ok");
' "$SF" > "$TMP/62" 2>"$TMP/62e"
assert_eq "$(cat "$TMP/62")" "ok" "6.2 state 六字段齐全、类型正确"
[ -s "$TMP/62e" ] && no "6.2 节点报错：$(cat "$TMP/62e")"

TS1="$(jget ts <<<"$OUT")"
assert_eq "$(jget notified <<<"$OUT")" "false" "6.3 新探测 notified=false"

sleep 1
rd_run "$P6" --cached
TS_CACHED="$(jget ts <<<"$OUT")"
assert_eq "$TS_CACHED" "$TS1" "6.4 --cached 不重新探测（ts 不变）"

sleep 1
rd_run "$P6"
TS2="$(jget ts <<<"$OUT")"
if [ "$TS2" -gt "$TS1" ]; then ok "6.5 不带 --cached 重新探测（ts 刷新）"; else no "6.5 ts 未刷新（$TS2 <= $TS1）"; fi
assert_eq "$(jget notified <<<"$OUT")" "false" "6.6 重新探测继承 notified=false"

rd_run "$P6" --mark-notified
assert_eq "$(jget notified <<<"$OUT")" "true" "6.7 --mark-notified 翻转 notified"
SF_NOTIFIED="$(jget notified <"$SF")"
assert_eq "$SF_NOTIFIED" "true" "6.8 notified 已持久化到缓存"

rd_run "$P6"
assert_eq "$(jget notified <<<"$OUT")" "true" "6.9 新探测继承旧缓存 notified=true"

rd_run "$P6" --cached
assert_eq "$(jget notified <<<"$OUT")" "true" "6.10 --cached 读到 notified=true"

clear_state
rd_run "$P6" --cached
assert_eq "$(jget state <<<"$OUT")" "DEGRADED" "6.11 --cached 缓存缺失时回退正常探测"
SF612="$(state_file)"
if [ -n "$SF612" ] && [ -f "$SF612" ] \
   && printf '%s' "$SF612" | grep -Eq 'jevzh-.+\.state$'; then
  ok "6.12 回退探测后已写缓存（路径非空、文件存在、命名 jevzh-*.state）"
else
  no "6.12 缓存断言失败（state_file=[$SF612]）"
fi

# --cached 命中时 --mark-notified 也应更新缓存
rd_run "$P6" --mark-notified
assert_eq "$(jget notified <"$SF")" "true" "6.13 缓存内 notified 保持 true"

# ---------------------------------------------------------------------------
# 组 7：--json 可解析 + 人类报告含安装命令
# 注意：此时 BIN 已装 6 stub，组 7 需要“无工具”环境：PATH 去掉 BIN 并用
# CLEAN_PATH（已剔除真实系统中可能安装的 jev-* 工具目录）模拟
# ---------------------------------------------------------------------------
clear_state
OUT="$(PATH="$CLEAN_PATH" bash "$RD" --project "$P1" --json 2>"$TMP/rd.err")"
node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write("ok")' <<<"$OUT" > "$TMP/71"
assert_eq "$(cat "$TMP/71")" "ok" "7.1 --json 输出可被 JSON.parse"

OUT="$(PATH="$CLEAN_PATH" bash "$RD" --project "$P1" 2>"$TMP/rd.err")"
RC=$?
assert_eq "$RC" "0" "7.2 人类报告退出码 0"
assert_contains "$OUT" "DEGRADED" "7.3 报告含四态"
assert_contains "$OUT" "cargo install jev-scout" "7.4 jev-scout 安装命令"
assert_contains "$OUT" "npm install -g jev-axi" "7.5 jev-axi 安装命令"
assert_contains "$OUT" "git jev install" "7.6 git-jev 安装命令"
assert_contains "$OUT" "npm install -g jev-guard" "7.7 jev-guard 安装命令"
assert_contains "$OUT" "npm install -g supercov" "7.8 supercov 安装命令"
assert_contains "$OUT" "cargo install limpet" "7.9 limpet 安装命令"
assert_contains "$OUT" "http://127.0.0.1:8000" "7.10 报告含默认 baseUrl"

# 参数错误非 0
bash "$RD" --bogus >/dev/null 2>&1
[ $? -ne 0 ] && ok "7.11 未知参数退出码非 0" || no "7.11 未知参数未报错"

printf '\n==== readiness: PASS=%d FAIL=%d ====\n' "$PASS_COUNT" "$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
exit 0
