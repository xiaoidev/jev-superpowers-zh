#!/usr/bin/env bash
# jev-gate 统一门禁入口测试（全部离线）
# 依据：spec §4.1（命令/阈值）、§4.3（环境型失败可软降级，判定型失败永不软放行）、§5.3
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/jev-gate"

TMP="$(mktemp -d)"
STATE_DIR="$TMP/state"
BIN="$TMP/bin"
mkdir -p "$TMP/home" "$STATE_DIR" "$BIN"
cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

export HOME="$TMP/home"
export TMPDIR="$STATE_DIR"
SAVED_PATH="$PATH"

# 从真实 PATH 中剔除任何「含 jev 门禁工具」的目录，构造 CLEAN_PATH：
# 让「缺工具」用例在真实装了 jev-* 的机器上也确定。Git Bash 的 /usr/bin、
# System32 等不含目标工具，原样保留；剔除以「目录含目标工具」为唯一条件。
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
  # 第二轮：目录内 git 若支持 `git jev` 子命令（与 jev-readiness 同口径探测），一并剔除；
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

# 伪造本地桥（laya），矩阵阶段供后端探测
cat > "$TMP/bridge.js" <<'EOF'
const http = require('http');
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', engine: 'laya-421m', laya_installed: true }));
});
srv.listen(0, '127.0.0.1', () => {
  require('fs').writeFileSync(process.argv[2], String(srv.address().port));
});
EOF
PORTFILE="$TMP/port"
node "$TMP/bridge.js" "$PORTFILE" &
BRIDGE_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$PORTFILE" ] && break; sleep 0.1; done
BRIDGE_URL="http://127.0.0.1:$(cat "$PORTFILE")"
CLOSED_URL="http://127.0.0.1:1"
export TYPESAFE_BASE_URL="$BRIDGE_URL"

POFF="$TMP/poff"; mkdir -p "$POFF"
printf '{"backend":"off","strict":false}' > "$POFF/.jevzh.json"
PA="$TMP/pa"; mkdir -p "$PA"   # auto + 上面的 laya 桥

SUBS="pick scout guard commit triage check-hypothesis quality limpet"
skill_of() {
  case "$1" in
    pick) echo brainstorming ;;
    scout) echo writing-plans ;;
    guard|commit) echo executing-plans ;;
    triage|check-hypothesis) echo systematic-debugging ;;
    quality|limpet) echo verification-before-completion ;;
  esac
}
required_tool_of() {
  case "$1" in
    pick|triage|check-hypothesis) echo jev-axi ;;
    scout) echo jev-scout ;;
    guard) echo jev-guard ;;
    commit) echo git-jev ;;
    quality) echo supercov ;;
    limpet) echo limpet ;;
  esac
}

# ---------------------------------------------------------------------------
# 组 1：每门缺工具（此时 BIN 为空，backend=off 项目）——soft 0 + 降级/技能名；strict 2
# ---------------------------------------------------------------------------
for sub in $SUBS; do
  OUT="$(bash "$GATE" --project "$POFF" "$sub" some args </dev/null 2>&1)"
  RC=$?
  assert_eq "$RC" "0" "1.soft rc=$sub"
  assert_contains "$OUT" "[门禁降级]" "1.soft 降级前缀=$sub"
  assert_contains "$OUT" "$(skill_of "$sub")" "1.soft 技能名=$sub"
  assert_contains "$OUT" "$(required_tool_of "$sub")" "1.soft 缺失项=$sub"

  OUT="$(JEVZH_STRICT=1 bash "$GATE" --project "$POFF" "$sub" some args </dev/null 2>&1)"
  RC=$?
  assert_eq "$RC" "2" "1.strict rc=$sub"
done

# ---------------------------------------------------------------------------
# 安装 6 个 env 驱动的 stub
# ---------------------------------------------------------------------------
cat > "$BIN/git" <<'EOF'
#!/usr/bin/env bash
# 被 exec 为 git 时，桩内 $1=jev、$2=子命令（脚本路径占 $0）
case "${1:-}" in
  jev)
    case "${2:-}" in
      --version) exit 0 ;;
      check)
        [ -n "${GIT_JEV_OUT:-}" ] && printf '%s\n' "$GIT_JEV_OUT"
        exit "${GIT_JEV_RC:-0}" ;;
    esac ;;
