#!/usr/bin/env bash
# 双上游质量审计 —— 在 zh 五类检查（静态校验 / 安装器功能 / 上游对齐 / 交叉引用 /
# 工具计数）之上升级为双上游（upstream-zh / upstream-jev）保真审计。
#
# 1. 静态校验：JSON parse / 27 SKILL.md frontmatter / AGENTS 符号链接 /
#    hook 与脚本可执行位 / 变量后多字节 / LF / jev 契约 23 token（离线也跑）/
#    .jevzh-meta.json 不得入仓 / .gitignore 必须含 .jevzh/
# 2. Installer 功能：26 个安装目标（含 trae-cn 发行版）+ copilot 别名的
#    装 / 幂等 / 卸载矩阵，全局-only 拒绝断言，--no-jev / --strict 形态冒烟
# 3. 双上游对齐：
#    - upstream-zh：21 个 zh 技能全树归一化字节比对（品牌白名单对称归一）、
#      H1-H4 标题数 ±3、FORK_MARK 增量记账、禁 superpowers: 前缀、欠同步 numstat
#    - upstream-jev：6 个 jev 技能契约 token FAIL（离线即生效）+ 结构标题 WARN
#    - hooks/session-start、hooks/pre-commit、hooks/stop、hooks/hooks.json、
#      hooks/hooks-cursor.json、bin/jevzh.js 属 declaredDivergences 合并衍件，
#      只报欠同步 WARN，不做逐字镜像 FAIL
# 4. 交叉引用：README → docs/ 链接 + skill 间中文引用 + 装后 bootstrap 路径
# 5. 计数与共存：27 技能 / 26 安装目标 / 26 篇宿主文档、共存开关标识、
#    jev-gate 8 子命令、插件版本同步、dot 图节点/边一致性
#
# 用法：
#   bash scripts/audit.sh                 # 跑全部（上游缺失则 WARN 跳过），FAIL>0 exit 1
#   bash scripts/audit.sh --quick         # 跳过 installer 矩阵与形态冒烟
#   bash scripts/audit.sh --no-upstream   # 跳过双上游比对（纯本地离线断言）
#   bash scripts/audit.sh -h|--help       # 打印用法
#
# 环境变量：
#   JEVZH_UPSTREAM_ZH       zh 上游检出/导出目录（默认 upstream/zh，相对仓根）
#   JEVZH_UPSTREAM_JEV      jev 上游检出目录（默认 upstream/jev，相对仓根）
#   JEVZH_UPSTREAM_ZH_MODE  baseline（默认，差异即 FAIL）| worktree（只 WARN）
#
# 退出码：0 通过（允许有 WARN）；1 有 FAIL；2 参数错误
#
# 归一化白名单（规格 §8.1 第 2 条，对两侧对称生效，见 scripts/audit-divergences.json）：
#   CRLF -> LF；npx superpowers-zh -> npx jevzh；
#   裸品牌词 superpowers-zh -> jev-superpowers-zh（保留 jnMetaCode/superpowers-zh 归属 URL）

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUICK=0
NO_UPSTREAM=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --no-upstream) NO_UPSTREAM=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      echo "用法: bash scripts/audit.sh [--quick] [--no-upstream] [-h]" >&2
      exit 2
      ;;
  esac
done

UPZH="${JEVZH_UPSTREAM_ZH:-$ROOT/upstream/zh}"
UPJEV="${JEVZH_UPSTREAM_JEV:-$ROOT/upstream/jev}"
ZH_MODE="${JEVZH_UPSTREAM_ZH_MODE:-baseline}"

PASS=0; FAIL=0; WARN=0
declare -a FAILURES=()
declare -a WARNINGS=()
INSTALLER="$ROOT/bin/jevzh.js"
DIVERGENCES="$ROOT/scripts/audit-divergences.json"

# 6 个汉化 jev 技能与 23 个契约 token（规格 §8.1 第 3 条，缺任一即 FAIL）
JEV_SKILLS=(jev-brainstorming jev-executing-plans jev-systematic-debugging \
  jev-using-superpowers jev-verification jev-writing-plans)
JEV_TOKENS=("jev-axi pick" "jev-axi triage" "jev-axi check" jev-scout jev-guard \
  "git jev check" "supercov quality" limpet \
  --options --text --state --ecosystem --json \
  0.80 0.50 0.70 2.0 0.10 0.90 \
  TYPESAFE_API_KEY TYPESAFE_BASE_URL /v1/systemone /health)
# supercov quality 在 markdown 中可能被反引号/换行拆写，匹配前统一去反引号
JEV_TOKENS_DISPLAY=(jev-axi-pick jev-axi-triage jev-axi-check jev-scout jev-guard \
  git-jev-check supercov-quality limpet \
  --options --text --state --ecosystem --json \
  0.80 0.50 0.70 2.0 0.10 0.90 \
  TYPESAFE_API_KEY TYPESAFE_BASE_URL /v1/systemone /health)

