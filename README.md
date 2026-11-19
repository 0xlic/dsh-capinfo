# Capinfo 模型插件

DeepSeek Harness 持久化 Host + Client 插件。配置入口：**设置 → Capinfo 模型**；用量看板：**左上角原生导航菜单 → Capinfo看板**（居中弹窗，只展示今日用量与近 30 天图表）。

## 兼容版本

- 插件 1.0.6 的 DSH 加载范围是 `>=0.2.2-rc.3 <0.3.0-0`。后续 DSH 0.2.x 更新（含 RC）不会仅因版本号变化而被加载前检查拦截；0.3 的预发行版和正式版均不放行。三个 DSH peer 使用同一范围，本地开发依赖仍固定在 rc.5。已跑全量回归的是 rc.3、rc.4 和 rc.5；未来 0.2.x 通过版本检查不等于已经验证过运行行为。
- DSH 的 rc.3 和 rc.4 升级索引分别列出 DeepSeek 拒答错误码和 DeepSeek 网页搜索默认值变更；本插件不匹配该错误码、不接管搜索，无需迁移。
- 更新保留现有 API 凭据、模型选择和用量存储。若桌面端仍显示旧的兼容结果，请完整退出并重开 DSH；本地目录链接安装无需先卸载。

## 功能

- **看板与配置分离**：设置中的“Capinfo 模型”只保留 API 密钥与模型配置；今日用量、近 30 天金额/Token 图表移到左上角原生导航菜单【Capinfo看板】的居中弹窗，不再出现在设置页。
- 插件独立注册 `capinfo` 运行时 provider，只在“Capinfo 模型”菜单管理，不发布通用模型设置目录条目，因此通用“模型”页面不显示 Capinfo，也没有误删除入口。聊天模型选择器正常使用，provider ID 不变。
- 首次启用后，在首次打开设置页时自动迁移现有 `capinfo` 自定义 API 的 URL、协议、凭据引用、模型及兼容参数（避免在 Loader 热加载事务内嵌套修改配置）；迁移后每次启动直接注册独立 provider。无现有路由时使用 `https://api.capinfo.com.cn/v1`、`openai-responses` 和 `CAPINFO_API_KEY`。
- API 密钥保存至 Harness 凭据服务，不写入插件配置、不回显。已配置状态显示绿色，密钥框显示固定 12 个圆点占位符（不是实际密钥，不反映长度，也不会作为输入提交）。首次安装发现已有密钥时自动拉取一次；首次同步或保存新密钥默认选中全部模型。
- 保存按钮右侧提供红色“删除凭证”，展开确认后只删除本地保存的 API 密钥，保留接口和模型配置。环境变量或 `.env` 中的备用密钥无法由此删除，仍有效时界面会明确提醒；只读凭据存储禁用删除。
- 模型列表搜索、勾选、全选搜索结果、保存勾选及重新拉取。后续重新拉取保留原选择，新模型作为候选。至少选一个模型（底层自定义 API 不接受空列表）。
- **输入能力与独立视觉纠偏**：一般模型优先使用自身输入类型，其次使用路由默认配置，未声明时仅支持文本；原生图片能力始终保留。[视觉纠偏规则](<vision-capabilities.js>) 当前仅针对 `glm-5.3-flash`（兼容大小写及空格/下划线分隔）补充图片输入，不按显示名称或 GLM 前缀泛匹配。模型发现和适配器底层模型共用此规则，已有文本-only 配置在插件重新加载后也生效，无需重新拉取或改写原配置；后续模型只需扩展独立规则表。
- 仅修改 `capinfo` 路由，保留其他接口。启用了 `dsh-scoped-models` 时，仅同步其中的 capinfo 选择，保留其他供应商。
- 界面操作统一走 Host 侧 `CapinfoService.run()`，经 `POST /api/plugins/capinfo` 到达；本插件不向 agent 注册任何工具。请在设置里输入 API 密钥，不要在对话中提交秘密（对话内容会进入会话记录）。

## 每日金额与 Token 用量

