# dsh-session-ref → DSH 0.1.2-rc.1 迁移记录(双代共存)

> 状态:**实现已完成,待真机验证** · 目标宿主:0.1.2-rc.1(npm latest)。
> 双代策略按社区版本矩阵:**0.2.x 面向 0.1.2-rc.1 队列;旧队列(rc.6~0.1.1-rc.2)
> 由仓库既有 0.1.x 发布线继续支持**(client 半形状对旧队列同构,理论上 0.2.0
> 也可回退运行,但宿主半依赖随版本浮动,以 0.1.x 线为准)。
> 依据:oh-my-dsh/dsh-plugin-upgrade-skill(65 张卡) + npm registry 实测 + 社区范例
> `04-dual-cohort-plugin`(dsh-mnemon rc.2+alpha.1 单实现共存)。

## 版本事实(2026-09 实测 registry/GitHub)

- `@deepseek-ai/dsh` npm:latest = **0.1.2-rc.1**(2026-09-03);alpha = 0.1.3-alpha.2;本机全局 GUI = 0.1.1-rc.2。
- 破坏性变更:0.1.2-alpha.1 起 **`@deepseek-ai/dsh-client-runtime` 包被拆解删除**(卡 DSH-0.1.2-A1-25):
  - `ClientContext` → `import type { Context as ClientContext } from '@deepseek-ai/cordis'`(npm 4.0.2)
  - `ISessions`/SessionBinding → `@deepseek-ai/dsh-api-session-controller/client`(服务名仍是 `sessions`,
    `list.getSnapshot().byId[id].displayTitle` 形状与旧版一致)
  - client-modules 按包名注册(卡 A1-26);插件 bundle 注册 id 已 = `dsh-session-ref` ✓
  - 把已删除的包留在 `dsh.client.inject` = phantom dependency → client 不进 boot graph/row pending(卡 A1-25 症状)
- `dsh-session-reference` 包/`sessionReferenceResolver` 服务/entry `session-reference`(id 与包名)在
  rc.1 与 alpha.2 均不变;`agent/pre-step` 载荷类型 rc.2→alpha.2 不变;URI 编解码格式不变。
- 原生 `SessionReferenceResolver` 自 rc.8 起自己注册 `agent/pre-step` + `prepareDirectMessages` 做完整解析注入。
- alpha.2 新增 resolver 配置 `referenceContextFraction` 与 spill(可选,兼容)。

## 冲突判定(结论)

1. 升级到 0.1.2-rc.1:client 半必坏 — 根因是 `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime`
   (phantom)+ 类型来源(旧包)。host 半不坏。
2. rc.8+ 起插件 host 半与原生管线功能重复(靠"禁用原生 entry + 自注册 + 幂等改写"维持单注入,脆弱)。
3. dsh-notch-notifier 非 DSH 插件(Swift 菜单栏 App),无冲突面。

## 采用方案:单实现双代共存(仿 dsh-mnemon)

- client bundle 保持"运行时零宿主依赖"(只 require react 平台种子;所有 @deepseek-ai 引用为 type-only)。
  这是双代可行性的关键(避开 R-02 'missed the module table')。
- **删掉** manifest `dsh.client.inject` 里的 `@deepseek-ai/dsh-client-runtime`(可清空数组);同步清 tsdown externals/allowlist。
- 类型导入改指向新域包:Context←@deepseek-ai/cordis;ISessions/SessionId←api-session-controller/client
  (+dsh-session/types);PropsRuntime←dsh-client-ui-slots@0.1.2-rc.1。
  devDeps 两个时代并存无冲突(type-only,不进入产物)。
- `ctx.slots.inject('conversation.input.left', …)` / `register({name,id,order,locale?,inject}, Comp)` 两代同构,
  槽位 key `conversation.input.left` rc.1 仍在(ui-conversation contract/slots.d.ts)。
- host 半(`src/index.ts` + cordis.patch.yml)逻辑保留(跨 rc.6/7/8 兼容本来就是它的设计);仅核对 rc.1 类型通过。
- 版本号与发布:插件升 0.2.0;README 加宿主版本矩阵说明。

## 实施状态(2026-09-08)

已落地改动:
- `package.json`:version → 0.2.0;`dsh.client.inject` → [] ;依赖
  `dsh-session-reference` ^0.1.0-rc.6 → ^0.1.2-rc.1;devDeps 重建为 rc.1 精确版
  (cordis 4.0.2 / api-session-controller / ui-slots / ui-conversation / dsh-session /
  dsh-agent / dsh-llm @ 0.1.2-rc.1);删除 `dsh-client-runtime` devDep。
  注:旧 lock 的 rc.7 peer 树与新队列互斥 → 已删 node_modules + package-lock 重建。
- `src/client/index.ts`:类型改为 0.1.2 域包(cordis Context 换成结构型
  `ClientContext` — cordis 的 slots 增强来自深层包,追不到稳定导出,改为结构声明
  与测试 mock 一致);ISessions←api-session-controller,SessionId←dsh-session/types;
  标题读取加 `displayTitle ?? title ?? id` 兜底;register 加 `order: 10`。
- `tsdown.config.ts`:externals/allowlist 移除 `dsh-client-runtime/client`;
  构建产物 client.js 仅 require('react'),id = dsh-session-ref。
- host 半 `src/index.ts` + `cordis.patch.yml`:**未改动**(rc.6~rc.8 兼容设计保留)。
- README(中/英)+ SPEC.md 头部更新版本矩阵与 0.2.0 摘要。
- 校验:typecheck 0 错;vitest **21/21 通过**;build 产物正常;npm pack 见下。
- `tests/host.test.ts` 不变仍全绿(rc.1 下 resolver 构造走 cordis Service,抛错路径被
  apply 的竞态 catch 接住,测试断言行为一致)。

## 验证矩阵(按顺序)

1. rc.2(当前全局 GUI,0.1.1-rc.2):typecheck/test + 挂载冒烟(按钮出现、复制、粘贴注入)——证明旧代不回归。
2. rc.1:最后一步把全局 `@deepseek-ai/dsh` 升 0.1.2-rc.1(注意会重启/可能打断当前会话),再重复冒烟。
3. 关键断言:boot graph 含 dsh-session-ref 无 pending;`conversation.input.left` 按钮渲染;粘贴
   `@[label](dsh-session:…)` 后 host 侧快照注入;rc.1 下无 'loaded without registering' 类错误。

> 提醒:真机验证需要重启当前 GUI/升级全局 dsh,可能打断本会话——已与用户约定
> 放到最后一步由用户确认时机。

## 待办/开放项

- [x] rc.1 ui-slots register 契约核对(带 inject 重载,list 需 id/order)
- [x] client 测试适配(结构 ctx,mock 不变仍绿)
- [x] SPEC.md / README 版本表述更新
- [ ] npm pack 内容核对(files 白名单排除 .agents)
- [ ] 真机:rc.2 冒烟(可选)→ 全局升 0.1.2-rc.1 → rc.1 冒烟
- [ ] 发布决策:0.2.0 是否推送 npm / 更新 GitHub release(与用户确认)