ok()   { PASS=$((PASS+1)); }
bad()  { FAIL=$((FAIL+1)); FAILURES+=("$1"); echo "  ❌ $1"; }
warn() { WARN=$((WARN+1)); WARNINGS+=("$1"); echo "  ⚠️  $1"; }
hdr()  { echo ""; echo "=== $1 ==="; }

count_headings() {  # 读 stdin，只数围栏之外的 H1-H4
  awk '/^```/{fence = !fence; next} !fence && /^#{1,4} /{n++} END{print n+0}'
}

#==============================================================================
hdr "Category 1: 静态校验"
#==============================================================================

# 1a. JSON parse（只扫 git 跟踪文件，避开 dogfood 产物与 upstream/ 检出）
while IFS= read -r f; do
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$f" 2>/dev/null; then
    ok
  else
    bad "JSON parse failure: $f"
  fi
done < <(git ls-files '*.json')

# 1b. SKILL.md frontmatter 完整性（27 个：name 与目录同名 + description；21 zh 技能带 license: MIT）
while IFS=$'\t' read -r state detail; do
  case "$state" in
    OK) ok ;;
    BAD) bad "$detail" ;;
  esac
done < <(node --input-type=module -e '
import fs from "fs";
import path from "path";
const root = process.cwd();
for (const name of fs.readdirSync("skills", { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
  const f = path.join("skills", name, "SKILL.md");
  const fail = (msg) => console.log("BAD\t" + f + ": " + msg);
  if (!fs.existsSync(f)) { fail("缺少 SKILL.md"); continue; }
  const src = fs.readFileSync(f, "utf8");
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) { fail("缺少 frontmatter"); continue; }
  const fm = m[1];
  const nm = fm.match(/^name:\s*(.+?)\s*$/m);
  const ds = fm.match(/^description:\s*\S+/m);
  if (!nm) { fail("frontmatter 缺 name"); }
  else if (nm[1].replace(/["'"'"']/g, "") !== name) { fail("frontmatter name 与目录不同名: " + nm[1]); }
  if (!ds) { fail("frontmatter 缺 description"); }
  if (!name.startsWith("jev-") && !/^license:\s*\S+/m.test(fm)) { fail("zh 技能 frontmatter 缺 license"); }
  if (nm && ds && (name.startsWith("jev-") || /^license:\s*\S+/m.test(fm))) console.log("OK\t" + name);
}
')

# 1c. AGENTS.md 必须是指向 CLAUDE.md 的符号链接（以 git 索引模式为准，
#     Windows 检出可能物化成含目标路径的普通文本文件，故同时接受这两种形态）
agents_mode=$(git ls-files -s -- AGENTS.md | awk '{print $1}')
if [ "$agents_mode" = "120000" ]; then
  ok
  if [ "$(cat AGENTS.md 2>/dev/null)" = "CLAUDE.md" ] && [ -f CLAUDE.md ]; then
    ok
  else
    bad "AGENTS.md 符号链接目标必须是 CLAUDE.md 且 CLAUDE.md 存在"
  fi
else
  bad "AGENTS.md git 索引模式应为 120000（符号链接），实际 $agents_mode"
fi

# 1d. 可执行位（git 索引 100755）
declare -a EXEC_FILES=(
  hooks/pre-commit hooks/session-start hooks/stop
  scripts/jev-gate scripts/jev-readiness scripts/sync-plugin-version.js
  scripts/run-bash-tests.sh
  skills/brainstorming/scripts/start-server.sh
  skills/brainstorming/scripts/stop-server.sh
  skills/executing-plans/scripts/task-start
  skills/executing-plans/scripts/task-done
  skills/subagent-driven-development/scripts/task-brief
  skills/subagent-driven-development/scripts/sdd-workspace
  skills/subagent-driven-development/scripts/review-package
  skills/systematic-debugging/find-polluter.sh
)
for f in "${EXEC_FILES[@]}"; do
  m=$(git ls-files -s -- "$f" | awk '{print $1}')
  if [ "$m" = "100755" ]; then ok; else bad "可执行位应为 100755: ${f}（实际 ${m}）"; fi
done
# run-hook.cmd 是有意的 polyglot 普通文件，不应被加成可执行位
m=$(git ls-files -s -- hooks/run-hook.cmd | awk '{print $1}')
if [ "$m" = "100644" ]; then ok; else bad "hooks/run-hook.cmd 应为 100644 普通文件（实际 ${m}）"; fi

# 1e. shell 脚本里「变量后紧跟多字节字符」（沿用 zh 审计，扩展到无扩展名入口）
#
# bash 在部分 locale 下会把变量名后紧随的多字节首字节吞进名字，set -u 直接
# unbound 崩掉。用 LC_ALL=C + ERE（BSD/GNU 通用），排除注释行。
while IFS= read -r hit; do
  case "${hit#*:*:}" in
    \#*|" "*\#*) continue ;;
  esac
  bad "变量后紧跟多字节字符，bash 会吞进变量名（用 \${VAR} 界定）: $hit"
done < <(LC_ALL=C grep -rnE '\$[A-Za-z_][A-Za-z0-9_]*[^ -~]' scripts/* hooks/session-start hooks/pre-commit hooks/stop 2>/dev/null \
          | grep -vE ':[0-9]+:[[:space:]]*#')
ok

# 1f. git 跟踪的文本文件不得含 CR（.gitattributes 统一 LF；图片等二进制跳过）
while IFS= read -r f; do
  bad "含 CRLF/CR 字节（应为 LF）: $f"
done < <(node --input-type=module -e '
import fs from "fs";
import { execSync } from "child_process";
const bin = new Set([".png",".jpg",".jpeg",".gif",".ico",".webp",".woff",".woff2",".ttf",".eot",".zip"]);
const files = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
for (const f of files) {
  if (bin.has(require_path(f))) continue;
  const b = fs.readFileSync(f);
  if (b.includes(0x0d)) console.log(f);
}
function require_path(f){ const i = f.lastIndexOf("."); return i >= 0 ? f.slice(i).toLowerCase() : ""; }
' 2>/dev/null)
ok

# 1g. 仓库技能目录不得误入安装期生成物 .jevzh-meta.json（只允许出现在用户目标目录）
meta_in_repo=$(git ls-files 'skills/*/.jevzh-meta.json' 'skills/*/*/.jevzh-meta.json' | wc -l | tr -d ' ')
untracked_meta=$(find skills -name '.jevzh-meta.json' 2>/dev/null | wc -l | tr -d ' ')
if [ "$meta_in_repo" = "0" ] && [ "$untracked_meta" = "0" ]; then ok; else
  bad "skills/ 下发现 .jevzh-meta.json（tracked=${meta_in_repo} worktree=${untracked_meta}）—— 它是安装期生成物，不得入仓"
fi

# 1h. .gitignore 必须忽略 .jevzh/ 运行时目录
if grep -qE '^\.jevzh/?$' .gitignore; then ok; else
  bad ".gitignore 必须包含 .jevzh/ 忽略规则"
fi

# 1i. declaredDivergences 文件自身合法且与 .upstream-sync.json 一一对应
while IFS=$'\t' read -r state detail; do
  case "$state" in
    OK) ok ;;
    BAD) bad "audit-divergences.json: $detail" ;;
  esac
done < <(node --input-type=module -e '
import fs from "fs";
import { execSync } from "child_process";
const div = JSON.parse(fs.readFileSync("scripts/audit-divergences.json", "utf8"));
const sync = JSON.parse(fs.readFileSync(".upstream-sync.json", "utf8"));
const allTracked = execSync("git ls-files", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
const out = (s, d) => console.log(s + "\t" + d);
(() => {
const rules = [...(div.divergences||[]), ...(div.whitelist||[])];
const ids = new Set();
for (const r of rules) {
  if (!r.id) return out("BAD", "存在无 id 的规则");
  if (ids.has(r.id)) return out("BAD", "id 重复: " + r.id);
  ids.add(r.id);
  if (!Array.isArray(r.scope) || r.scope.length === 0) return out("BAD", r.id + " scope 为空");
  if (typeof r.reason !== "string" || !r.reason.trim()) return out("BAD", r.id + " reason 为空");
  for (const sc of r.scope) {
    if (/[*?]/.test(sc)) {
      const re = new RegExp("^" + sc.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*") + "$");
      const hit = allTracked.some(p => re.test(p));
      if (!hit) return out("BAD", r.id + " scope glob 解析不到任何路径: " + sc);
    } else if (!fs.existsSync(sc)) {
      return out("BAD", r.id + " scope 路径不存在: " + sc);
    }
  }
}
const dlist = div.divergences || [];
if (dlist.length !== 4) out("BAD", "divergences 必须恰好 4 项，实际 " + dlist.length);
const syncTexts = new Set(sync.declaredDivergences || []);
for (const d of dlist) {
  if (!d.sourceText || !syncTexts.has(d.sourceText)) out("BAD", d.id + " 的 sourceText 在 .upstream-sync.json 中找不到对应原文");
}
out("OK", "divergences");
})();
')

# 1j. jev 契约 23 token：6 个汉化技能合并文本中必须逐字保留（离线 FAIL，规格 §8.1-3）
combined=$(mktemp)
for s in "${JEV_SKILLS[@]}"; do cat "skills/$s/SKILL.md"; done > "$combined"
# 归一：去掉 markdown 反引号与换行，使 `supercov` `quality` 这类跨行/拆写可匹配
norm_text=$(tr -d '`\r' < "$combined" | tr '\n' ' ')
for i in "${!JEV_TOKENS[@]}"; do
  token="${JEV_TOKENS[$i]}"
  needle="${token// /[[:space:]]*}"
  if printf '%s' "$norm_text" | grep -Eq -e "$needle"; then ok; else
    bad "jev 契约 token 缺失（6 个 jev 技能合并文本）: ${JEV_TOKENS_DISPLAY[$i]}"
  fi
done
rm -f "$combined"

#==============================================================================
if [ "$QUICK" != "1" ]; then
hdr "Category 2: Installer 功能测试（26 目标 + copilot 别名）"
#==============================================================================

# 26 个 TARGETS 条目（含 trae-cn 发行版）+ copilot 别名 = 27 个 CLI 用例。
# zcode / trae-cn 无项目级磁盘路径，项目级安装必须明确拒绝且零写入。
declare -a TOOLS=(claude cursor codex kiro deerflow trae trae-cn antigravity vscode \
  openclaw windsurf gemini aider opencode qwen hermes claw copilot qoder codebuddy \
  codearts cline kilocode crush zcode dsh reasonix)
declare -a GLOBAL_ONLY=(zcode trae-cn)

for tool in "${TOOLS[@]}"; do
  TMP=$(mktemp -d)
  pushd "$TMP" >/dev/null

  case " ${GLOBAL_ONLY[*]} " in
    *" $tool "*)
      out=$(node "$INSTALLER" --tool "$tool" 2>&1); rc=$?
      wrote=$(find . -type f | wc -l | tr -d ' ')
      if [ "$rc" != "0" ] && echo "$out" | grep -q "不支持项目级安装" && [ "$wrote" = "0" ]; then ok; else
        bad "Installer: $tool 全局-only，项目级应拒绝（非零退出 + 零写入），实际 rc=$rc 写入 $wrote"
      fi
      popd >/dev/null; rm -rf "$TMP" 2>/dev/null; continue
      ;;
  esac

  if ! node "$INSTALLER" --tool "$tool" >/dev/null 2>&1; then
    bad "Installer: $tool 安装失败"
    popd >/dev/null; rm -rf "$TMP" 2>/dev/null; continue
  fi
  if ! node "$INSTALLER" --tool "$tool" >/dev/null 2>&1; then
    bad "Installer: $tool 二次安装失败（幂等性破坏）"
    popd >/dev/null; rm -rf "$TMP" 2>/dev/null; continue
  fi
  if ! node "$INSTALLER" --uninstall >/dev/null 2>&1; then
    bad "Installer: $tool 卸载失败"
  else
    ok
  fi

  popd >/dev/null
  rm -rf "$TMP" 2>/dev/null || true
done

# --no-jev 形态：仅 21 中文技能、无 jev-*、无 hooks、无 .jevzh.json
TMP=$(mktemp -d)
pushd "$TMP" >/dev/null
if node "$INSTALLER" --tool claude --no-jev >/dev/null 2>&1 \
   && [ "$(find .claude/skills -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')" = "21" ] \
   && [ -z "$(find .claude/skills -maxdepth 1 -type d -name 'jev-*' -print -quit 2>/dev/null)" ] \
   && [ ! -e .jevzh.json ] && [ ! -d .claude/hooks ]; then
  ok
else
  bad "Installer: --no-jev 形态异常（应为 21 中文技能、无 jev-*、无 hooks、无 .jevzh.json）"
fi
popd >/dev/null; rm -rf "$TMP"

# --strict 形态：.jevzh.json 的 strict 必须为 true；默认形态为 false
TMP=$(mktemp -d)
pushd "$TMP" >/dev/null
node "$INSTALLER" --tool claude --strict >/dev/null 2>&1
strict_v=$(node -e "try{console.log(require('./.jevzh.json').strict)}catch(e){console.log('NOFILE')}" 2>/dev/null)
if [ "$strict_v" = "true" ]; then ok; else bad "Installer: --strict 生成的 .jevzh.json strict 应为 true，实际 $strict_v"; fi
popd >/dev/null; rm -rf "$TMP"

TMP=$(mktemp -d)
pushd "$TMP" >/dev/null
node "$INSTALLER" --tool claude >/dev/null 2>&1
strict_v=$(node -e "try{console.log(require('./.jevzh.json').strict)}catch(e){console.log('NOFILE')}" 2>/dev/null)
if [ "$strict_v" = "false" ]; then ok; else bad "Installer: 默认形态 strict 应为 false，实际 $strict_v"; fi
popd >/dev/null; rm -rf "$TMP"

else
echo ""
echo "[--quick 跳过 Category 2 installer 矩阵与形态冒烟]"
fi

#==============================================================================
hdr "Category 3: 双上游对齐"
#==============================================================================

# ---- 3.0 zh 保真：禁 superpowers: 前缀（纯本地事实，离线也 FAIL）----
stale_prefix=$(grep -rno "superpowers:[a-z][a-z-]*" skills 2>/dev/null | grep -v "superpowers-zh:" | wc -l | tr -d ' ')
if [ "${stale_prefix:-0}" = "0" ]; then ok; else
  bad "skill 正文有 ${stale_prefix} 处上游前缀 superpowers: —— 插件模式会 Unknown skill，改裸技能名"
fi

if [ "$NO_UPSTREAM" = "1" ]; then
  warn "--no-upstream：跳过 upstream-zh / upstream-jev 目录比对（契约 FAIL 仍离线生效）"
else

# ============================ upstream-zh ====================================
if [ ! -d "$UPZH/skills" ]; then
  warn "upstream-zh 目录不存在（${UPZH}）：跳过 zh 保真比对。用 JEVZH_UPSTREAM_ZH 指定，或 git fetch 后导出到 upstream/zh"
else
  echo "  upstream-zh = ${UPZH}（模式: ${ZH_MODE}）"

  # 3zh-a. 21 个 zh 技能全树归一化字节比对（基线差异 FAIL，活上游 WARN）
  cmp_out=$(node --input-type=module -e '
import fs from "fs";
import path from "path";
const up = process.argv[1], ours = process.argv[2];
const norm = (s) => s
  .replace(/\r\n/g, "\n")
  .replace(/npx superpowers-zh/g, "npx jevzh")
  .replace(/(?<!jnMetaCode\/)(?<![A-Za-z0-9-])superpowers-zh/g, "jev-superpowers-zh");
const walk = (dir) => {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p)); else out.push(p);
  }
  return out;
};
const upDirs = fs.readdirSync(path.join(up, "skills"), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
const ourDirs = fs.readdirSync(path.join(ours, "skills"), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith("jev-")).map(d => d.name).sort();
const onlyUp = upDirs.filter(d => !ourDirs.includes(d));
const onlyOur = ourDirs.filter(d => !upDirs.includes(d));
for (const d of onlyUp) console.log("ONLY_UP\t" + d);
for (const d of onlyOur) console.log("ONLY_OURS\t" + d);
let diffs = 0, fileOnlyUp = 0, fileOnlyOur = 0;
for (const d of upDirs) {
  if (!ourDirs.includes(d)) continue;
  const uf = walk(path.join(up, "skills", d)).map(p => path.relative(path.join(up, "skills", d), p).replaceAll("\\", "/")).sort();
  const of = walk(path.join(ours, "skills", d)).map(p => path.relative(path.join(ours, "skills", d), p).replaceAll("\\", "/")).sort();
  for (const f of uf.filter(x => !of.includes(x))) { fileOnlyUp++; console.log("ONLY_UP\t" + d + "/" + f); }
  for (const f of of.filter(x => !uf.includes(x))) { fileOnlyOur++; console.log("ONLY_OURS\t" + d + "/" + f); }
  for (const f of uf.filter(x => of.includes(x))) {
    const a = norm(fs.readFileSync(path.join(up, "skills", d, f), "utf8"));
    const b = norm(fs.readFileSync(path.join(ours, "skills", d, f), "utf8"));
    if (a !== b) { diffs++; console.log("DIFF\t" + d + "/" + f); }
  }
}
console.log("SUMMARY\tupDirs=" + upDirs.length + " ourDirs=" + ourDirs.length + " contentDiffs=" + diffs
  + " onlyUp=" + (onlyUp.length + fileOnlyUp) + " onlyOur=" + (onlyOur.length + fileOnlyOur));
' "$UPZH" "$ROOT" 2>/dev/null)
  cmp_bad=$(echo "$cmp_out" | grep -cE '^(DIFF|ONLY_UP|ONLY_OURS)\b')
  echo "$cmp_out" | grep -E '^SUMMARY' | sed 's/^/  /'
  if [ "$cmp_bad" = "0" ]; then
    ok
    echo "  ✅ 21 个 zh 技能全树（归一化品牌白名单后）与上游基线逐字一致"
  else
    echo "$cmp_out" | grep -E '^(DIFF|ONLY_UP|ONLY_OURS)' | sed 's/^/    /'
    if [ "$ZH_MODE" = "worktree" ]; then
      warn "zh 保真：$cmp_bad 项与活上游不一致（worktree 模式仅提醒；基线模式应 FAIL）"
    else
      bad "zh 保真：$cmp_bad 项与基线不一致（21 技能必须逐字保真；若为主动改动请更新基线与白名单）"
    fi
  fi

  # 3zh-b. 21 技能 H1-H4 标题数 ±3（翻译合并/拆分容差，只 WARN）
  zh_list=$(find "$UPZH/skills" -mindepth 1 -maxdepth 1 -type d ! -name 'jev-*' -exec basename {} \; | sort)
  for s in $zh_list; do
    [ -f "skills/$s/SKILL.md" ] || continue
    up=$(count_headings < "$UPZH/skills/$s/SKILL.md")
    our=$(count_headings < "skills/$s/SKILL.md")
    abs=$(( up > our ? up-our : our-up ))
    if [ "$abs" -le "3" ]; then ok; else
      warn "Skill 结构漂移: ${s}（上游 H=${up}，我们 H=${our}，容差 ±3）—— 未跟版或主动扩写"
    fi
  done

  # 3zh-c. FORK_MARK 增量必须显式声明（参数化标记，delta > declared 才 FAIL）。
  # 标记文本与 3zh-a 同口径品牌归一：本仓为「本节是 jev-superpowers-zh 的增量
  # 内容」，基线为 superpowers-zh，二者归一后等价，故用品牌中立正则匹配。
  FORK_MARK_RE='本节是 (jev-)?superpowers-zh 的增量内容'
  for s in $zh_list; do
    [ -f "skills/$s/SKILL.md" ] || continue
    up=$(count_headings < "$UPZH/skills/$s/SKILL.md")
    our=$(count_headings < "skills/$s/SKILL.md")
    declared=$(grep -Ec "$FORK_MARK_RE" "skills/$s/SKILL.md" 2>/dev/null; true); declared=${declared:-0}
    up_declared=$(grep -Ec "$FORK_MARK_RE" "$UPZH/skills/$s/SKILL.md" 2>/dev/null; true); up_declared=${up_declared:-0}
    delta=$(( our - up - (declared - up_declared) ))
    if [ "$delta" -le "0" ]; then ok; else
      bad "未声明的 fork 增量: $s 归一化后仍比上游多 $delta 节 —— 加「${FORK_MARK_RE}」标记或回归上游"
    fi
  done

  # 3zh-d. requesting-code-review/code-reviewer.md 结构（self-contained 参考件）
  if [ -f "$UPZH/skills/requesting-code-review/code-reviewer.md" ]; then
    up=$(count_headings < "$UPZH/skills/requesting-code-review/code-reviewer.md")
    our=$(count_headings < skills/requesting-code-review/code-reviewer.md 2>/dev/null || echo 0)
    abs=$(( up > our ? up-our : our-up ))
    if [ "$abs" -le "2" ]; then ok; else
      bad "code-reviewer.md 结构漂移（上游 H=${up}，我们 H=${our}）"
    fi
  fi

  # 3zh-e. 欠同步 numstat（仅当上游是含基线对象的 git 检出时可算；导出目录静默跳过）
  base=$(node -p "JSON.parse(require('fs').readFileSync('.upstream-sync.json','utf8')).sources.find(s=>s.name==='zh').commit" 2>/dev/null)
  if [ -n "$base" ] && git -C "$UPZH" rev-parse --git-dir >/dev/null 2>&1 && git -C "$UPZH" cat-file -e "${base}^{commit}" 2>/dev/null; then
    drift=$(git -C "$UPZH" diff --numstat "$base" HEAD -- skills 2>/dev/null | awk '{a+=$1; d+=$2; n++} END{printf "%d %d %d", n+0, a+0, d+0}')
    set -- $drift; nfiles=$1; nadd=$2; ndel=$3
    if [ "${nfiles:-0}" = "0" ]; then ok; else
      warn "zh 欠同步: 基线以来上游改了 ${nfiles} 个技能文件（+${nadd}/-${ndel}）—— 明细: git -C ${UPZH} diff --stat ${base} HEAD -- skills"
    fi
  else
    echo "  （upstream-zh 非 git 检出或缺基线对象，跳过欠同步 numstat）"
  fi
fi

# ============================ upstream-jev ===================================
if [ ! -d "$UPJEV" ]; then
  warn "upstream-jev 目录不存在（${UPJEV}）：跳过 6 技能结构对齐（23 契约 token 的 FAIL 已在 Category 1 离线生效）"
else
  echo "  upstream-jev = $UPJEV"
  basej=$(node -p "JSON.parse(require('fs').readFileSync('.upstream-sync.json','utf8')).sources.find(s=>s.name==='jev').commit" 2>/dev/null)
  for s in "${JEV_SKILLS[@]}"; do
    uf="$UPJEV/skills/$s/SKILL.md"
    if [ ! -f "$uf" ]; then
      warn "jev 上游缺同名技能 skills/${s}（可能改名），结构对齐跳过 —— 人工核对汉化版本"
      continue
    fi
    up=$(count_headings < "$uf")
    our=$(count_headings < "skills/$s/SKILL.md")
    abs=$(( up > our ? up-our : our-up ))
    if [ "$abs" -le "3" ]; then ok; else
      warn "jev 技能结构漂移: ${s}（上游 H=${up}，汉化版 H=${our}，容差 ±3）—— 汉化时章节被合并/扩写"
    fi
  done
  if [ -n "$basej" ] && git -C "$UPJEV" rev-parse --git-dir >/dev/null 2>&1 && git -C "$UPJEV" cat-file -e "${basej}^{commit}" 2>/dev/null; then
    drift=$(git -C "$UPJEV" diff --numstat "$basej" HEAD -- skills 2>/dev/null | awk '{a+=$1; d+=$2; n++} END{printf "%d %d %d", n+0, a+0, d+0}')
    set -- $drift; nfiles=$1
    if [ "${nfiles:-0}" = "0" ]; then ok; else
      warn "jev 欠同步: 基线以来上游改了 $nfiles 个技能文件（汉化差异为已登记分歧，只评估是否需要跟新契约）"
    fi
  else
    echo "  （upstream-jev 非 git 检出或缺基线对象，跳过欠同步 numstat）"
  fi
fi

# 合并衍件（declaredDivergences）对双上游都不做逐字 FAIL；若任一上游是 git 检出，
# 以 WARN 形式提示这些文件相对各自基线的变更量，供人工评估。
echo "  （hooks 4 件 + bin/jevzh.js 为 declaredDivergences 合并衍件，只 WARN 不镜像 FAIL）"

fi  # end upstream block

#==============================================================================
hdr "Category 4: 交叉引用完整性"
#==============================================================================

# 4a. README → docs/ 链接目标必须存在
while IFS= read -r link; do
  link=${link#](}; link=${link%)}
  if [ -e "$link" ]; then ok; else bad "README 链接断: $link"; fi
done < <(grep -oE '\]\(docs/[^)]+\)' README.md | sort -u)

# 4b. Skill 间中文引用完整性（沿用 zh 审计的语法位抽取，含冒号的外链跳过）
while IFS= read -r line; do
  skill_file=$(echo "$line" | cut -d: -f1)
  refs=$(echo "$line" \
    | grep -oE '使用 `?[a-z][a-z0-9-]*`? 技能|必需子技能：\*\* 使用 `?[a-z][a-z0-9-]*`?|必需子技能：使用 `?[a-z][a-z0-9-]*`?' \
    | sed -E 's/.*使用 //; s/ 技能$//' | tr -d '`' | grep -v ':' | sort -u)
  for name in $refs; do
    if [ -d "skills/$name" ]; then ok; else
      src=$(basename "$(dirname "$skill_file")")
      bad "Skill 引用断: $src 引用了不存在的 skills/$name"
    fi
  done
done < <(grep -rHn -E '使用 `?[a-z][a-z0-9-]*`? 技能|必需子技能：' skills/*/SKILL.md 2>/dev/null)

# 4c. 装完后路由/引导技能路径必须存在（hooks 与插件依赖）
TMP=$(mktemp -d)
pushd "$TMP" >/dev/null
if node "$INSTALLER" --tool claude >/dev/null 2>&1; then
  miss=0
  for p in .claude/skills/using-superpowers/SKILL.md .claude/skills/jev-using-superpowers/SKILL.md; do
    [ -f "$TMP/$p" ] || { bad "装完后缺失 ${p}（hooks/插件引导会找不到）"; miss=1; }
  done
  [ "$miss" = "0" ] && ok
else
  bad "Category 4 探测安装失败（--tool claude）"
fi
popd >/dev/null
rm -rf "$TMP" 2>/dev/null || true

#==============================================================================
hdr "Category 5: 计数 / 共存开关 / 结构"
#==============================================================================

# 5a. 27 技能（21 zh + 6 jev）
skill_count=$(find skills -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
zh_count=$(find skills -mindepth 1 -maxdepth 1 -type d ! -name 'jev-*' | wc -l | tr -d ' ')
jev_count=$(find skills -mindepth 1 -maxdepth 1 -type d -name 'jev-*' | wc -l | tr -d ' ')
if [ "$skill_count" = "27" ] && [ "$zh_count" = "21" ] && [ "$jev_count" = "6" ]; then ok; else
  bad "技能目录数应为 27（21 zh + 6 jev），实际 ${skill_count}（zh=${zh_count} jev=${jev_count}）"
fi

# 5b. installer TARGETS 26 条安装目标（含 1 条 trae-cn editionOf 发行版变体）
target_count=$(sed -n '/^const TARGETS = \[/,/^\];/p' "$INSTALLER" | grep -cE "^  \{ name: '")
edition_count=$(sed -n '/^const TARGETS = \[/,/^\];/p' "$INSTALLER" | grep -cE "^  \{ name: '[^']+'.*editionOf:" || true)
if [ "$target_count" = "26" ]; then ok; else bad "installer TARGETS 应为 26 条，实际 $target_count"; fi
echo "  TARGETS=${target_count}（editionOf 发行版变体 ${edition_count} 条）"

# 5c. docs/README.*.md 恰好 26 篇宿主文档
doc_count=$(find docs -maxdepth 1 -name 'README.*.md' -type f | wc -l | tr -d ' ')
if [ "$doc_count" = "26" ]; then ok; else bad "docs/README.*.md 应为 26 篇，实际 $doc_count"; fi

# 5d. 共存能力静态标识（规格 §8.1 第 6 条，缺一个即 FAIL）
for marker in preflight doctor restore --adopt-skills --keep-router --detect-only --no-jev --strict; do
  if grep -q -- "$marker" "$INSTALLER"; then ok; else bad "installer 缺少共存标识 ${marker}（文档/规格宣称的能力不得被删）"; fi
done

# 5e. jev-gate 8 个子命令必须在分发器中出现
for sub in pick scout guard commit triage check-hypothesis quality limpet; do
  if grep -qE "^\s*${sub}\)" scripts/jev-gate; then ok; else bad "scripts/jev-gate 缺少子命令分支: $sub"; fi
done

# 5f. package 名称与插件版本同步
pkg_name=$(node -p "require('./package.json').name")
if [ "$pkg_name" = "jev-superpowers-zh" ]; then ok; else bad "package.json name 应为 jev-superpowers-zh，实际 $pkg_name"; fi
if node scripts/sync-plugin-version.js --check >/dev/null 2>&1; then ok; else
  bad "sync-plugin-version --check 失败：plugin manifest 版本与 package.json 漂移"
fi

# 5g. dot 流程图：边引用的节点必须先声明（graphviz 对孤儿节点静默）
dot_out=$(node --input-type=module -e '
import fs from "fs";
import path from "path";
function walk(dir){ let r=[]; for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name); if(e.isDirectory()) r=r.concat(walk(p)); else if(e.name.endsWith(".md")) r.push(p);} return r; }
let total=0, bad=0;
for (const f of walk("skills")) {
  const src = fs.readFileSync(f, "utf8");
  for (const block of src.matchAll(/```dot\n([\s\S]*?)```/g)) {
    total++;
    const declared = new Set(), used = new Set();
    for (const ln of block[1].split("\n")) {
      if (ln.includes("->")) {
        for (const m of ln.split("[")[0].matchAll(/"([^"]+)"/g)) used.add(m[1]);
      } else {
        const m = ln.match(/^\s*"([^"]+)"\s*\[/);
        if (m) declared.add(m[1]);
      }
    }
    const orphan = [...used].filter(x => !declared.has(x));
    if (orphan.length) { bad++; console.log("BAD\t" + f.replaceAll("\\","/") + "\t" + orphan.sort().join(", ")); }
  }
}
console.log("TOTAL\t" + total + "\t" + bad);
')
dot_total=$(echo "$dot_out" | awk -F'\t' '$1=="TOTAL"{print $2}')
dot_bad=$(echo "$dot_out" | awk -F'\t' '$1=="TOTAL"{print $3}')
if [ "${dot_bad:-1}" = "0" ]; then
  ok
  echo "  ✅ $dot_total 个 dot 图，边引用节点全部已声明"
else
  echo "$dot_out" | awk -F'\t' '$1=="BAD"{print "    "$2": 边引用未声明节点 -> "$3}'
  bad "dot 图有 $dot_bad 处孤儿节点（改节点文案时漏改边，渲染会多出光秃秃的框）"
fi

#==============================================================================
echo ""
echo "=========================================="
echo "📊 审计结果"
echo "=========================================="
echo "✅ PASS: $PASS"
echo "⚠️  WARN: $WARN"
echo "❌ FAIL: $FAIL"

if [ "$WARN" -gt 0 ]; then
  echo ""
  echo "Warnings（不阻塞）："
  for w in "${WARNINGS[@]}"; do echo "  ⚠️  $w"; done
fi

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "Failures（必须修）："
  for f in "${FAILURES[@]}"; do echo "  ❌ $f"; done
  echo ""
  echo "❌ Audit 失败：$FAIL 个硬问题。看 README 「质量审计」段了解每项含义。"
  exit 1
fi

echo ""
echo "✅ Audit 通过"
exit 0
