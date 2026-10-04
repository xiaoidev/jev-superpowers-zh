#!/usr/bin/env bash
# serve-laya.py 本地桥冒烟测试（全部离线）
# 依据：spec §4.2 后端协议、§5.5 本地桥；断言以 scripts/serve-laya.py 源码为准
#   - GET  /health        → 200，status=ok，laya_installed:false（heuristic 回退）
#   - GET  /v1/models     → 200，模型声明含 choice/score/noul 三原语
#   - POST /v1/systemone  → 200，choice/score/noul 三种最小请求
# 本机无 python 时以退出码 77 SKIP（与 automake skip 约定一致）。
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BRIDGE="$ROOT/scripts/serve-laya.py"

# ---------------------------------------------------------------------------
# python 探测：优先 PATH 上的 python3/python，再找 Windows 常见安装位置，
# 找到的解释器必须能真正启动（--version 成功）。
# ---------------------------------------------------------------------------
find_python() {
  local c p
  for c in python3 python; do
    if command -v "$c" >/dev/null 2>&1 && "$c" --version >/dev/null 2>&1; then
      command -v "$c"; return 0
    fi
  done
  for p in \
    "$HOME"/python-sdk/python3*/python.exe \
    "$HOME"/AppData/Local/Programs/Python/Python3*/python.exe \
    /c/Python3*/python.exe \
    "$HOME"/miniconda3/python.exe \
    "$HOME"/miniforge3/python.exe; do
    [ -x "$p" ] && "$p" --version >/dev/null 2>&1 && { printf '%s' "$p"; return 0; }
  done
  return 1
}

PY="$(find_python)" || {
  printf 'SKIP: python3/python 均不可用，跳过 serve-laya 桥测试（exit 77）。\n'
  exit 77
}

TMP="$(mktemp -d)"
LOG="$TMP/bridge.log"
cleanup() { kill "$BRIDGE_PID" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

PASS_COUNT=0
FAIL_COUNT=0
ok()   { PASS_COUNT=$((PASS_COUNT + 1)); printf 'ok - %s\n' "$1"; }
no()   { FAIL_COUNT=$((FAIL_COUNT + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_eq() { if [ "$1" = "$2" ]; then ok "$3"; else no "$3 (got [$1] want [$2])"; fi; }

# 随机空闲端口：由 node 绑定 0 端口后立即释放并取号（端口可能被竞争复用，
# 起服务后以健康探活为准）
pick_port() {
  node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close();});'
}

# HTTP 客户端（纯标准库）：argv=url；请求体从 stdin 读（无 stdin 即 GET）。
# 输出首行 HTTP 状态码，其后为响应体。
cat > "$TMP/client.py" <<'EOF'
import json
import sys
import urllib.error
import urllib.request

url = sys.argv[1]
data = sys.stdin.buffer.read() if not sys.stdin.isatty() else b""
if data:
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
else:
    req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read().decode("utf-8")
        print(resp.status)
        print(body)
except urllib.error.HTTPError as err:
    print(err.code)
    print(err.read().decode("utf-8"))
EOF

# $1=url  $2=请求体文件（可选）；首行状态写 $RESP_STATUS，其余写 $RESP_BODY
http_call() {
  local out
  if [ $# -ge 2 ]; then
    out="$("$PY" "$TMP/client.py" "$1" < "$2")"
  else
    out="$("$PY" "$TMP/client.py" "$1" < /dev/null)"
  fi
  RESP_STATUS="$(printf '%s' "$out" | head -1)"
  RESP_BODY="$(printf '%s' "$out" | tail -n +2)"
}

# node 断言器：stdin=JSON 文本，argv=JS 表达式（j 为解析后的对象），真退出 0
jcheck() {
  printf '%s' "$RESP_BODY" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s);
      process.exit(eval("("+process.argv[1]+")")?0:1);
    });' "$1"
}

# ---------------------------------------------------------------------------
# 启动 serve-laya.py（heuristic 回退模式，无外部网络、无 pip 依赖）
# ---------------------------------------------------------------------------
PORT="$(pick_port)"
# -u：无缓冲，保证启动横幅及时落盘（Windows 块缓冲下被 kill 会丢日志）
"$PY" -u "$BRIDGE" --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
BRIDGE_PID=$!
BASE="http://127.0.0.1:$PORT"