- 看板弹窗顶部第一行为“今日用量”，第二行并排展示“费用 ¥1.30”和“Token 2亿1375万”（示例；Token 低于 1 万显示原值，1 万及以上按“亿/万”分组并省略不足一组的零头，如 264万3486 显示为“264万”，窄屏仍保留两列）；第二行指标下方另展示今日单位成本，与每日提示使用相同口径。下方仅以蓝色渐变圆角柱状图展示近 30 天 Token 用量；费用不绘图。图例位于左上侧，日期刻度随容器宽度稀疏显示；缺测仅在展示层按 0 处理，不修改原始统计。图表标题为“近 30 天用量”；鼠标悬停绘图区或键盘选择日期时，显示竖向辅助线与每日费用、简写 Token、单位成本。单位成本按当日原始费用 ÷ 当日原始 Token × 100 万计算，以 ¥ / 1M Token 表示；Token 为 0 或任一数据缺测时显示 `—`；键盘读屏保留精确用量；鼠标移出或在键盘选中数据点时按 Esc 可关闭提示；不显示采样中的提示文案，页面不再展示每日数据表、Token 分项和底部口径说明（统计口径仍见下文）。看板以居中弹窗展示：点击侧边栏“Capinfo看板”打开，弹窗宽度上限 880px、高度随内容自适应且不超过视口（超出时弹窗内部滚动）；点击弹窗外的遮罩、右上角关闭按钮或按 Esc 关闭，关闭后焦点回到侧边栏入口，聊天区保持挂载（不丢失滚动位置和草稿）。前端每 30 秒读取 Host 缓存，不直接访问远端；按 **Asia/Shanghai（北京时间）00:00** 切换新一天，跨日 Token 读取立即返回零，金额等待新日首次采样，无需重启或等待下一次模型调用。看板不重复显示“Capinfo看板”标题，入口使用所提供莲花图案的简笔线条图标，并支持原生菜单排序、收起和取消固定。查询失败时静默保留当天最新数据；当天没有数据时，摘要显示 ¥0.00 和 0，不显示红色错误文案，也不复用昨天的数据。关闭再打开仍可使用本页面已读取的当天快照；历史图表缺测按 0 连续展示，原始历史仍保留缺测状态。
- 仅累计此 Harness profile 中由本插件 `capinfo` 路由返回的 usage，包括主会话/子代理、直接调用和 prepared-call；不是 Capinfo 账户全局账单，也不追溯安装前用量。不读取其他供应商用量，不估算缺失 usage；失败响应仅在上游报告 usage 时计入。请求数是有效 usage 响应数，并非用户消息数。跨日请求按收到 usage 的时刻归属日期。
- 输入、输出及缓存口径沿用 pi-ai 规范化值；总量优先使用上游总计，不重复加缓存或推理 Token。重试若有单独报告的 usage，会分别累计。
- 独立 `capinfo_usage` Storage Domain 持久化最近 **30 个北京时间自然日（含今日）** 的每日金额、Token 和计算基准；旧版单日 Token 数据无损接入历史，无法追溯此前已丢弃的日期。正常重启同日继续，更换/删除 API Key 不清空 Token。并发写入串行化，不保存提示词、响应内容或明文密钥。突发进程崩溃可能丢失尚未落盘的数据；存储写入失败时 `persistenceError: true`（供接口诊断，看板不显示错误文案），内存继续累计，下次写入重试。

### 人民币金额口径

