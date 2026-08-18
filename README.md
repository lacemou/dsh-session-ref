# dsh-session-ref

**跨会话引用（mention）插件 for DeepSeek Harness。**

在任意会话（包括**另一个工作区/文件夹**的会话）里，粘贴
`@[label](dsh-session:<id>)` 引用，宿主就会把被引用会话的内容快照注入给当前
模型阅读——跨文件夹的任务和对话可以直接 @ 引用，不再需要口头转述。

完整设计见 [SPEC.md](SPEC.md)。英文版见 [README.en.md](README.en.md)。

## 特性（MVP）

- **宿主半**：`agent/pre-step` 解析 `@[label](dsh-session:…)` 与裸
  `dsh-session:<id>`，调用原生 `sessionReferenceResolver.prepare()` 注入
  快照（转录中渲染为独立的 **Session recall** 行），并把 mention 改写为
  可读 `@label`。若部署未挂载 `sessionReferenceResolver` 服务（如 rc.6
  profile），插件会自动注册它。
- **客户端半**：composer 工具条「复制引用」按钮，一键复制**当前会话**的引用
  mention（`@[标题](dsh-session:<id>)`）。
- 全部跨会话能力复用 DSH 原生 `@deepseek-ai/dsh-session-reference` 管线：
  并行读取、去重、预算（≤3 源 / ≤64KB）、自引用拒绝、untrusted 上下文警告。

## 安装

```sh
# 方式一：git 安装（lib/ 已提交，无需构建）
git clone <你的仓库地址>
dsh plugin --profile web add /path/to/dsh-session-ref

# 方式二：本地开发安装
cd dsh-session-ref
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-session-ref
```

安装后**重启 web 进程**（`Ctrl-C` 后重新 `dsh web`）才会加载新 bundle。

## 使用

1. 在会话 A（源）的输入框工具条点击 **复制引用**。
2. 剪贴板得到 `@[标题A](dsh-session:…)`。
3. 在会话 B（目标，**可在另一个工作区**）输入框粘贴并发送。
4. 转录中会出现一条独立的 **Session recall** 行（带来源标题与保留/省略统计），
   模型同时看到 `## Referenced sessions` 快照内容与可读的 `@标题A`。

也可手写引用：`@[任意标签](dsh-session:<id>)` 或裸 `dsh-session:<id>`。
自引用（引用本会话）被原生拒绝；超过 3 个不同源或快照超预算时原生拒绝，
消息原样保留。

## 开发

```sh
npm run typecheck   # tsc --noEmit
npm run test        # vitest run（19 个测试：宿主半注入、URI 编码一致性、客户端复制）
npm run build       # tsc --noEmit + tsdown → lib/index.js (node) + lib/client.js (browser)
```

`lib/` 已提交，git 安装直接使用预构建产物。

## 验证状态（2026-08-18）

**端到端已闭环**（Web GUI 真实环境）：

- ✅ 宿主半解析 mention → 原生 `prepare()` 真实调用 → 快照注入为
  `session-reference / recall` 上下文（转录出现 **Session recall** 行）
- ✅ 快照统计正确：`originalMessages / retainedMessages / omittedMessages /
  omittedBytes / truncated`（大会话触发预算截断，属设计行为）
- ✅ mention 改写为可读 `@label`
- ✅ composer 工具条出现 **「复制引用」** 按钮
- ✅ 19 个 vitest 单测全绿（解析/改写/注入顺序/失败降级/URI 编码一致性/客户端复制）
- ✅ URI 编码与原生 `encodeSessionReferenceUri` 逐字节一致

**注意**：安装插件后必须**重启 web 进程**——web 的 ESM 缓存不会自动更新，
否则运行的仍是旧版插件代码（典型症状：mention 不注入、模型只看到原文）。

## 已知限制

- 无 @ 自动补全（M2 路线；MVP 靠复制-粘贴闭环）。
- 引用是 capture-time 快照（非实时订阅）；源会话后续变化不传播。
- 快照仅文本投影；非文本块（图片/工具结果）不跨会话。
- 读取其他 DSH 版本写入的会话可能失败（原生限制），失败时消息原样降级。
- 引用当前宿主从未加载过的会话（跨进程）走 persistence 路径，部分部署
  （如 headless profile）可能不支持；引用 live 会话始终可用。

## License

MIT
