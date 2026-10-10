# FOSS 本地引擎：Laya（中文说明）

jev-superpowers-zh 的门禁是**后端无关**的：云端默认走 TypeSafe AI 托管 API，也可以用 [scripts/serve-laya.py](../scripts/serve-laya.py) 在本地跑一个与云端 API 同构的 System 1 决策桥，**100% 离线、零数据外发**。

## Laya 是什么

上游开放权重模型（数据译自 jev-superpowers 的 `docs/FOSS_LAYA.md`）：

- **模型**：[Laya](https://huggingface.co/convaiinnovations/laya)（Hugging Face `convaiinnovations/laya`，PyPI 包名 `laya`）
- **许可证**：**Apache-2.0**（开源，开放权重）
- **架构**：421M 参数 —— `ModernBERT-large`（395M）双向骨干 + 2 层决策头
- **延迟**（上游数据）：GPU 约 33–38 ms；Apple Silicon 经 `laya-mlx` 约 13.4 ms；现代 x86 CPU 约 60–80 ms
- **输出**：单次前向返回带校准概率的类型化决策（Choice / Score / Noul），**零生成 token、零解析错误**

| 维度 | TypeSafe 云端 | 本地 Laya |
|---|---|---|
| 权重 | 专有云 API | **开放权重（Apache-2.0）** |
| 数据隐私 | 经云 API 传输 | **100% 本地 / 可气隙隔离（零外发）** |
| Token 成本 | $0.042 / Mtok | **$0.00（永久免费）** |
| P50 延迟 | 70–150 ms | **33–38 ms** |
| 本地内存 | 0 MB | 约 850 MB RAM |

## 本仓的桥：scripts/serve-laya.py

**纯 Python 标准库实现，无任何第三方 pip 依赖**（只用 http.server / json / math / re 等）。启动时尝试 `import laya`：

- 装了真 Laya 包 → `engine: "laya-421m"`，真实 421M 推理；
- 没装 → 自动落到内置 **heuristic 确定性回退**：`engine: "laya-heuristic-fallback"`，无需联网、无需模型权重即可驱动整套门禁流程（测试/CI/低配机适用）。

### 端点

| 方法与路径 | 说明 |
|---|---|
| `GET /health`（别名 `/_health`） | 返回 `status`、`engine`、`open_weights`、`license: "Apache-2.0"`、`laya_installed`（布尔） |
| `GET /v1/models`（别名 `/models`） | 模型清单；id `laya-421m`，`owned_by: "convaiinnovations"`，三原语 `choice / score / noul` |
| `POST /v1/systemone`（别名 `/v1/decisions`、`/systemone`） | System 1 决策端点，入参 `{state, questions}`，逐题按 type 返回 choice/score/noul 判定 |

### 启动与接线

```bash
python scripts/serve-laya.py --port 8000 --host 127.0.0.1
# 默认即 8000 / 127.0.0.1；也可用 PORT 环境变量覆盖端口

# 让 6 个门禁工具走本地桥（bash）
export TYPESAFE_BASE_URL="http://127.0.0.1:8000"
export TYPESAFE_API_KEY="local"
```

```powershell
# Windows PowerShell
$env:TYPESAFE_BASE_URL = "http://127.0.0.1:8000"
$env:TYPESAFE_API_KEY = "local"
```

就绪检测随后会把本地桥识别为 **laya**（真模型）或 **heuristic**（回退），对应就绪态 **FULL / LOCAL**，判定阈值不变（见 [jev-gate.md](jev-gate.md)）。

### 国内安装说明

- **只用 heuristic 回退：什么都不用装。** 桥本身零 pip 依赖，因此与 pip 镜像源是否可用完全无关；有 Python 3 就能跑。
- **要跑真 421M 权重**时才需要安装模型包（仅这一步走 pip）：

  ```bash
  pip install laya
  # macOS Apple Silicon 可用 Metal 加速版：
  pip install laya-mlx
  ```

  国内网络可自行指定可信镜像（如 `pip install laya -i <你的镜像源>`），权重约 850MB，按需下载。

## heuristic 回退如何打分（已知边界，务必如实理解）

heuristic **不是神经网络、不具备真实模型能力**，它是一套确定性关键词/重叠规则，仅用于让门禁链路离线可跑：

- 常量（见脚本顶部）：状态匹配权重 `2.0`、基础 ε `0.1`；风险命中概率 `0.95` / 干净 `0.01`；错误命中 `0.88` / 干净 `0.04`；概率 floor `0.01` / ceiling `0.99`；score 缺省回退 `5.0`、confidence 缺省回退 `0.5`。
- `choice`：对选项文本与 state / instructions 做 token 重叠的 cosine 式打分（权重 2.0 + ε），再 softmax 归一得到概率与置信度；
- `score`：以各档概率做期望值；
- `noul`：指令含 secret/destructive 等词时按危险关键词命中给 0.95/0.01，含 fail/error 等词给 0.88/0.04，否则退回重叠分并夹在 [0.01, 0.99]。

因此 heuristic 适合**开发、测试、CI 与流程演练**；需要真实语义判定时请装 Laya 权重或使用云端。

## 已知限制

1. **单线程**：基于标准库 `HTTPServer`，未做并发/线程池，只适合本机单客户端使用，不要暴露到公网。
2. **请求体大小无上限**：直接按 `Content-Length` 读入内存（无鉴权、无压缩、无大小限制），仅应监听 `127.0.0.1`。
3. heuristic 是确定性关键词/重叠判定，不代表真实模型能力；其输出置信度不能当作校准概率解读。
4. 模型 id 固定为 `laya-421m`、`owned_by: "convaiinnovations"`，仅暴露 choice / score / noul 三个原语。

## 与云端 api.typesafe.ai 的关系

- 云端与本地桥实现**同一套 HTTP 协议**，6 个 jev 工具通过 `TYPESAFE_BASE_URL` 无缝切换，无需改命令。
- 就绪检测（[scripts/jev-readiness](../scripts/jev-readiness)）对云端只做一次 2 秒 `https://api.typesafe.ai/` 存活探测（不发送判定 payload）；本地则探 `<baseUrl>/health`。
- `TYPESAFE_API_KEY` 非空且不等于 `local` 才被视为真实云密钥；设为 `local` 即明确告知客户端走本地桥。
- `.jevzh.json` 中 `backend` 设为 `local`/`cloud`/`off` 可强制选择（或设环境变量 `JEVZH_BACKEND=local`），`auto`（默认）按「显式 baseUrl 本地桥 → 真实密钥云端 → 默认本地桥」顺序探测。