- Host 启用后立即查询一次，此后每 **60 秒**请求 `GET https://api.capinfo.com.cn/v1/user/balance`，使用凭据服务解析当前 API Key，携带 `Authorization: Bearer …` 与 `User-Agent: cc-switch/1.0`。无密钥不请求，不跟随重定向，单次超时 20 秒；不需要打开看板弹窗。
- 仅使用响应中的累计消费 `used`，要求 `success=true`、`is_active=true`、`source=api_key`、`currency=unit=CNY` 及有限非负 `used`。无限额度时 `balance/total=null` 不影响消费统计。不展示账户余额，不恢复原来的模拟余额或 `capinfoBalance` 服务。
- 每天北京时间首次成功采样的 `used` 为当天基准，后续差额为**今日已用金额**，首次为 ¥0.00，显示两位小数，计算与持久化保留原精度。“今日总额度”不是账户授信上限或剩余额度。跨天不将跨夜差额计入新一天；当天未成功采样时，公开接口仍返回 `null`；看板摘要按无数据回退显示 `¥0.00`，并不表示已完成采样。
- 更换 Key 或累计 `used` 回退时，保留当天已记录金额并以新值重新起算，不产生负金额；内部仅保存 Key 的 SHA-256 指纹用于辨别基准，指纹与原始 `used` 不通过公开快照返回。删除 Key 保留历史；环境备用凭据仍可能继续采样。
- 金额是当前 Key 在接口报告的累计消费差额，可能包括其他设备/应用调用；Token 仅来自本 Harness profile，因此两者不是相同覆盖范围，不能据此精确推算单 Token 价格或正式账单。零点前最后采样到零点间的消费、每天首次采样之前的消费无法精确归属，也无法从累计 `used` 恢复停机期间的每日金额。
- 网络/格式/鉴权失败静默保留当天已有金额和采样时间，下一分钟自动重试，不把未知日期补成零、不伪造历史；迟到的旧密钥响应不可覆盖新记录。缺失日期仅在图表展示层按 0 绘制，不改写存储或公开接口中的缺测值。

### 外部只读接口

`GET /api/plugins/capinfo/usage`，沿用 Harness Connection 的身份认证，不是匿名公网接口，响应 `Cache-Control: no-store`：

```json
{"ok":true,"usage":{"date":"2026-11-11","timeZone":"Asia/Shanghai","inputTokens":100,"outputTokens":20,"cacheReadTokens":10,"cacheWriteTokens":0,"totalTokens":130,"requests":1,"updatedAt":"2026-11-11T03:00:00.000Z","amount":0.12,"amountUpdatedAt":"2026-11-11T03:00:00.000Z","history":[{"date":"2026-11-11","inputTokens":100,"outputTokens":20,"cacheReadTokens":10,"cacheWriteTokens":0,"totalTokens":130,"requests":1,"updatedAt":"2026-11-11T03:00:00.000Z","amount":0.12,"amountUpdatedAt":"2026-11-11T03:00:00.000Z"}],"spending":{"status":"ready","checkedAt":"2026-11-11T03:00:00.000Z","error":null},"persistenceError":false}}
```

`POST /api/plugins/capinfo` 的 `{"action":"status"}` 响应也附带同一 `usage`。新日无用量时 Token 计数全为零，`updatedAt: null`，金额首次采样前为 `null`；历史仍可读取。

Host 插件可直接读取标准 Cordis 服务，无需 HTTP 或凭据。只需要看板顶部的三个数值（费用、Token、数据刷新时间）时调用 `today()`：

```js
export const inject = ['capinfoUsage'];
export function apply(ctx) {
  const {amount, tokens, refreshedAt} = ctx.capinfoUsage.today();
  // amount: 0.8480409999999996（今日人民币费用，保留原始精度，看板显示为 ¥0.85；当天首次成功采样前为 null，不是 0）
  // tokens: 5931951（今日总 Token，已含缓存，无需再加；看板显示为 593万）
  // refreshedAt: '2026-11-13T09:39:58.747Z'（费用对应的余额采样时间，即看板“数据刷新时间”；采样前为 null）
}
```

三个值均为原始数值，不含历史、采样状态或格式化文本，显示格式由调用方决定。每次调用都重新读取当前内存快照，读取无网络或配置写入；跨北京时间零点后自动返回新一天的数据（Token 归零，金额等待新日首次采样）。需要历史、采样状态或分项 Token 时使用 `getSnapshot()`。

TypeScript 类型通过 `import type { CapinfoTodayUsage, CapinfoUsageSnapshot } from '@local/dsh-capinfo/usage-service'` 导入，同时扩展 Cordis Context。`today()` 返回新对象，`getSnapshot()` 返回独立副本。

## 配置与存储

插件 Config 可选 `baseURL`、`api`，省略时优先沿用当前 capinfo 路由。为避免将凭据发送至第三方，仅允许 HTTPS 的 `api.capinfo.com.cn`。

