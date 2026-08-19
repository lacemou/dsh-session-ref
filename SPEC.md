# dsh-session-ref — 跨会话引用插件（SPEC）

> 版本：0.1（MVP）
> 状态：设计定稿，待实现
> 对应 DSH：`@deepseek-ai/dsh` 0.1.0-rc.6（Web GUI）

---

## 1. 背景

用户希望在会话 A 里「@ 另一个文件夹（工作区）里发生的任务和对话」，把会话 B 的
内容作为上下文快照注入给会话 A 的模型阅读。当前 Web GUI 的缺口：

- DSH **原生**已具备跨会话引用引擎（`@deepseek-ai/dsh-session-reference`）：
  `@[label](dsh-session:<base64url(id)>)` mention 语法、跨工作区候选发现、
  快照注入（`form: recall`）、预算与信任控制——但 Web 宿主没有暴露用户入口；
- 生态已有 [dsh-cue-plugin](https://github.com/unnnnoooo/dsh-cue-plugin)
  （按钮式选结点引用）与 [dsh-crosstalk](https://github.com/Jesse-njx/dsh-crosstalk)
  （会话间发消息），但「在输入框直接 @ 另一个会话」的轻量体验仍是空白。

本插件定位为**轻量 MVP**：用最小的双半结构，把原生 `session-reference` 管线的
「解析 → 注入」能力接到 Web GUI 上，并提供一个「复制会话引用」按钮作为引用入口。
后续可在同一包上叠加 @ 自动补全（路线见 §13）。

## 2. 目标与非目标

### 2.1 MVP 目标

1. **宿主半**：解析输入中的 `@[label](dsh-session:<id>)` mention（Markdown 形式）
   与裸 `dsh-session:<id>` URI，调用原生 `ctx.sessionReferenceResolver.prepare()`
   注入跨会话快照，并把 mention 改写为可读 `@label` 文本。
2. **客户端半**：在输入框工具条（`conversation.input.left`）提供
   「复制会话引用」按钮：一键把**当前会话**的引用 mention
   （`@[显示标题](dsh-session:<id>)`）复制到剪贴板。
3. **跨工作区**：引用可指向任意其他会话（含不同 cwd），快照注入与发现排序由
   原生服务保证（same-cwd → cwd-less → other-cwd）。

### 2.2 非目标（MVP 不做）

- ❌ @ 输入自动补全 / 候选选择器（M2，§13）
- ❌ 引用粒度选择（整会话快照是 MVP 唯一粒度；cue-plugin 的「选用户结点」不在内）
- ❌ 会话间发消息 / 转交任务（那是 dsh-crosstalk 的领域）
- ❌ 引用实时订阅（快照是 capture-time，原生语义）
- ❌ 改动 DSH 核心代码

## 3. 术语

| 术语 | 含义 |
|---|---|
| 宿主半（node half） | 运行在 DSH 宿主进程的 cordis 插件，`src/index.ts` → `lib/index.js` |
| 客户端半（browser half） | 运行在 Web 前端的插件，`src/client/*` → `lib/client.js`（CJS 闭包工厂） |
| mention | `@[label](dsh-session:<payload>)` 或裸 `dsh-session:<payload>` |
| 引用（reference） | 一次 mention 解码出的 `{ sessionId, label? }` |
| recall 消息 | 原生 `prepare()` 返回的聚合快照 `UserMessage`（`source.kind: 'session-reference'`, `form: 'recall'`） |

## 4. 总体架构

```
┌─────────────────────────── Web 前端（浏览器） ───────────────────────────┐
│  composer 工具条                                                          │
│   [复制引用] 按钮 ──点击──▶ 生成 @[标题](dsh-session:<id>) ──▶ 剪贴板      │
│   （用户粘贴到另一会话输入框，发送）                                        │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ 消息带 mention
┌──────────────────────────────────▼───────────────────────────────────────┐
│  DSH 宿主进程（cordis）                                                    │
│  agent/pre-step 监听器（本插件，prepend: true）                             │
│    ├─ parseSessionReferenceText(text)  ── 原生：提取 references + 改写文本  │
│    ├─ ctx.sessionReferenceResolver.prepare(agent, content, refs, signal)   │
│    │     ── 原生：并行读源会话、去重、预算、拒绝自引用                        │
│    └─ 返回 enter decision：recall 消息 + 改写后的用户消息                    │
│         └─ 模型看到「## Referenced sessions」快照 + 可读 @label             │
└────────────────────────────────────────────────────────────────────────────┘
```

设计原则：**一切跨会话能力复用原生**，本插件只做「解析触发」与「UI 入口」两层薄壳。

## 5. 复用的原生 API（`@deepseek-ai/dsh-session-reference`）

| API | 用途 | 位置 |
|---|---|---|
| `parseSessionReferenceText(text)` | 从文本提取 mention，返回 `{ text, references }`（改写为可读 `@label`） | 宿主半（runtime import） |
| `formatSessionReferenceMention({ sessionId, label? })` | 生成 `@[label](uri)` | 客户端半自行等价实现（见 §7.3，purity 约束） |
| `ctx.sessionReferenceResolver.prepare(agent, content, references, signal?)` | 并行读取源会话，返回 `{ content, additionalContext? }` | 宿主半（cordis 服务，无需 import） |
| `ctx.sessionReferenceResolver.listCandidates(agent, query?, limit?, signal?)` | 候选发现（M2 使用；MVP 不需要） | 宿主半 |
| 快照预算 | `maxReferences = 3`，`maxReferenceBytes = 65536` | 原生配置，本插件透传 |

## 6. 宿主半设计（`src/index.ts`）

### 6.1 挂载

`cordis.patch.yml` 向 profile 插入一行：

```yaml
- insert:
    - id: session-ref
      name: dsh-session-ref
```

`apply(ctx)` 注册一个 `agent/pre-step` 监听器（`{ prepend: true }`，与
cue-plugin 相同的时序语义：本插件的改写先于其他监听器看到原始消息）。

### 6.2 处理流程

对每个 pre-step 事件：

```
decision = await next()
if decision.kind == 'reject' or signal.aborted: return decision   # 不干预

out: Message[] = []
for each message in decision.messages:
    refs: SessionReferenceInput[] = []
    newBlocks: ContentBlock[] = []
    for each block in message.content:
        if block.type != 'text': newBlocks.push(block); continue
        parsed = parseSessionReferenceText(block.text)      # 原生解析
        refs.push(...parsed.references)                      # 保持首现顺序
        newBlocks.push({ ...block, text: parsed.text })      # 改写为 @label
    if refs.length == 0: out.push(message); continue

    try:
        prepared = await ctx.sessionReferenceResolver.prepare(
            agent, newBlocks, refs, signal)
    catch (err):
        # 预算超限 / 源不可读 / 自引用：保留原文 mention（不注入），记录日志
        console.error('[session-ref] prepare failed:', err)
        out.push(message)                                    # 原样保留
        continue

    if prepared.additionalContext:
        out.push(prepared.additionalContext)                 # recall 消息在前
    out.push({ ...message, content: prepared.content })

return { kind: 'enter', messages: out }
```

要点：

- **注入顺序**：每条含 mention 的消息，其 `additionalContext`（recall）插在
  该消息**之前**、紧跟其后是改写后的直接消息——与原生文档约定一致
  （「a sourced context `user/message` followed by the readable direct
  `user/message`」）。
- **多消息**：每条消息独立 `prepare()`，各自的 recall 插在各自消息前；
  单条消息内多个 text block 的 mention 合并为一次 `prepare()`（原生按首现顺序
  去重）。
- **自引用**：原生 `prepare()` 拒绝 self-reference；本插件不额外处理。
- **失败降级**：任何 `prepare()` 失败不阻断用户消息——保留原文 mention 进入
  本轮（模型会看到 URI 原文），错误只进宿主日志。MVP 不向 UI 报错
  （后续可加 toast）。

### 6.3 配置项（cordis.patch.yml 可覆盖）

| Key | 默认 | 说明 |
|---|---|---|
| `maxReferences` | 3 | 透传给原生（单条消息最多不同源数，原生硬上限 3） |
| `maxReferenceBytes` | 65536 | 透传给原生（单引用快照字节上限） |
| `enabled` | `true` | 总开关 |

MVP 仅读取并透传前两项到 `prepare()` 调用（若宿主已装原生服务，其配置同样
生效——两份配置取更严格者，行为由原生实现保证）。

## 7. 客户端半设计（`src/client/`）

### 7.1 按钮位置与注入

复用 cue-plugin 验证过的挂载方式：

- `ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name, id: 'session-ref-copy', inject: sessionId => ({...}) }, CopyReferenceButton))`
- slot 的 `inject` 回调收到 `sessionId`（当前会话 id），按钮组件经
  `PropsRuntime` 拿到注入面。

### 7.2 点击行为

1. 取当前会话 id（slot 注入面提供）。
2. 尽力取显示标题：从 `ctx.get('sessions')` 的 `list` 快照
   （`ObservableSnapshot<SessionListState>`）按 id 找 `SessionSummary.displayTitle`
   （title → project basename → id 的原生 fallback 链）；找不到则用 sessionId。
3. 生成 mention：`@[label](dsh-session:<payload>)`（编码见 §7.3）。
4. `navigator.clipboard.writeText(mention)`（失败时 fallback
   `document.execCommand('copy')` 文本框法）。
5. 按钮短暂显示「已复制 ✓」反馈（~1.5s 后还原）。

### 7.3 URI 编码（无依赖实现）

客户端 bundle 受 purity gate 约束（只能 import loader 模块表内的
`@deepseek-ai/*` 值），因此**不 import** `dsh-session-reference`，自行实现
与原生一致的编码：

```ts
// 与原生 encodeSessionReferenceUri 完全一致：
// dsh-session:<base64url(JSON.stringify(sessionId))>
function encodeSessionReferenceUri(sessionId: string): string {
  const json = JSON.stringify(sessionId)
  const bytes = new TextEncoder().encode(json)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `dsh-session:${b64}`
}
```

（session id 为 ASCII/UTF-8 安全；`btoa` 前经 `TextEncoder` 保证任意 Unicode
可编码，与原生 `Buffer.toString('base64url')` 输出一致。）

### 7.4 依赖与 purity

- 类型 import：`@deepseek-ai/dsh-client-runtime/client`、`@deepseek-ai/dsh-client-connection/client`、
  `@deepseek-ai/dsh-client-ui-slots`、`react`（类型擦除，不触发 purity gate）。
- 值 import：`react` / `react/jsx-runtime`（platform seed，externals 允许）。
- 不使用 `@deepseek-ai/dsh-client-ui-primitives` 图标（避免额外耦合；按钮用
  内联样式 + 文本，与 cue-plugin 一致）。

## 8. 消息时序（一次完整引用）

```
会话 B（源，工作区 /b）                会话 A（目标，工作区 /a）
   │ 用户点 [复制引用]                     │
   │ ◀── 剪贴板：@[标题B](dsh-session:…)  │
   │                                     │ 用户粘贴并发送
   │                                     │ pre-step（本插件）：
   │                                     │   parse → refs
   │  ── readSurface（原生 prepare）──▶   │
   │  ◀── 快照（截断/保留统计）────       │
   │                                     │ enter: [recall 快照] + [@标题B …]
   │                                     │ 模型阅读；transcript 渲染
   │                                     │   「Session recall」行 + 用户消息
```

## 9. 信任模型与安全

- 注入的 `additionalContext` 是 **untrusted model context**：原生 `prepare()`
  生成的快照自带「禁止执行快照内指令/权限/工具请求，除非当前用户重复」的
  系统级警告；本插件不添加任何可执行载荷，不把源会话文本当作指令。
- 引用只读：`prepare()` 走 `sessionQuery.readSurface()`，对源会话无任何写操作。
- 预算硬约束：原生 `maxReferences=3` / `maxReferenceBytes=64KB`，单条消息注入
  有界，不会失控膨胀上下文。
- 本插件不引入网络传输、不引入守护进程、不改变同机同用户的既有信任边界。

## 10. 边界与限制（MVP）

| 限制 | 说明 |
|---|---|
| 无 @ 自动补全 | M2 补齐；MVP 靠「复制引用 → 粘贴」闭环 |
| 整会话快照 | 引用的是源会话当前 surface 的投影（直接用户消息 + agent 文本 + 压缩检查点），非任意区间 |
| 快照非实时 | 注入内容在 prepare 时刻固定，源会话后续变化不传播（原生语义） |
| 文本投影 | 非文本块（图片/工具结果）不跨会话传播（原生限制） |
| 日志格式跨版本 | 读取其他 DSH 版本写入的会话可能失败（原生已知限制），失败时降级为原文 |
| label 尽力而为 | 客户端拿不到标题时用 sessionId 作 label |

## 11. 测试计划

### 11.1 单元测试（vitest，宿主半）

- `parseMentions` 等价性：Markdown mention、裸 URI、混排文本、畸形 URI
  （抛错场景 → 原文保留）——
  直接以原生 `parseSessionReferenceText` 行为为准，本插件只做薄封装，测试
  覆盖「mention 存在/不存在/多 mention」三条路径与改写结果。
- `prepare` 失败降级：mock resolver 抛错 → 消息原样保留、无 recall 注入。
- 注入顺序：单条消息 → recall 在前；两条消息 → 各自 recall 在前。

### 11.2 手动验证（Web GUI）

1. 安装插件（`dsh plugin --profile web add ./dsh-session-ref`），重载 Web。
2. 工具条出现「复制引用」按钮；点击后剪贴板得到
   `@[标题](dsh-session:…)`。
3. 在**另一工作区**的会话输入框粘贴发送：
   - transcript 出现「Session recall」行（带来源标题与保留/省略统计）；
   - 模型消息中可见「## Referenced sessions」快照内容；
   - 用户消息中 mention 被改写为可读 `@标题`。
4. 自引用（复制当前会话的引用贴回本会话）：不注入 recall，消息原样。
5. 预算：一条消息贴 >3 个不同源引用 → 原生拒绝，消息原样降级。

## 12. MVP 验收标准

- [x] `dsh plugin add` 安装成功，宿主半加载无报错
- [x] 客户端半按钮出现在 composer 工具条，复制内容为合法 mention
- [ ] 跨工作区引用注入生效：recall 行 + 模型可见快照 + mention 改写（真实环境待用户 GUI 验证）
- [x] 失败/自引用/超预算路径不阻断用户消息
- [x] 不修改任何 DSH 核心文件

## 12.1 真实环境验证记录（2026-08-18）

### 发现 1：`sessionReferenceResolver` 服务在 rc.6 部署中未挂载

配置树（web 与 headless 均无）中没有该服务条目。原生包存在但服务是**可选的**
（README 明确 "Hosts that support cross-session mentions may opt into the
service"）。宿主半因此在 apply 时**自注册**该服务到 root context：

```ts
if (root.sessionReferenceResolver === undefined) {
  new SessionReferenceResolver(root as never, { ...config })
}
```

幂等：未来宿主若已提供，保留宿主实例。headless 真实测试确认：自注册后
`prepare()` 被真实调用并进入 `sessionQuery.readSurface()`（此前报
`cannot get property "sessionReferenceResolver" without inject`）。

### 发现 3（rc.8 升级冲突，2026-08-20）：宿主原生挂载 + 并行注册竞态

DSH **rc.8 原生挂载了 `session-reference` 条目**（配置树含
`- id: session-reference`，rc.6/rc.7 没有），它会注册
`sessionReferenceResolver`。由于 loader **并行 apply** 条目（
`Promise.allSettled`），插件的自注册与原生条目谁先谁后不确定——两处
`new SessionReferenceResolver` 注册同名服务，其中一个必然抛
`service "sessionReferenceResolver" has been registered`，导致**整个
plugin tree 加载失败、web 无法启动**（实机复现）。

**修复（双管齐下）**：

1. **bundle patch 禁用原生条目**（`cordis.patch.yml`）：

   ```yaml
   - id: session-reference
     disabled: true
   ```

   使本插件的自注册成为唯一注册者。rc.6/rc.7 无该条目时 patch 仅产生
   "entry not found" **警告**（实测不崩溃），兼容旧版本。

2. **代码加固**（`src/index.ts`）：存在性检测改用 cordis store API
   `root.get('sessionReferenceResolver', false)`（无 inject 要求、不抛错、
   `strict=false` 忽略 fiber 状态）；注册包 try/catch——若与并发注册者
   竞态，静默降级为使用现有实例。

**验证**：21 个 vitest 全绿（新增：服务已存在时跳过注册、注册竞态降级两例）；
rc.8 实机：patch disable 生效（`disabled: true` 条目）、不存在的 id 仅警告。

### 发现 2：headless 环境 `persistence.list()` 返回空（跨进程引用受限）

headless 真实测试中 `readSurface` 对**任何持久化会话**（含 headless 自身创建的）
都报 `SESSION_QUERY_SESSION_NOT_FOUND`。文件层验证（readdir + zstd 帧解压）
全部正常，配置（root/compression）与 web 一致——属 headless profile 的服务层
环境差异，与插件代码无关。

**对 web 环境的影响**：`SessionCorpus.load()` 优先走 live 路径
（`ctx.sessions.get(id)`，本进程已加载的会话），只有未加载的会话才走
persistence 路径。因此 **web 进程内引用 live 会话不经过 persistence**，应正常
工作；跨进程/未加载会话的引用受此限制（与原生部署配置相关，非插件缺陷）。

### 验证矩阵

| 层 | 方式 | 结果 |
|---|---|---|
| 宿主半解析/注入逻辑 | vitest（19 用例）+ mock 单元 | ✅ |
| URI 编码一致性 | 与原生 `encodeSessionReferenceUri` 逐字节对比 | ✅ |
| 客户端 bundle 加载/复制 | `__ModuleLoader__.load` 模拟环境 | ✅ |
| 服务自注册 | headless 真实 cordis 环境 | ✅（prepare 被真实调用） |
| 快照读取 | headless 真实环境（persistence 路径） | ⚠️ not found（headless 服务层差异） |
| web 端到端（按钮 + live 引用注入） | 用户 GUI 验证 | ⏳ 待测 |

## 13. 后续路线（非 MVP）

| 里程碑 | 内容 |
|---|---|
| M2 | 输入框 @ 自动补全：候选来自 `listCandidates`（原生跨 cwd 排序），键盘导航插入 mention |
| M3 | 跨工作区目录浏览 + 引用粒度选择（整会话 / 用户结点 / 区间） |
| M4 | 与 dsh-crosstalk 集成：引用 + 转交任务 |
| M5 | 把「复制 Session ID / 复制引用」提交到核心 UI（上游 PR） |

---

## 附录 A：关键文件

```
dsh-session-ref/
├── SPEC.md              ← 本文档
├── package.json         ← dsh bundle + client manifest
├── cordis.patch.yml     ← 宿主挂载行
├── tsconfig.json        ← 类型检查（noEmit）
├── tsdown.config.ts     ← 双半构建（node ESM + browser CJS）
├── src/
│   ├── index.ts         ← 宿主半
│   └── client/
│       ├── index.ts     ← 客户端注册（slot + inject）
│       └── CopyReferenceButton.tsx
└── README.md            ← 安装/使用说明
```

## 附录 B：风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 宿主 Loader 加载第三方依赖（dsh-session-reference）失败 | 低 | 宿主半失效 | 依赖版本与 DSH 同源（^0.1.0-rc.6）；构建后先 `dsh plugin` 日志验证 |
| `agent/pre-step` 注入时序与 TUI 原生 wrapper 冲突 | 低 | 双重注入 | 本插件仅在自己解析出 mention 时才注入；与 TUI 互斥使用 |
| 客户端 purity gate 误伤 | 中 | 构建失败 | 严格 type-only import；`alwaysBundle` 只放行纯函数 |
| `conversation.input.left` slot 名变更 | 低 | 按钮不出现 | 锁定 rc.6；升级时对照 cue-plugin 同步 |