esac
exit 0
EOF
cat > "$BIN/jev-axi" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  pick)    printf '%s\n' "${AXI_OUT:-confidence: 0.9}"; exit "${AXI_RC:-0}" ;;
  triage)  cat; [ -n "${TRIAGE_OUT:-}" ] && printf '%s\n' "$TRIAGE_OUT"; exit "${TRIAGE_RC:-0}" ;;
  check)   printf '%s\n' "${CHECK_OUT:-p: 0.9}"; exit "${CHECK_RC:-0}" ;;
esac
exit 0
EOF
cat > "$BIN/jev-scout" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${SCOUT_OUT:-3 verified crates found
cargo add serde}"
exit "${SCOUT_RC:-0}"
EOF
cat > "$BIN/jev-guard" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "${GUARD_OUT:-PASS (destructive: 0.01)}"
exit "${GUARD_RC:-0}"
EOF
cat > "$BIN/supercov" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  quality) printf '%s\n' "${SUPERCOV_OUT:-quality ok, 0 weak files}"; exit "${SUPERCOV_RC:-0}" ;;
esac
exit 0
EOF
cat > "$BIN/limpet" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  check) printf '%s\n' "${LIMPET_OUT:-all stop criteria satisfied}"; exit "${LIMPET_RC:-0}" ;;
esac
exit 0
EOF
chmod +x "$BIN"/*

# ---------------------------------------------------------------------------
# 组 2：stub 工具矩阵（后端 laya 可用）
# ---------------------------------------------------------------------------
# commit
OUT="$(GIT_JEV_OUT='[PASS] secrets p=0.02 payload p=0.01' bash "$GATE" --project "$PA" commit 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.commit PASS → 0"
assert_contains "$OUT" "[PASS]" "2.commit 透传原生输出"

OUT="$(GIT_JEV_OUT='[FAIL] secrets p=0.80' bash "$GATE" --project "$PA" commit 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.commit 无 PASS → 2"
assert_contains "$OUT" "判定否决" "2.commit 否决文案"

OUT="$(GIT_JEV_OUT='[PASS]' GIT_JEV_RC=1 bash "$GATE" --project "$PA" commit 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.commit 原生非 0 → 2"

# guard
OUT="$(GUARD_OUT='PASS (destructive: 0.01)' bash "$GATE" --project "$PA" guard 'rm -rf /' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.guard PASS → 0"
OUT="$(GUARD_OUT='verdict: block' bash "$GATE" --project "$PA" guard 'rm -rf /' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.guard block → 2"
assert_contains "$OUT" "判定否决" "2.guard block 否决文案"
OUT="$(GUARD_OUT='??? unknown format' bash "$GATE" --project "$PA" guard x 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.guard 无法识别 → 保守 2"

# pick 置信度四档
OUT="$(AXI_OUT='confidence: 0.94' bash "$GATE" --project "$PA" pick '问题' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.pick 0.94 → 0"
OUT="$(AXI_OUT='confidence: 0.62' bash "$GATE" --project "$PA" pick '问题' 2>&1)"; RC=$?
assert_eq "$RC" "3" "2.pick 0.62 → 3（人工破平）"
assert_contains "$OUT" "人工" "2.pick 人工破平说明"
OUT="$(AXI_OUT='confidence: 0.40' bash "$GATE" --project "$PA" pick '问题' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.pick 0.40 → 2"
assert_contains "$OUT" "判定否决" "2.pick 低置信否决文案"
OUT="$(AXI_OUT='no number at all' bash "$GATE" --project "$PA" pick '问题' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.pick 无法解析 → 2"
OUT="$(AXI_OUT='置信度 confidence：0.95 很高' bash "$GATE" --project "$PA" pick '问题' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.pick 全角冒号 0.95 → 0"
# 多个 confidence 取最后一个
OUT="$(AXI_OUT=$'confidence: 0.20\nrerun confidence: 0.88' bash "$GATE" --project "$PA" pick q 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.pick 多值取最后 0.88 → 0"

# check-hypothesis
OUT="$(CHECK_OUT='hypothesis A, p: 0.81' bash "$GATE" --project "$PA" check-hypothesis 'h?' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.check p=0.81 → 0"
OUT="$(CHECK_OUT='p: 0.5' bash "$GATE" --project "$PA" check-hypothesis 'h?' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.check p=0.5 → 2"
OUT="$(CHECK_OUT=$'p: 0.30\nprobability: 0.72' bash "$GATE" --project "$PA" check-hypothesis 'h?' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.check 取最大概率 0.72 → 0"
OUT="$(CHECK_OUT='no probabilities here' bash "$GATE" --project "$PA" check-hypothesis 'h?' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.check 无概率 → 2"

# scout
OUT="$(SCOUT_OUT='[GATE FAILED] 0 verified crates found.' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.scout 零候选 → 2"
assert_contains "$OUT" "判定否决" "2.scout 否决文案"
OUT="$(SCOUT_OUT='3 verified crates found
cargo add serde' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.scout 有候选 → 0"

# scout 数字前导边界：10/20/100 不得被子串误判为「0 verified crates」
OUT="$(SCOUT_OUT='10 verified crates found' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.scout 10 verified crates → 0（数字边界）"
OUT="$(SCOUT_OUT='20 verified crates found.' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.scout 20 verified crates. → 0（数字边界）"
OUT="$(SCOUT_OUT='100 verified crates' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.scout 100 verified crates → 0（数字边界）"
# 真零候选：前缀消息 + 跨行 GATE FAILED 仍硬失败
OUT="$(SCOUT_OUT=$'[jev-scout] 0 verified crates found.\nGATE FAILED' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.scout 0 verified + GATE FAILED → 2"
# 行尾无标点的 0 candidate（单复数各一）也必须命中（$ 边界）
OUT="$(SCOUT_OUT='0 candidate' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.scout 行尾 0 candidate（单数）→ 2"
OUT="$(SCOUT_OUT='search done: 0 candidates' bash "$GATE" --project "$PA" scout 'need' 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.scout 行尾 0 candidates（复数）→ 2"

# quality
OUT="$(SUPERCOV_OUT='quality ok, 0 weak files' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality 干净 → 0"
OUT="$(SUPERCOV_RC=1 bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality 退出 1 → 2"
OUT="$(SUPERCOV_OUT=$'supercov quality summary\nweak files: 2\nunhandled_errors: 1' SUPERCOV_RC=0 \
  bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality 非零反模式计数 → 2"
assert_contains "$OUT" "判定否决" "2.quality 否决文案"
OUT="$(SUPERCOV_OUT=$'supercov quality\n0 weak files, 0 critical' SUPERCOV_RC=0 \
  bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality 零计数不算否决"

# quality 字段名锚定：字段名之前的数字（Scanned 50）不得被吃进窗口
OUT="$(SUPERCOV_OUT='Scanned 50 files; weak files: 0' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality Scanned 50 不污染 weak files: 0 → 0"
OUT="$(SUPERCOV_OUT='weak files: 3' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality weak files: 3 → 2"
# deep_nesting 浮点阈值严格 >0.90（0.90 本身通过；整数 1 否决）
OUT="$(SUPERCOV_OUT='deep_nesting: 0.5' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality deep_nesting 0.5 → 0"
OUT="$(SUPERCOV_OUT='deep_nesting: 0.90' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality deep_nesting 0.90（边界相等）→ 0"
OUT="$(SUPERCOV_OUT='deep_nesting: 0.95' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality deep_nesting 0.95 → 2"
OUT="$(SUPERCOV_OUT='deep_nesting 1' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality deep_nesting 1（空白分隔）→ 2"
# unhandled_errors / duplicated_logic 属 0 容忍类：任何 >0（含小数）即否决
OUT="$(SUPERCOV_OUT='unhandled_errors: 0' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.quality unhandled_errors 0 → 0"
OUT="$(SUPERCOV_OUT='unhandled_errors: 0.05' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality unhandled_errors 0.05 → 2"
OUT="$(SUPERCOV_OUT='duplicated_logic: 2' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality duplicated_logic 2 → 2"
# 无数字的总结性 critical 标记：同行含 critical 与反模式名 → 否决
OUT="$(SUPERCOV_OUT='unhandled_errors (critical)' bash "$GATE" --project "$PA" quality src 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.quality unhandled_errors 同行 critical → 2"

# limpet（laya 桥可用，但 limpet 门不依赖后端）
OUT="$(LIMPET_RC=0 bash "$GATE" --project "$PA" limpet check 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.limpet 0 → 0"
OUT="$(LIMPET_RC=1 bash "$GATE" --project "$PA" limpet check 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.limpet 1 → 2"
assert_contains "$OUT" "判定否决" "2.limpet 否决文案"

# triage：stdin 原样管道透传，退出码透传语义
OUT="$(printf 'build error 42\n' | TRIAGE_OUT='domain: logic, root_cause: x' bash "$GATE" --project "$PA" triage 2>&1)"; RC=$?
assert_eq "$RC" "0" "2.triage 原生 0 → 0"
assert_contains "$OUT" "build error 42" "2.triage stdin 透传到 stub"
assert_contains "$OUT" "domain: logic" "2.triage 输出回显"
OUT="$(printf 'err\n' | TRIAGE_RC=1 bash "$GATE" --project "$PA" triage 2>&1)"; RC=$?
assert_eq "$RC" "2" "2.triage 原生非 0 → 2"

# ---------------------------------------------------------------------------
# 组 3：backend=off：需后端的门降级；limpet 不依赖后端
# ---------------------------------------------------------------------------
OUT="$(bash "$GATE" --project "$POFF" pick q </dev/null 2>&1)"; RC=$?
assert_eq "$RC" "0" "3.off pick soft → 0"
assert_contains "$OUT" "[门禁降级]" "3.off pick 降级文案"
assert_contains "$OUT" "brainstorming" "3.off pick 技能名"
OUT="$(JEVZH_STRICT=1 bash "$GATE" --project "$POFF" pick q </dev/null 2>&1)"; RC=$?
assert_eq "$RC" "2" "3.off pick strict → 2"

OUT="$(LIMPET_RC=0 bash "$GATE" --project "$POFF" limpet check 2>&1)"; RC=$?
assert_eq "$RC" "0" "3.off limpet 工具在就跑 → 0"
OUT="$(LIMPET_RC=1 bash "$GATE" --project "$POFF" limpet check 2>&1)"; RC=$?
assert_eq "$RC" "2" "3.off limpet 否决仍 2（不软放行）"

# ---------------------------------------------------------------------------
# 组 4：未知子命令 / 无子命令 → 64，用法列 8 门
# ---------------------------------------------------------------------------
OUT="$(bash "$GATE" --project "$PA" frobnicate 2>&1)"; RC=$?
assert_eq "$RC" "64" "4.未知子命令 → 64"
for sub in $SUBS; do assert_contains "$OUT" "$sub" "4.用法清单含 $sub"; done
OUT="$(bash "$GATE" --project "$PA" 2>&1 </dev/null)"; RC=$?
assert_eq "$RC" "64" "4.无子命令 → 64"

# 判定否决在 soft 下同样 exit 2（以 commit 为例，证明不因 soft 放行）
OUT="$(GIT_JEV_OUT='[FAIL]' bash "$GATE" --project "$PA" commit 2>&1)"; RC=$?
assert_eq "$RC" "2" "5.soft 下判定否决仍 2"

# ---------------------------------------------------------------------------
# 组 6：JEVZH_GATE_CACHE=1 时 gate 用 --cached 读就绪缓存
# 先在桥可达时预热缓存；之后把 URL 指向不可达端口：strict 下，走缓存放行、
# 不走缓存阻断——证明缓存生效
# ---------------------------------------------------------------------------
PC="$TMP/pc"; mkdir -p "$PC"
TYPESAFE_BASE_URL="$BRIDGE_URL" bash "$GATE" --project "$PC" pick q >/dev/null 2>&1
OUT="$(JEVZH_GATE_CACHE=1 JEVZH_STRICT=1 TYPESAFE_BASE_URL="$CLOSED_URL" \
  bash "$GATE" --project "$PC" pick q 2>&1)"; RC=$?
assert_eq "$RC" "0" "6.cache=1 strict+后端不可达：读缓存执行 → 0"
OUT="$(JEVZH_STRICT=1 TYPESAFE_BASE_URL="$CLOSED_URL" \
  bash "$GATE" --project "$PC" pick q 2>&1)"; RC=$?
assert_eq "$RC" "2" "6.无缓存 strict+后端不可达：阻断 → 2"

printf '\n==== gate: PASS=%d FAIL=%d ====\n' "$PASS_COUNT" "$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
exit 0
