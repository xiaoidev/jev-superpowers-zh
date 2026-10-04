#!/usr/bin/env bash
# 三类钩子（SessionStart/PreToolUse/Stop）合并与软降级测试（全部离线）
# 依据：spec §4.3 两类失败、§5.4 三个钩子、§5.5 本地桥
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="$ROOT/hooks"
GATE="$ROOT/scripts/jev-gate"
RD="$ROOT/scripts/jev-readiness"
BRIDGE_PY="$ROOT/scripts/serve-laya.py"

TMP="$(mktemp -d)"
STATE_DIR="$TMP/state"
BIN="$TMP/bin"
mkdir -p "$TMP/home" "$STATE_DIR" "$BIN"
cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

REAL_HOME="$HOME"   # HOME 随后重定向到夹具目录；python 探测仍需真实用户目录
export HOME="$TMP/home"
export TMPDIR="$STATE_DIR"
SAVED_PATH="$PATH"

# ---------------------------------------------------------------------------
# python 探测（pre-commit 用例需要真实 serve-laya.py 桥让 commit 门真正执行）
# ---------------------------------------------------------------------------
find_python() {
  local c p
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" --version >/dev/null 2>&1; then
      command -v "$c"; return 0
    fi
  done
  for p in \
    "$REAL_HOME"/python-sdk/python3*/python.exe \
    "$REAL_HOME"/AppData/Local/Programs/Python/Python3*/python.exe \
    /c/Python3*/python.exe \
    "$REAL_HOME"/miniconda3/python.exe \
    "$REAL_HOME"/miniforge3/python.exe; do
    [ -x "$p" ] && "$p" --version >/dev/null 2>&1 && { printf '%s' "$p"; return 0; }
  done
  return 1
}
PY="$(find_python)" || PY=""

# 与 gate.test.sh 同口径：从真实 PATH 剔除含 jev 工具/git-jev 子命令的目录
build_clean_path() {
  local dir tool stage="" clean="" tainted
  local IFS=':'
  for dir in $SAVED_PATH; do
    [ -n "$dir" ] || continue
    tainted=0
    for tool in jev-axi jev-scout jev-guard supercov limpet git-jev; do
      if [ -x "$dir/$tool" ] && [ ! -d "$dir/$tool" ]; then tainted=1; break; fi
    done
    [ "$tainted" = 0 ] && stage="${stage:+$stage:}$dir"
  done
  for dir in $stage; do
    if [ -x "$dir/git" ] && [ ! -d "$dir/git" ] \
       && PATH="$dir:$stage" git jev --version >/dev/null 2>&1; then
      continue
    fi
    clean="${clean:+$clean:}$dir"
  done
  printf '%s' "$clean"
}
# 在 CLEAN_PATH 上再剔除含 git 的目录（git 缺失用例）
strip_git_path() {
  local dir out=""
  local IFS=':'
  for dir in $1; do
    if [ -x "$dir/git" ] && [ ! -d "$dir/git" ]; then continue; fi
    out="${out:+$out:}$dir"
  done
  printf '%s' "$out"
}
CLEAN_PATH="$(build_clean_path)"
NOGIT_PATH="$(strip_git_path "$CLEAN_PATH")"
export PATH="$BIN:$CLEAN_PATH"

PASS_COUNT=0
FAIL_COUNT=0
ok()   { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok - %s\n' "$1"; }
no()   { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_eq() { if [ "$1" = "$2" ]; then ok "$3"; else no "$3 (got [$1] want [$2])"; fi; }
assert_contains() { case "$1" in *"$2"*) ok "$3";; *) no "$3 (missing [$2])";; esac; }
assert_not_contains() { case "$1" in *"$2"*) no "$3 (unexpected [$2])";; *) ok "$3";; esac; }

# hook JSON 输出解析：$1=JSON 文本 $2=JS 表达式（o 为解析对象），为真退出 0
oj() {
  printf '%s' "$1" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const o=JSON.parse(s);
      process.exit(eval("("+process.argv[1]+")")?0:1);
    });' "$2"
}
# 取 JSON 字段字符串
ojs() {
  printf '%s' "$1" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const o=JSON.parse(s); const v=eval("("+process.argv[1]+")");
      process.stdout.write(v===undefined||v===null?"":String(v));
    });' "$2"
}