- API key 使用现有路由的 `apiKeyEnv` 凭据引用（默认 `CAPINFO_API_KEY`）。
- 接口配置、已选模型、完整候选模型缓存由 `storageDomain` 的 `capinfo_models` 域持久化。原有 v1 候选缓存向后兼容。
- 迁移先构建并校验全部模型、持久化完整原配置备份，再通过 `settings.mutate` 移除通用适配器中的 `providers.capinfo`；之后只注册自己的运行时 adapter，不注册 configurable provider。注册失败自动恢复旧条目；准备阶段中断可在下次启用时续迁移，检测到原配置变化则停止，不覆盖其他窗口更改。
- 模型勾选保存仅修改插件存储；仅在启用模型范围插件时同步它的 capinfo 选择。不会直接写用户 profile 文件，不会修改其他 API。
- 停用或卸载本插件会使 capinfo 运行时 provider 不再可用，但不会自动清除插件存储或凭据，也不会自动把通用模型条目加回来。
- 打开看板弹窗时自动读取已存状态，保存和刷新后自动更新；操作失败后后台核对一次已存状态，保留未保存的模型勾选和 API 密钥输入。只有网络或状态核对失败时显示小型“重试”入口，重试只读取状态，不重复提交保存。密钥保存与模型拉取不是原子事务，业务错误会明确说明密钥是否已保存。

## 适配器复用与版本约束

复用宿主 `@deepseek-ai/dsh-llm-pi-ai` 导出的 `PiAiAdapter` 和 pi-ai 公共协议工厂，保留 Harness 的工具调用、历史转换、图片预算、replay、用量与错误处理；不调用会注册通用目录的 `llm-pi-ai.apply`，不改 Harness 本体，不做 CSS 隐藏。仅为 Capinfo 自定义路由构建模型/推理级别/compat 元数据。对应模型字段的语义依据 DeepSeek Harness（MIT）公开安装实现；未复制完整目录解析器或流实现。

`PiAiAdapter` 的配置结构不是跨版本稳定接口。0.2.x 升级无需逐版修改声明；如果宿主 API 确实发生变化，再修复适配器。跨到 0.3 前先跑契约回归，再扩展兼容范围，不使用版本豁免。

## 本地验证

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run check
pnpm test
```

运行测试前需要安装 peer 依赖。`tests/runtime-contract.test.js` 实际导入 Host 入口和 `PiAiAdapter`，覆盖三种协议的配置解析、模型描述、推理级别、凭据缺失及模型替换；不调用真实 Capinfo 接口、不读取用户密钥。

无需独立 Web 服务器。图表使用本地打包的 Apache ECharts 6.0.0（Token 柱状图 + 金额平滑线、双轴、底部图例），不请求 CDN、不加载另一份 React。旧手写 SVG 曲线及原生 title 提示已移除。ECharts 负责轴级悬浮提示和边界避让，提示内容使用固有宽度、不拆分日期/金额；窗口尺寸变化自动 resize，宿主主题变化更新颜色。支持左右方向键/Home/End 选日期及 Esc 关闭，并提供读屏精确值。

可维护入口为 [client-source.js](<client-source.js>)，图表组件与配置分别为 [usage-chart.js](<usage-chart.js>)、[usage-chart-options.js](<usage-chart-options.js>)。修改这些源文件后执行 `pnpm run build`，生成实际导出的 [client.js](<client.js>) 及许可证摘要；`pnpm run check` 还会检查产物是否与源码一致，禁止只改源码却发布旧产物。构建脚本仅用于本地开发，无安装脚本；分发包内已包含预构建产物。许可及归属说明见 [第三方声明](<THIRD_PARTY_NOTICES.md>)。

使用 Harness 插件管理安装本目录；首次安装可热加载，后续替换已加载 JavaScript 通常需重启 Harness。界面使用宿主主题 token 和中英文 locale；原创建的 SVG 图标随包分发。


### 本次验证边界

构建、单元测试覆盖数据口径、配置、HTML 转义、缺测/零值、产物加载与过期产物检测，并检查注册面（设置中的配置分区 + 侧边栏看板入口与弹窗，设置分区不渲染图表）；不等同于浏览器视觉验收。当前用户选择先完成代码并自行验收，真实设置页、侧边栏入口与弹窗在窄窗口、折叠侧边栏和深浅主题下的效果仍待验收。
