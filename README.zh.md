# dsh-model-capability-alignment

[English](README.md) | 中文

把你**实际保留的模型**上、pi-ai 的模型发现刻意不写的两项能力补齐。

## 它补的是什么缺口

`@deepseek-ai/dsh-llm-pi-ai` 通过读网关的 `GET {baseURL}/models` 来列出模型。
`readListing` 只发布 **id、name、contextWindow、maxTokens**，其余一概不读，理由是：

> 没有任何办法向网关查询它的模态——没有一个 OpenAI 兼容的清单端点会报告它——
> 所以唯一诚实的下限，就是每种受支持协议都必然承载的那个模态。

这个推理是对的，决定记录在上游文档
`2026-08-12-pi-ai-route-default-input-modalities` 里。后果是：有**两个字段**
在配置 schema 里确实存在、运行时也确实生效，却**从来没有人替它填**：

| 字段 | 决定什么 | 运行时的后果 |
|---|---|---|
| `input` | `["text"]` 还是 `["text","image"]` | 三处准入点会为漏声明的模型拒绝图片：模型选择、提示准入、`read_image`。 |
| `reasoningEfforts` | 档位菜单，或 `false` | 选择器是否提供思考档位。 |

所以自建 OpenAI 兼容路由上的视觉模型会被播报成纯文本，你连图都发不出去。

## 这个插件做什么

它去读那个适配器不愿解析的同一份清单，与**你 profile 保留的模型**比对，
只写缺失的字段。

**它对 `llm-pi-ai` 配置里的每个 provider 都有效，不针对某一个厂商。**
页面会列出全部路由，任选其一即可。pi-ai 支持的三种协议都覆盖到了 ——
`openai-completions`、`openai-responses` 走 `{baseURL}/models`，
`anthropic-messages` 走 `{root}/v1/models`；认证按各自协议来
（`Authorization: Bearer`，或 `x-api-key` + `anthropic-version`），
密钥由 profile 在 `apiKeyEnv` 里声明的引用、从宿主的凭据库解析出来。
无需密钥的网关（Ollama、LM Studio、本地 OpenAI 兼容服务）直接扫，不带凭据。

读取端也不做任何厂商假设：模态与档位的各种拼写都认
（`input`、`input_modalities`、`modalities.input`、`architecture.input_modalities`；
`reasoning_efforts`、`efforts`，或任何以 `efforts` 结尾的字符串数组，以及 `reasoning_options`）。

- **列出该路由下发的全部模型，但只写你清单里的。** 端点是能力的权威，不是成员的
  权威。清单外的模型也会显示（该路由提供了你从未声明的模型，这本身值得看见），
  但它们没有复选框 —— 写入就等于把模型加回清单。你删掉的模型是有意删掉的。
- **只补缺失的字段。** 你手写过的值一律不动。
- **先备份。** 每次写入都会在原文件旁生成 `cordis.patch.yml.bak-<时间戳>`，
  且替换前会把渲染结果重新解析一遍做校验。
- **注释不丢。** profile patch 是手写文件，改写走 `yaml` 的 Document API ——
  改三行的编辑就只写三行。

## 它写哪个文件

`<DSH_HOME>/profiles/<profile>/cordis.patch.yml`，写在 `llm-pi-ai` 条目下的
`config.providers.<route>.models[]`。**不用 `modelOverrides`**：pi-ai 明确拒绝
与 models 列表并存的 override（`models already replaces the served catalog,
so declare the fields on its entries`）。

本插件**只编辑已存在的 patch，绝不创建**。文件不存在就直说并停止。

## 怎么用

设置 → **Model capability alignment**。

1. **选路由**。下拉框列出 `llm-pi-ai` 配置里的每个 provider 及其保留的模型数。
   只扫描并写入所选路由，其余路由既不访问也不改动。
2. 勾选要补的字段（`input`、`reasoningEfforts`，或两者）。
3. **扫描** —— 只读，不写任何东西。
4. 逐条查看每个保留模型会补上什么，不想要的取消勾选。摘要把该路由分成四态：
   **待补**、**已有**（条目已声明该字段，不再提供）、**端点未下发**（路由列出了
   模型但没给出任何模态）与**不在清单**（仅展示、不写入）。只有条目真的声明过值
   才会标「已有」：因为端点什么都没说而无需写入的模型，不算已经声明。
5. **写入** —— 先做带时间戳的备份，再改写文件。

页面跟随宿主语言（`zh` / `en`）。

## 为什么写入时总是显式列出模型

`providers` 能约束读取它的宿主，但运行中的宿主不会为了插件改动而重启，
旧版宿主更是直接忽略 `providers` —— 此时若不发模型列表，它就会退回到
写入 profile 里的每一条路由。所以页面总是发送显式的模型列表，
两代宿主上都能约束写入范围。

当端点发布的档位词表不是 pi-ai schema 接受的那套（`light`/`extra_high` 而非
`low`/`high`/`max`）时，`reasoningEfforts` **只展示、不写入**：写进去会让条目非法，
所以页面会显示该菜单并说明为什么没有补。

## 边界

- 它没法让 `discovery` 去填这些字段——按上游设计谁都不行。它只是把值写到
  适配器本来就会读的地方。
- 写错 `input` 的代价很高：为不支持图片的提供商放行的图片，会在请求构造前
  就被提交进会话日志。所以页面从不猜测——只写端点自己声明过的内容。
- `compat`（含 `maxTokensField`）刻意不在范围内：pi-ai 会选协议默认值，
  而配错一个开关会让每个请求都失败。

## 许可

MIT