# 起真实 serve-laya.py 桥（commit 门执行用例）
BRIDGE_URL=""
BRIDGE_PID=""
if [ -n "$PY" ] && [ -f "$BRIDGE_PY" ]; then
  BPORT="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});')"
  "$PY" -u "$BRIDGE_PY" --host 127.0.0.1 --port "$BPORT" >"$TMP/bridge.log" 2>&1 &
  BRIDGE_PID=$!
  for _ in $(seq 1 50); do
    curl -sf --max-time 2 "http://127.0.0.1:$BPORT/health" >/dev/null 2>&1 && { BRIDGE_URL="http://127.0.0.1:$BPORT"; break; }
    kill -0 "$BRIDGE_PID" 2>/dev/null || break
    sleep 0.2
  done
fi

# ---------------------------------------------------------------------------
# 组 1：hooks.json / hooks-cursor.json 结构
# ---------------------------------------------------------------------------
CFG_OUT="$(node -e '
  const fs=require("fs"), path=require("path");
  const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const root=process.argv[2];
  const h=cfg.hooks;
  function ck(cond,m){ if(!cond){ console.error("CFG FAIL: "+m); process.exit(1);} }
  ck(h&&h.SessionStart&&h.PreToolUse&&h.Stop, "三事件齐全");
  ck(/startup/.test(h.SessionStart[0].matcher)&&/clear/.test(h.SessionStart[0].matcher)&&/compact/.test(h.SessionStart[0].matcher), "SessionStart matcher");
  ck(h.PreToolUse[0].matcher==="Bash", "PreToolUse matcher=Bash");
  ck(h.Stop[0].matcher==="", "Stop matcher 空");
  for (const ev of ["SessionStart","PreToolUse","Stop"])
    for (const e of h[ev][0].hooks) ck(e.shell==="bash"&&e.async===false, ev+" shell/async");
  const cmds=[h.SessionStart[0].hooks[0].command,h.PreToolUse[0].hooks[0].command,h.Stop[0].hooks[0].command];
  for (const c of cmds){
    const rel=c.replace("${CLAUDE_PLUGIN_ROOT}","").replace(/"/g,"").split(/\s+/)[0];
    ck(fs.existsSync(path.join(root,rel)), "命令路径存在: "+rel);
  }
  console.log("ok");
' "$HOOKS/hooks.json" "$ROOT")"
assert_eq "$CFG_OUT" "ok" "1.hooks.json：三事件/Bash matcher/空 Stop matcher/命令路径均存在"

CUR_OUT="$(node -e '
  const fs=require("fs"), path=require("path");
  const cfg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const root=process.argv[2];
  const h=cfg.hooks;
  function ck(cond,m){ if(!cond){ console.error("CUR FAIL: "+m); process.exit(1);} }
  ck(cfg.version===1, "version=1");
  ck(h&&h.sessionStart&&h.preToolUse&&h.stop, "三事件齐全(camel)");
  ck(h.preToolUse[0].matcher==="Bash", "preToolUse matcher=Bash");
  for (const ev of ["sessionStart","preToolUse","stop"]){
    const cmd=h[ev][0].command;
    const rel=cmd.split(/\s+/)[0].replace(/^\.\//,"");
    ck(fs.existsSync(path.join(root,rel)), "命令路径存在: "+rel);
  }
  console.log("ok");
' "$HOOKS/hooks-cursor.json" "$ROOT")"
assert_eq "$CUR_OUT" "ok" "1.hooks-cursor.json：version 1 + 三事件(camel)/Bash matcher/命令路径"

# ---------------------------------------------------------------------------
# 组 2：session-start
# ---------------------------------------------------------------------------
P1="$TMP/p1"; mkdir -p "$P1"
printf '{"backend":"off","strict":false}' > "$P1/.jevzh.json"

run_ss() { # $@=额外环境变量；在 P1 下执行，stdout 输出
  ( cd "$P1" && env -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI -u MUSE_PLUGIN_ROOT \
      CLAUDE_PLUGIN_ROOT="$ROOT" "$@" bash "$HOOKS/session-start" )
}

OUT="$(run_ss 2>/dev/null)"; RC=$?
assert_eq "$RC" "0" "2.session-start 首次运行 exit 0"
oj "$OUT" 'o.hookSpecificOutput && o.hookSpecificOutput.hookEventName==="SessionStart" && typeof o.hookSpecificOutput.additionalContext==="string"' \
  && ok "2.Claude 分支：hookSpecificOutput.additionalContext（合法 JSON）" || no "2.Claude 分支输出结构错误"
CTX="$(ojs "$OUT" 'o.hookSpecificOutput.additionalContext')"
assert_contains "$CTX" "jev-using-superpowers" "2.注入文本来自 jev-using-superpowers"
assert_contains "$CTX" "EXTREMELY_IMPORTANT" "2.保留 EXTREMELY_IMPORTANT 包裹"
assert_contains "$CTX" "You have superpowers" "2.保留「You have superpowers」语义"
assert_contains "$CTX" "门禁状态" "2.首次：含动态门禁状态段"
assert_contains "$CTX" "DEGRADED" "2.首次：状态为 DEGRADED"
assert_contains "$CTX" "cargo install jev-scout" "2.首次：含缺失工具安装命令（完整段）"
assert_contains "$CTX" "## 本会话门禁状态" "2.首次：含完整段标题"
assert_contains "$CTX" "缺失工具：" "2.首次：完整段含缺失工具清单"

# 第二次：notified=true → 精简一行（注意 SKILL.md 正文本身也含安装命令，
# 故用完整就绪段专属标记「标题/缺失工具清单」判定完整段是否消失）
OUT2="$(run_ss 2>/dev/null)"; RC=$?
assert_eq "$RC" "0" "2.session-start 二次运行 exit 0"
CTX2="$(ojs "$OUT2" 'o.hookSpecificOutput.additionalContext')"
assert_contains "$CTX2" "已提示" "2.二次：精简语含「已提示」"
assert_not_contains "$CTX2" "## 本会话门禁状态" "2.二次：不再含完整段标题"
assert_not_contains "$CTX2" "缺失工具：" "2.二次：不再含缺失工具清单（安装命令随完整段消失）"
assert_contains "$CTX2" "DEGRADED" "2.二次：精简语仍带四态"

# Cursor 分支
OUTC="$(cd "$P1" && env -u CLAUDE_PLUGIN_ROOT -u COPILOT_CLI -u MUSE_PLUGIN_ROOT CURSOR_PLUGIN_ROOT="$ROOT" bash "$HOOKS/session-start")"
oj "$OUTC" 'typeof o.additional_context==="string" && !o.hookSpecificOutput' \
  && ok "2.Cursor 分支：additional_context 且无 hookSpecificOutput" || no "2.Cursor 分支错误"

# Copilot 分支（CLAUDE/CURSOR 均无，COPILOT_CLI=1）
OUTP="$(cd "$P1" && env -u CLAUDE_PLUGIN_ROOT -u CURSOR_PLUGIN_ROOT -u MUSE_PLUGIN_ROOT COPILOT_CLI=1 bash "$HOOKS/session-start")"
oj "$OUTP" 'typeof o.additionalContext==="string" && !o.hookSpecificOutput && o.additional_context===undefined' \
  && ok "2.Copilot 分支：顶层 additionalContext" || no "2.Copilot 分支错误"

# Muse 分支（CLAUDE_PLUGIN_ROOT 与 MUSE_PLUGIN_ROOT 同时存在）
OUTM="$(cd "$P1" && env -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI CLAUDE_PLUGIN_ROOT="$ROOT" MUSE_PLUGIN_ROOT="$ROOT" bash "$HOOKS/session-start")"
oj "$OUTM" 'o.hookSpecificOutput && typeof o.hookSpecificOutput.additionalContext==="string" && o.additional_context===undefined' \
  && ok "2.Muse 分支：hookSpecificOutput" || no "2.Muse 分支错误"

# readiness 损坏/不可执行：注入 JSON 仍合法、exit 0、就绪段为空兜底
FP="$TMP/fakeplugin"; mkdir -p "$FP/hooks" "$FP/skills/jev-using-superpowers" "$FP/scripts"
cp "$HOOKS/session-start" "$FP/hooks/session-start"
printf -- '---\nname: jev-using-superpowers\n---\n# jev-using-superpowers 夹具文本 MARKER_5731\n' \
  > "$FP/skills/jev-using-superpowers/SKILL.md"
printf 'this-is-not-a-valid-shell-command-((( \n' > "$FP/scripts/jev-readiness"
chmod 000 "$FP/scripts/jev-readiness" 2>/dev/null || true
OUTB="$(cd "$P1" && env -u CURSOR_PLUGIN_ROOT -u COPILOT_CLI -u MUSE_PLUGIN_ROOT \
  CLAUDE_PLUGIN_ROOT="$FP" bash "$FP/hooks/session-start" 2>/dev/null)"; RC=$?
assert_eq "$RC" "0" "2.readiness 不可执行：脚本仍 exit 0"
oj "$OUTB" 'o.hookSpecificOutput && typeof o.hookSpecificOutput.additionalContext==="string"' \
  && ok "2.readiness 失败：输出仍为合法 JSON（就绪段空兜底）" || no "2.readiness 失败兜底错误"
assert_contains "$OUTB" "MARKER_5731" "2.readiness 失败：技能注入正文不受影响"

# ---------------------------------------------------------------------------
# 组 3：pre-commit
# ---------------------------------------------------------------------------
P2="$TMP/p2"; mkdir -p "$P2"   # auto + 真实本地桥
POFF="$TMP/poff"; mkdir -p "$POFF"
printf '{"backend":"off","strict":false}' > "$POFF/.jevzh.json"

# stub git（承载 git jev 子命令）
cat > "$BIN/git" <<'EOF'
#!/usr/bin/env bash
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
chmod +x "$BIN/git"

# 非提交命令 → 0（不触达门禁）
OUT="$(printf '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | bash "$HOOKS/pre-commit" 2>&1)"; RC=$?
assert_eq "$RC" "0" "3.非提交命令 → 0"

# 无 stdin → 进入门禁（soft/backend off → 0）
OUT="$(printf '' | bash "$HOOKS/pre-commit" 2>&1)"; RC=$?
assert_eq "$RC" "0" "3.无 stdin：回落门禁（soft）不阻断"

if [ -n "$BRIDGE_URL" ]; then
  # stub git jev check 输出 [PASS] + 桥可达 → 门真正执行并放行。
  # 同 [FAIL] 用例：极端过载下「保守阻断」瞬断（rc=2）做有限重试。
  RC=""
  for _try in 1 2 3 4; do
    OUT="$(cd "$P2" && TYPESAFE_BASE_URL="$BRIDGE_URL" TYPESAFE_API_KEY=local \
      GIT_JEV_OUT='[PASS] secrets p=0.02 payload p=0.01' \
      bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' 2>&1)"
    RC=$?
    case "$RC:$OUT" in
      0:*'[PASS]'*) break ;;
      2:*保守阻断*) sleep 1; continue ;;
      *) break ;;
    esac
  done
  assert_eq "$RC" "0" "3.桥可达 + [PASS]：提交门执行 → 0"
  assert_contains "$OUT" "[PASS]" "3.透传 git jev check 原生输出"

  # 无 [PASS] → 判定否决，soft 也 exit 2。
  # 极端过载下 node 偶发拉起失败会让 gate 走契约内的「就绪状态读取失败…保守阻断」
  # （同样 exit 2，但属基础设施瞬断而非判定路径）；仅对该标记做有限重试。
  RC=""
  for _try in 1 2 3 4; do
    OUT="$(cd "$P2" && TYPESAFE_BASE_URL="$BRIDGE_URL" TYPESAFE_API_KEY=local GIT_JEV_OUT='[FAIL] secrets p=0.80' \
      bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' 2>&1)"
    RC=$?
    case "$RC:$OUT" in
      2:*判定否决*) break ;;
      2:*保守阻断*) sleep 1; continue ;;
      *) break ;;
    esac
  done
  assert_eq "$RC" "2" "3.桥可达 + 无 [PASS]：soft 同样阻断 → 2"
  assert_contains "$OUT" "判定否决" "3.无 PASS：含判定否决中文说明"
