# Changelog

## 1.0.0

首个正式版本。功能面：路由下拉框 + 三选项（输入模态声明 / 思考档位 / 实测后剔除）、
行序严格按上游清单原样（上游已消失的模型置顶并标注）、清单内默认选中（取消即移除）、
清单外勾选即新增、写入走显式字段清单因此是即时操作。设置页标题显示实时版本号。

### 修复

- 「写入」不再重跑整轮扫描与探测：给了显式字段清单就跳过 scan（从分钟级降到几十毫秒）。
- 备份文件带专属标记 `bak-model-capability-alignment-`，只保留最近 5 个，且不触碰他人的备份。
- profile 从 `profileContext` 解析而非环境变量兜底，修掉非 web profile（Desktop 等）路由列表为空。
- ``reasoningEfforts`` 以 pi-ai 的 ``{level: wire}`` 字典写入；裸列表会 schema 失败并丢掉整条条目。

## 0.1.0

### 新增

- 设置页「模型能力补齐」，与「通用设置」「手机访问」同级：选路由 → 勾选字段 →
  扫描 → 逐模型确认 → 写入 profile patch。
- **路由下拉框**：只扫描并写入所选 provider，其余路由不访问、不改动；
  写入时始终附带显式模型列表，旧版宿主忽略 `providers` 时同样不会越界。
- **中英双语**：页面与导航标签跟随宿主语言（`ctx.locale.register` + `bind`）。
- 补齐 pi-ai 模型发现刻意不写的两个字段：`input`（图片模态）与
  `reasoningEfforts`（思考档位）。
- **对 `llm-pi-ai` 里的所有 provider 普适**，不针对单一厂商：支持
  `openai-completions` / `openai-responses` / `anthropic-messages` 三种协议的
  清单路径与各自的认证头，密钥经 `apiKeyEnv` 引用从宿主凭据库解析，
  无密钥网关直接扫。
- 读取端不做厂商假设：模态认 `input` / `input_modalities` /
  `modalities.input` / `architecture.input_modalities`；档位认
  `reasoning_efforts` / `efforts` / 任意 `*efforts` 字符串数组 / `reasoning_options`。
- 单个 provider 扫描失败只在该路由上报错，不影响其他路由。
- 扫描结果列出该路由下发的**全部**模型，每行都有复选框：清单内的可写行
  （含已声明的）默认勾选；清单外的默认不勾，勾选 = 显式新增该模型
  （条目只带 id 与端点声明的能力字段，name/contextWindow 留给模型编辑器）。
  探测正常的清单外行加绿色「可勾选加入」徽标，提醒但不代选；写入精确覆盖
  所有勾选项，写入侧只写勾选的模型。
- 「剔除」选项：按 DSH 实际发送的流式请求逐个探测清单内、清单外的全部模型。
  为跨 provider 省消耗做了极简化——单条短消息、无系统提示、收到第一个
  有效 token 即断开（健康模型约消耗 1 个 token，输出上限仅作兜底）。
  剔除行标注判定与原因（超时 / 已下线 / 配额 / 需登录 / 无套餐 / 出错），
  探测失败的配置内模型自动取消默认勾选且写入跳过。选项自带的旋钮
  （单模型上限 30s / 并行 4 / 总预算 600s 默认）缩进显示在子行。
  探测消耗真实 token，页面有显著警告。
- 只补缺失字段：手写值保留，不覆盖。
- 写入前自动备份 `cordis.patch.yml.bak-<时间戳>`，替换前重解析校验往返一致。
- 注释与格式保留（`yaml` Document API），改三行只写三行。
- 端点词表非 pi-ai 规范时（如 `light`/`extra_high`），该字段只展示不写入并说明原因。