READY=0
for _ in $(seq 1 50); do
  if curl -sf --max-time 2 "$BASE/health" >/dev/null 2>&1; then READY=1; break; fi
  kill -0 "$BRIDGE_PID" 2>/dev/null || break
  sleep 0.2
done
if [ "$READY" != 1 ]; then
  printf 'not ok - serve-laya.py 10 秒内未就绪\n' >&2
  printf '%s\n' '--- bridge.log ---' >&2; cat "$LOG" >&2
  exit 1
fi
ok "serve-laya.py 在随机端口 $PORT 启动并通过健康探活"

# ---------------------------------------------------------------------------
# 源码契约：默认端口/主机、Laya 探测、零依赖 heuristic 回退、三原语
# ---------------------------------------------------------------------------
grep -q 'DEFAULT_PORT: int = 8000' "$BRIDGE" \
  && ok '源码保留 DEFAULT_PORT 8000' || no '源码缺 DEFAULT_PORT 8000'
grep -q 'DEFAULT_HOST: str = "127.0.0.1"' "$BRIDGE" \
  && ok '源码保留 DEFAULT_HOST 127.0.0.1' || no '源码缺 DEFAULT_HOST 127.0.0.1'
grep -Eq 'import laya|LAYA_AVAILABLE' "$BRIDGE" \
  && ok '源码含 laya import 探测（LAYA_AVAILABLE）' || no '源码缺 laya import 探测'
grep -q 'laya-heuristic-fallback' "$BRIDGE" \
  && ok '源码含零依赖 heuristic 回退标识' || no '源码缺 heuristic 回退'
grep -Eq '^(import|from) (argparse|json|math|os|re|sys|http\.server|typing)' "$BRIDGE" \
  && ok '源码 import 仅见标准库模块' || no '源码 import 出现非标准库'
if grep -E '^(import|from) ' "$BRIDGE" | grep -Evq \
  '^(import|from) (argparse|json|math|os|re|sys|http\.server|typing)([. ]|$)'; then
  no '源码存在标准库之外的第三方依赖'
else
  ok '源码无第三方（pip）运行时依赖'
fi
grep -q 'Press Ctrl+C' "$LOG" && ok '启动横幅正常打印（stdout/stderr 无异常）' \
  || no "启动横幅缺失，见 $LOG"
grep -q 'Laya Heuristic Bridge' "$LOG" \
  && ok '本机未装 laya：启动横幅声明 heuristic 回退' \
  || no '启动横幅未声明 heuristic 回退（本机意外装了 laya？）'

# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------
http_call "$BASE/health"
assert_eq "$RESP_STATUS" "200" "GET /health → 200"
jcheck 'j.status==="ok"'              && ok '/health status=ok'           || no '/health status 非 ok'
jcheck 'j.laya_installed===false'     && ok '/health laya_installed=false' || no '/health laya_installed 非 false'
jcheck 'j.engine==="laya-heuristic-fallback"' \
  && ok '/health engine=laya-heuristic-fallback' || no '/health engine 与源码不符'
jcheck 'j.open_weights===true'        && ok '/health open_weights=true'    || no '/health 缺 open_weights=true'
jcheck 'j.license==="Apache-2.0"'     && ok '/health license=Apache-2.0'   || no '/health license 非 Apache-2.0'

# ---------------------------------------------------------------------------
# GET /v1/models
# ---------------------------------------------------------------------------
http_call "$BASE/v1/models"
assert_eq "$RESP_STATUS" "200" "GET /v1/models → 200"
jcheck 'Array.isArray(j.data) && j.data.length>=1' \
  && ok '/v1/models 含 data 模型声明数组' || no '/v1/models 缺 data 数组'
jcheck 'j.data[0].id==="laya-421m"' \
  && ok '/v1/models data[0].id=laya-421m' || no '/v1/models 模型 id 不符'
jcheck 'j.data[0].type==="system-one"' \
  && ok '/v1/models data[0].type=system-one' || no '/v1/models type 不符'
jcheck '["choice","score","noul"].every(p=>j.data[0].primitives.includes(p))' \
  && ok '/v1/models 声明 choice/score/noul 三原语' || no '/v1/models 三原语不全'