else
  no "3.serve-laya.py 桥未启动，跳过提交门真实执行用例（见 bridge.log）"
  no "3.同上"
  no "3.同上"
fi

# backend=off 无桥：soft 降级 → 0 + [门禁降级]
OUT="$(cd "$POFF" && env -u TYPESAFE_BASE_URL bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' 2>&1)"
RC=$?
assert_eq "$RC" "0" "3.环境缺失 soft：降级放行 → 0"
assert_contains "$OUT" "[门禁降级]" "3.soft：输出 [门禁降级]"

# strict → 2
OUT="$(cd "$POFF" && env -u TYPESAFE_BASE_URL JEVZH_STRICT=1 bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git push"}}' 2>&1)"
RC=$?
assert_eq "$RC" "2" "3.环境缺失 strict：阻断 → 2"

# git 不存在
OUT="$(cd "$POFF" && PATH="$NOGIT_PATH" env -u TYPESAFE_BASE_URL bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' 2>&1)"
RC=$?
assert_eq "$RC" "0" "3.git 缺失 soft：WARN 放行 → 0"
assert_contains "$OUT" "WARN" "3.git 缺失 soft：含 WARN"
OUT="$(cd "$POFF" && PATH="$NOGIT_PATH" env -u TYPESAFE_BASE_URL JEVZH_STRICT=1 bash "$HOOKS/pre-commit" <<< '{"tool_name":"Bash","tool_input":{"command":"git commit -m x"}}' 2>&1)"
RC=$?
assert_eq "$RC" "2" "3.git 缺失 strict：阻断 → 2"

# ---------------------------------------------------------------------------
# 组 4：stop（此后撤掉 git stub，让真实 git 接管；limpet 按需 stub）
# ---------------------------------------------------------------------------
rm -f "$BIN/git"
cat > "$BIN/limpet" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  check) printf '%s\n' "${LIMPET_OUT:-all criteria satisfied}"; exit "${LIMPET_RC:-0}" ;;
esac
exit 0
EOF
chmod +x "$BIN/limpet"

make_repo() { # $1=目录  $2=strict(true/false)
  mkdir -p "$1"
  printf '{"backend":"off","strict":%s}' "$2" > "$1/.jevzh.json"
  ( cd "$1" && git init -q && git config user.email t@t && git config user.name t )
}
warm_state() { # 预热 --cached 缓存（strict 由调用环境的 JEVZH_STRICT 决定）
  ( cd "$1" && bash "$RD" --project "$1" --json >/dev/null 2>&1 )
}

# 4.1 未提交变更：soft WARN + 0
R1="$TMP/r1"; make_repo "$R1" false
echo dirty > "$R1/sneaky.txt"
warm_state "$R1"
OUT="$(cd "$R1" && bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "0" "4.未提交变更 soft：exit 0"
assert_contains "$OUT" "WARN" "4.未提交变更 soft：WARN"
assert_contains "$OUT" "未提交" "4.未提交变更 soft：中文提示"