# ---------------------------------------------------------------------------
# POST /v1/systemone —— choice
# ---------------------------------------------------------------------------
cat > "$TMP/choice.json" <<'EOF'
{
  "state": "production deploy requires a reliable conservative and safe option",
  "questions": {
    "q1": {
      "type": "choice",
      "criteria": {"safe": "reliable conservative choice", "risky": "experimental dangerous option"},
      "instructions": "pick the safest choice"
    }
  }
}
EOF
http_call "$BASE/v1/systemone" "$TMP/choice.json"
assert_eq "$RESP_STATUS" "200" "POST /v1/systemone (choice) → 200"
jcheck 'j.answers && j.answers.q1 && typeof j.answers.q1.confidence==="number"' \
  && ok 'choice 响应含 answers.q1.confidence 数值' || no 'choice 响应缺 confidence'
jcheck 'j.answers.q1.confidence>=0 && j.answers.q1.confidence<=1' \
  && ok 'choice confidence 落在 [0,1]' || no 'choice confidence 越界'
jcheck 'j.answers.q1.choice==="safe" || j.answers.q1.choice==="risky"' \
  && ok "choice 选中项为候选之一（实测：$(jcheck 'j.answers.q1.choice' 2>/dev/null; printf '%s' "$RESP_BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).answers.q1.choice))')）" \
  || no 'choice 选中项不在候选中'
jcheck 'Object.keys(j.answers.q1.probabilities).length===2 && Math.abs(Object.values(j.answers.q1.probabilities).reduce((a,b)=>a+b,0)-1)<0.01' \
  && ok 'choice 概率分布覆盖全部候选且总和≈1' || no 'choice 概率分布不完整或不归一'
jcheck 'j.model==="laya-421m" && j.usage && typeof j.usage.prompt_tokens==="number"' \
  && ok '响应含 model/usage 元信息' || no '响应缺 model/usage'

# ---------------------------------------------------------------------------
# POST /v1/systemone —— score
# ---------------------------------------------------------------------------
cat > "$TMP/score.json" <<'EOF'
{
  "state": "excellent quality, great results, everything works beautifully",
  "questions": {
    "s1": {"type": "score", "criteria": {"1": "low quality", "2": "great quality"}, "instructions": "rate quality"}
  }
}
EOF
http_call "$BASE/v1/systemone" "$TMP/score.json"
assert_eq "$RESP_STATUS" "200" "POST /v1/systemone (score) → 200"
jcheck 'typeof j.answers.s1.score==="number"' && ok 'score 响应含数值 score' || no 'score 响应缺 score'
jcheck 'Object.keys(j.answers.s1.probabilities).length===2' \
  && ok 'score 响应含概率分布' || no 'score 响应缺概率分布'
jcheck 'j.answers.s1.score>=1 && j.answers.s1.score<=2' \
  && ok "score 期望值落在候选值域（实测：$(printf '%s' "$RESP_BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).answers.s1.score)))')）" \
  || no 'score 期望值越界'

# ---------------------------------------------------------------------------
# POST /v1/systemone —— noul
# ---------------------------------------------------------------------------
cat > "$TMP/noul.json" <<'EOF'
{
  "state": "the code logs secret tokens to an unauthorized endpoint",
  "questions": {
    "n1": {"type": "noul", "instructions": "will this leak secret credentials"}
  }
}
EOF
http_call "$BASE/v1/systemone" "$TMP/noul.json"
assert_eq "$RESP_STATUS" "200" "POST /v1/systemone (noul) → 200"
jcheck 'typeof j.answers.n1.noul==="number"' && ok 'noul 响应含数值 noul' || no 'noul 响应缺 noul'
jcheck 'j.answers.n1.noul>=0 && j.answers.n1.noul<=1' \
  && ok "noul 概率落在 [0,1]（实测：$(printf '%s' "$RESP_BODY" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).answers.n1.noul)))')）" \
  || no 'noul 概率越界'

# ---------------------------------------------------------------------------
# 协议边角：未知路径 404、坏 JSON 400
# ---------------------------------------------------------------------------
http_call "$BASE/no-such-path"
assert_eq "$RESP_STATUS" "404" "GET 未知路径 → 404"
printf '{ this is not valid json' > "$TMP/bad.json"
http_call "$BASE/v1/systemone" "$TMP/bad.json"
assert_eq "$RESP_STATUS" "400" "POST 坏 JSON → 400"

printf '\n==== bridge: PASS=%d FAIL=%d (python: %s) ====\n' "$PASS_COUNT" "$FAIL_COUNT" "$("$PY" --version 2>&1)"
[ "$FAIL_COUNT" -eq 0 ] || exit 1
exit 0