# 4.2 未提交变更：strict → 2
R2="$TMP/r2"; make_repo "$R2" true
echo dirty > "$R2/sneaky.txt"
( cd "$R2" && JEVZH_STRICT=1 bash "$RD" --project "$R2" --json >/dev/null 2>&1 )
OUT="$(cd "$R2" && JEVZH_STRICT=1 bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "2" "4.未提交变更 strict：exit 2"
assert_contains "$OUT" "未提交" "4.未提交变更 strict：中文阻断说明"

# 4.3 test.sh 失败（工作树干净）：soft 0
R3="$TMP/r3"; make_repo "$R3" false
mkdir -p "$R3/scripts"
printf '#!/usr/bin/env bash\nexit 1\n' > "$R3/scripts/test.sh"
( cd "$R3" && git add -A && git commit -qm init )
warm_state "$R3"
OUT="$(cd "$R3" && bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "0" "4.test.sh 失败 soft：exit 0"
assert_contains "$OUT" "test.sh" "4.test.sh 失败 soft：WARN 点名 test.sh"

# 4.4 test.sh 失败：strict 2
R4="$TMP/r4"; make_repo "$R4" true
mkdir -p "$R4/scripts"
printf '#!/usr/bin/env bash\nexit 1\n' > "$R4/scripts/test.sh"
( cd "$R4" && git add -A && git commit -qm init )
( cd "$R4" && JEVZH_STRICT=1 bash "$RD" --project "$R4" --json >/dev/null 2>&1 )
OUT="$(cd "$R4" && JEVZH_STRICT=1 bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "2" "4.test.sh 失败 strict：exit 2"

# 4.5 limpet 可用且否决：soft 也 exit 2（判定型）
R5="$TMP/r5"; make_repo "$R5" false
( cd "$R5" && git commit -qm init --allow-empty )
warm_state "$R5"
OUT="$(cd "$R5" && LIMPET_RC=1 LIMPET_OUT='acceptance criteria not proven' bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "2" "4.limpet 否决 soft：仍 exit 2（判定型不软放行）"
assert_contains "$OUT" "limpet" "4.limpet 否决：中文说明含 limpet"

# 4.6 limpet 缺失 soft：gate 降级 exit 0
R6="$TMP/r6"; make_repo "$R6" false
( cd "$R6" && git commit -qm init --allow-empty )
warm_state "$R6"
OUT="$(cd "$R6" && PATH="$CLEAN_PATH" bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "0" "4.limpet 缺失 soft：降级 exit 0"
assert_contains "$OUT" "[门禁降级]" "4.limpet 缺失 soft：含门禁降级警告"

# 4.7 非 git 目录：前两段跳过（含失败的 test.sh），limpet 缺失 soft → 整体 0
R7="$TMP/r7"; mkdir -p "$R7/scripts"
printf '{"backend":"off","strict":false}' > "$R7/.jevzh.json"
printf '#!/usr/bin/env bash\nexit 1\n' > "$R7/scripts/test.sh"
OUT="$(cd "$R7" && PATH="$CLEAN_PATH" bash "$HOOKS/stop" 2>&1)"; RC=$?
assert_eq "$RC" "0" "4.非 git 目录：前两段跳过 + limpet 缺失 soft → 0"
assert_not_contains "$OUT" "test.sh" "4.非 git 目录：不执行 test.sh 检查"

# ---------------------------------------------------------------------------
# 组 5：run-hook.cmd polyglot 结构 + Windows cmd.exe 实测
# ---------------------------------------------------------------------------
head -1 "$HOOKS/run-hook.cmd" | grep -q "^: << 'CMDBLOCK'$" \
  && ok "5.run-hook.cmd 首行 polyglot 标记" || no "5.run-hook.cmd 首行标记错误"
grep -qx 'CMDBLOCK' "$HOOKS/run-hook.cmd" \
  && ok "5.run-hook.cmd 尾部 CMDBLOCK 闭合" || no "5.run-hook.cmd 缺 CMDBLOCK 闭合"
grep -q 'Program Files.Git.bin.bash.exe' "$HOOKS/run-hook.cmd" \
  && ok "5.run-hook.cmd 含 Git for Windows bash 探测" || no "5.run-hook.cmd 缺 Git Bash 探测"

case "$(uname -s 2>/dev/null || printf unknown)" in
  MINGW*|MSYS*|CYGWIN*)
    if command -v cmd.exe >/dev/null 2>&1; then
      CMD_HOOK="$(cygpath -w "$HOOKS/run-hook.cmd")"
      # 经 cmd.exe → run-hook.cmd → Git Bash → session-start，输出必须是合法 JSON
      OUTW="$(cd "$P1" && TMPDIR="$STATE_DIR" CLAUDE_PLUGIN_ROOT="$ROOT" \
        cmd //c "$CMD_HOOK" session-start 2>/dev/null)"
      RC=$?
      assert_eq "$RC" "0" "5.cmd.exe 实跑 run-hook.cmd：exit 0"
      oj "$OUTW" 'o.hookSpecificOutput && /jev-using-superpowers/.test(JSON.stringify(o))' \
        && ok "5.cmd.exe 实跑：返回合法 JSON 且含注入内容" || no "5.cmd.exe 实跑输出不可解析"
    else
      ok "5.（跳过 cmd.exe 实测：PATH 无 cmd.exe）"
    fi ;;
  *) ok "5.（非 Windows，跳过 cmd.exe 实测）" ;;
esac

printf '\n==== hooks: PASS=%d FAIL=%d ====\n' "$PASS_COUNT" "$FAIL_COUNT"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
exit 0
