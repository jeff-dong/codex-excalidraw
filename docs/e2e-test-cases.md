# Codex Excalidraw 端到端测试用例

## 0. 测试前准备

建议用一个独立项目目录测试，不要直接用插件仓库当用户项目：

```bash
export CODEX_EXCALIDRAW_REPO="$HOME/plugins/codex-excalidraw"
export CODEX_EXCALIDRAW_PLAYGROUND="$HOME/codex-excalidraw-e2e-playground"
export CODEX_EXCALIDRAW_PLAYGROUND_2="$HOME/codex-excalidraw-e2e-playground-2"
mkdir -p "$CODEX_EXCALIDRAW_PLAYGROUND"
```

确保插件仓库本身验证通过：

```bash
cd "$CODEX_EXCALIDRAW_REPO"
npm run build
npm test
```

启动画布：

```bash
cd "$CODEX_EXCALIDRAW_REPO"
./scripts/start-canvas.sh "$CODEX_EXCALIDRAW_PLAYGROUND"
```

打开终端输出里的 URL，默认是：

```text
http://127.0.0.1:43218/
```

如果要测试 Codex App 插件加载，重新开一个 Codex 会话，工作目录选择：

```text
$CODEX_EXCALIDRAW_PLAYGROUND
```

## 1. 自动回归：底层 MCP/API 数据流

目的：确认不依赖浏览器控制，MCP 能完成绘制、选区修改、评论修改、插图和导出。

操作：

```bash
cd "$CODEX_EXCALIDRAW_REPO"
npm run test:mcp
```

预期：

```json
{
  "ok": true
}
```

验收点：

- 文件型 MCP 流通过。
- API 型 MCP 流通过。
- Action 队列流通过：pending action 可以被读取、claim、complete，并按完成状态处理关联 comment。
- 测试期间会启动一个临时 Vite API，并验证 MCP 写入的是 API 通道。
- 测试会验证没有浏览器 canvas runtime 时 `/api/native-elements` 直接返回 409，普通 MCP 绘图不会等待超时，也不会降级到文件/API scene writer；只有显式 headless 测试路径才允许 file-backed 写入。
- 测试会覆盖外部图片源、恶意图片名、恶意导出名前缀、project mismatch、静态资源目录穿越请求，确认所有中间产物只落在 active project 的 `canvas/excalidraw/` 下。

## 1.1 自动回归：真实浏览器用户动线

目的：确认用户真实打开页面、点击控件、选择画布元素、添加评论、切换项目、导出和刷新时，页面行为、MCP/API 数据流、文件产物边界一致。

操作：

```bash
cd "$CODEX_EXCALIDRAW_REPO"
npm run test:e2e
```

完整发布前回归：

```bash
npm run test:all
```

真实 Codex CLI 执行器验收：

```bash
npm run test:real-executor
```

这条测试会真实触发 Codex CLI 和模型调用，默认保留运行中和完成后的截图目录，专门用于发布前看 UI 表现和底层执行链路。

覆盖动线：

| 用户动线 | 自动断言 |
|---|---|
| 新项目打开画布 | 启动临时 local canvas service，Chrome 打开页面，`session.projectDir` 指向临时 project |
| Codex 生成可编辑图 | 通过 `/api/native-elements` 触发浏览器 runtime，确认 Excalidraw native conversion 完成并写入 scene |
| 原生绘制/刷新不清空 | 插入后等待 autosave，确认元素仍在 scene |
| 用户真实选择元素 | 用鼠标点击 canvas 元素，确认 `/api/selection` 写入 selected element ids |
| 页面添加 comment | 在右侧注释面板填入评论并点击添加，确认 `comments.json` 有结构化 `targetElementIds` |
| Run with Codex | 点击评论卡片按钮，确认本地 executor run 出现、进度卡片可见、页面不退回 loading |
| 执行状态同步 | 确认 executor 完成后 `actions.json` 为 completed、`comments.json` 为 resolved、目标元素带 executor run 标记 |
| 取消执行 | 通过 executor cancel API 取消运行中的 action，等待后台任务收尾后仍保持 canceled |
| 执行器设置 | 打开 Settings，确认执行器扫描、默认本地执行模式和可用 executor 列表 |
| 生成并插入图片 | 通过 MCP `insert_excalidraw_image` 写入 API，确认 image 元素、files、asset 文件存在 |
| 图片真实可见 | 对 Excalidraw canvas 做像素检查，确认插入图片的彩色 PNG 实际渲染，不只是占位 image 元素 |
| 图片可操作 | 真实点击生成图片区域，确认选中的是 image 元素；拖动后确认 scene 坐标变化 |
| 设置语言和主题 | 点击 Settings，切换 English 和 dark，确认 shell/localStorage 状态更新 |
| 右侧面板操作 | 点击收起/展开，拖拽 resizer，确认面板可恢复且宽度变化 |
| 浏览器导出 | 点击顶部 Export 下拉导出 JSON/SVG/PNG，确认文件写入 active project exports |
| 多项目管理 | 从项目下拉输入 Project B，生成内容，再用 recent select 切回 Project A |
| 项目隔离 | 确认 A/B scene 不混写，assets/exports 不写到插件仓库或 project root |
| 刷新恢复 | reload 页面后确认 scene、image、comment、action 仍可恢复 |
| 移动端首屏 | 用 390x844 viewport 打开页面并截图，确认 app-shell 可加载 |

`npm run test:real-executor` 额外覆盖：

| 用户动线 | 自动断言 |
|---|---|
| 真实 Codex CLI 被选中 | `/api/executors` 选择 `codex-cli`，不是 mock |
| 真实浏览器提交 comment | 页面选择元素、添加 comment、点击 `Run with Codex` |
| 真实 CLI 执行中 UI | 截图 `01-real-executor-running.png`，断言 app shell/canvas 仍可见且没有 loading screen |
| 真实 CLI 修改 scene | Codex CLI 通过 MCP 修改目标元素颜色 |
| 完成态 UI | 截图 `02-real-executor-completed.png`，断言 action/comment/scene 持久化一致 |
| 产物边界 | 确认真实执行期间没有写入插件仓库的 `canvas/excalidraw` |

## 2. 手动用例：打开项目白板

目的：确认白板在 Codex 内置浏览器打开，且数据写入用户项目，而不是插件仓库。

在 Codex App 新会话里输入：

```text
打开 Codex Excalidraw 画布
```

预期：

- Codex 返回本地画布 URL。
- 画布页面在 Codex App 内置浏览器中打开。
- 不应该调用 macOS 默认浏览器。
- 用户项目下出现：

```text
canvas/excalidraw/session.json
canvas/excalidraw/scene.excalidraw
```

检查：

```bash
ls -la "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/session.json
```

通过标准：

- `session.json` 里的 `projectDir` 是 e2e playground 目录。
- `apiBaseUrl` 是当前画布服务地址。
- 右侧面板是注释面板，不再出现 `Project / Selection / Comments / Exports` 四个 tab。
- 当前 project 显示在顶部标题栏，点击项目路径可下拉切换最近项目或输入新 project。
- 当前选区只显示为注释目标，不作为独立菜单出现；导出只在顶部 `导出 / Export` 下拉里出现。
- 顶部 `导出 / Export` 旁边有注释 icon，点击后可以展开或收起右侧注释面板。
- 顶部不再出现 `示例 / Sample` 和 `图片 / Image` 按钮。
- 点击右侧面板的收起按钮后，面板变成窄工具条；再次点击顶部注释 icon 可以展开回注释面板。
- 拖拽右侧面板左边缘可以调整宽度，画布区域同步让出空间。
- 顶部 Settings icon 可以切换中文 / English，Excalidraw 自身语言也跟随变化。
- Settings 的深色 / 浅色切换会同步到 Excalidraw 原生 theme；如果用户从 Excalidraw 原生菜单切换主题，我们的设置状态也会反向同步。

失败标准：

- 画布被系统默认浏览器打开。
- `session.json` 的端口和 Vite 实际运行端口不一致。
- 小窗口下无法打开顶部项目下拉菜单，导致用户无法切换 project。

## 2.1 手动用例：切换到历史 project 或新增 project

目的：确认用户可以在画布中切换 project session，之前项目的白板上下文可以恢复。

准备第二个项目：

```bash
mkdir -p "$CODEX_EXCALIDRAW_PLAYGROUND_2"
```

操作：

1. 点击顶部标题栏里的当前项目路径，打开项目下拉菜单。
2. 在项目输入框中粘贴：

```text
$CODEX_EXCALIDRAW_PLAYGROUND_2
```

3. 点击 `Open`。
4. 在第二个 project 中画或让 Codex 生成一些元素。
5. 再打开顶部项目下拉菜单，用 `Recent projects` 切回第一个 project。

预期：

- 每次切换后画布内容切到对应 project。
- 两个 project 分别有自己的 `canvas/excalidraw/scene.excalidraw`。
- `Recent projects` 中能看到两个项目。

检查：

```bash
ls -la "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw
ls -la "$CODEX_EXCALIDRAW_PLAYGROUND_2"/canvas/excalidraw
cat ~/.codex-excalidraw/projects.json
```

通过标准：

- 切回旧 project 后能看到旧图。
- 第二个 project 的元素没有混到第一个 project。
- Codex 后续操作前可以通过 `get_excalidraw_session` 确认当前 active project。

## 3. 手动用例：Codex 问答生成可编辑图

目的：确认用户在 Codex 输入框发起绘制，MCP 写入 Excalidraw scene，画布自动刷新。

在 Codex App 输入：

```text
在 Excalidraw 画布上画一个 Codex Excalidraw 插件的数据流图，包含：用户、Codex Chat、MCP Server、Local Canvas API、scene.excalidraw、exports。每个节点都要是可编辑元素，并给关键节点设置 semanticId。
```

预期：

- Codex 先调用 `open_excalidraw_canvas`，返回当前 project 的 live URL 和 `sourceMode: "api"`。
- 画布中出现多个手绘风格节点和箭头。
- 节点不是一张图片，可以单独选中和拖动。
- Codex 回复包含插入元素数量或关键元素说明。
- 如果画布页面已打开并连接本地 API，`insert_excalidraw_elements` 返回的结构化结果应包含 `nativeConversion: true`。
- 如果浏览器工具不可用，Codex 必须返回 `open_excalidraw_canvas` 给出的 URL，不能静默只写 `scene.excalidraw`。

检查：

```bash
node -e "const fs=require('fs'); const p='$CODEX_EXCALIDRAW_PLAYGROUND/canvas/excalidraw/scene.excalidraw'; const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log(s.elements.length); console.log(s.elements.map(e=>e.customData?.codex?.semanticId).filter(Boolean));"
```

通过标准：

- `elements.length > 0`
- 至少有几个元素带 `customData.codex.semanticId`

## 4. 手动用例：用户选区后多轮修改

目的：确认真实多轮使用方式：用户在画布里选择，Codex 在聊天里修改选区。

操作：

1. 在画布里选中一个或多个节点。
2. 回到 Codex App 输入：

```text
把我当前选中的元素改成审核通过状态：背景改成浅绿色，标签补充“已确认”，不要改其他元素。
```

预期：

- 只有选中的元素被改动。
- 相邻元素不受影响。
- 打开注释面板后，当前选中元素会显示为注释目标。

检查：

```bash
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/selection.json
```

通过标准：

- `selection.json` 中有 `selectedElementIds`
- 被修改元素的 `backgroundColor` 或对应 label 文本变化
- 非选中元素没有被批量误改

## 5. 手动用例：白板评论直接修改

目的：确认类似 Codex code comment 的流程：评论绑定元素，Codex 按评论修改并 resolve。

操作：

1. 在画布里选中一个节点。
2. 确认右侧注释面板的蓝色注释目标区已经显示已绑定目标，在新评论输入框中输入：

```text
这里改成“本地 API 层”，颜色改成淡紫色。
```

3. 点击 `Add comment`。
4. 点击该评论卡片里的 `Run with Codex`。
5. 如果本地执行器可用，观察评论卡片中出现 executor run 进度，不需要回到 Codex 输入框。
6. 如果执行器不可用或 Settings 里切到了复制指令模式，按钮会复制指令；这时可以回到 Codex App 输入框粘贴发送，也可以手动输入：

```text
执行 Excalidraw action。先读取 pending action，claim 后只处理它的 targetElementIds，按 instruction 修改画布，最后 complete action。
```

预期：

- 目标元素被修改。
- 评论状态变成 `resolved`。
- 对应 action 状态变成 `completed`。
- 没有依赖文本模糊匹配去猜元素。
- 评论提交后右侧注释列表计数变化，并出现 `Saved comment_...` / `已保存 comment_...` 状态提示。
- 点击 `Run with Codex` / `交给 Codex 执行` 后，右侧评论卡片显示 action 状态和 executor run 进度。
- 真实执行过程中页面不能白屏或退回加载页，画布仍可查看。

检查：

```bash
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/comments.json
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/actions.json
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/executor-runs.json
```

通过标准：

- 评论有 `targetElementIds`
- 对应评论 `status` 是 `resolved`
- 对应 action `status` 是 `completed`
- executor run `status` 是 `completed`
- 目标元素发生了评论要求的变化

如果评论内容是“删除”，Codex 应调用 `delete_excalidraw_elements`，target 使用该 action/comment 的 `targetElementIds` 或 `commentId`，删除后调用 `complete_excalidraw_action` 自动 resolve。页面里的 `Resolve` 只用于关闭评论，不代表已经执行评论。

## 5.1 手动用例：优化用户手绘草图

目的：确认用户手绘或粗略搭建的内容可以被 Codex 整理成可编辑图，同时保留原稿。

操作：

1. 在画布里用自由绘制、矩形、箭头和文本随手画一个粗略流程。
2. 框选这组粗略元素。
3. 在 Codex App 输入：

```text
把我选中的手绘草图整理成一个干净的三步流程图，保留原稿，在右侧放一份优化版。如果有关系不确定，用评论标出来。
```

预期：

- 原始手绘元素仍然存在，没有被覆盖或删除。
- 右侧出现一组新的可编辑 Excalidraw 元素，不是一张扁平图片。
- 关键元素带 `customData.codex.semanticId`。
- 不确定关系会变成结构化 comment，而不是页面侧靠关键词猜测。

检查：

```bash
node -e "const fs=require('fs'); const p='$CODEX_EXCALIDRAW_PLAYGROUND/canvas/excalidraw/scene.excalidraw'; const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log(s.elements.filter(e=>!e.isDeleted).map(e=>({id:e.id,type:e.type,semanticId:e.customData?.codex?.semanticId,batchId:e.customData?.codex?.batchId})));"
cat "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/comments.json
```

通过标准：

- 原稿元素 ID 仍然存在且 `isDeleted !== true`。
- 优化版包含多个非 image 类型元素。
- 如果生成评论，评论必须有 `targetElementIds`。

## 6. 手动用例：导出文件

目的：确认 Codex 能通过 MCP 导出源文件/JSON/SVG，页面按钮能导出 PNG。

在 Codex App 输入：

```text
把当前 Excalidraw 画布导出为 excalidraw、json、svg，文件名前缀用 e2e-data-flow。
```

预期：

```text
canvas/excalidraw/exports/e2e-data-flow.excalidraw
canvas/excalidraw/exports/e2e-data-flow.json
canvas/excalidraw/exports/e2e-data-flow.svg
```

检查：

```bash
ls -la "$CODEX_EXCALIDRAW_PLAYGROUND"/canvas/excalidraw/exports
```

页面 PNG 测试：

1. 在画布页面点击顶部 `导出 / Export`。
2. 在下拉中选择 `PNG`。
3. 检查 `exports/` 下是否出现 PNG。

通过标准：

- MCP 导出的 `.excalidraw`、JSON、SVG 文件存在。
- 页面按钮导出的 PNG 文件存在。

## 6.1 手动用例：Excalidraw 原生主题和图片能力

目的：确认我们优先使用 Excalidraw 原生能力，而不是在外层重复实现。

操作：

1. 打开 Settings。
2. 切换到 `深色 / Dark`，再切回 `浅色 / Light`，最后再切回 `深色 / Dark`。
3. 打开 Excalidraw 原生主菜单，确认原生画布 UI 也是 dark。
4. 再用 Excalidraw 原生菜单切回 light。
5. 检查 Settings 中的外观状态是否同步变为 light。
6. 在 Excalidraw 原生工具栏选择图片工具，手动插入一张本地图片。
7. 在 Excalidraw 原生工具栏选择矩形工具，画一个矩形，等待 2 秒后确认没有被清空。

预期：

- 外层顶部栏、右侧注释栏、Excalidraw 原生画布主题一致。
- 原生图片工具可用，插入后的图片是 Excalidraw `image` 元素。
- 刷新页面后图片仍然存在。

检查：

```bash
node -e "const fs=require('fs'); const p='$CODEX_EXCALIDRAW_PLAYGROUND/canvas/excalidraw/scene.excalidraw'; const s=JSON.parse(fs.readFileSync(p,'utf8')); console.log('theme persisted:', Object.prototype.hasOwnProperty.call(s.appState||{}, 'theme')); console.log('images/files:', s.elements.filter(e=>!e.isDeleted && e.type==='image').length, Object.keys(s.files||{}).length); console.log('rectangles:', s.elements.filter(e=>!e.isDeleted && e.type==='rectangle').length);"
```

通过标准：

- scene 不应该依赖持久化的 `appState.theme`；主题由 Settings/localStorage 和受控 Excalidraw `theme` prop 决定。
- `image` 元素数量增加。
- `files` 中有对应图片文件数据。
- 原生绘制的矩形等待后仍然存在，没有被自动保存或远程刷新逻辑清空。

## 6.2 手动用例：任意项目目录的边界控制

目的：确认用户在任意项目或任意文件夹下让 Codex 处理绘图时，不会把 scene、图片、导出文件、中间产物写到项目外或插件仓库。

准备：

```bash
mkdir -p "/tmp/codex excalidraw boundary project/sub dir"
mkdir -p /tmp/codex-excalidraw-outside
```

操作：

1. 启动画布：

```bash
cd "$CODEX_EXCALIDRAW_REPO"
./scripts/start-canvas.sh "/tmp/codex excalidraw boundary project/sub dir"
```

2. 让 Codex 绘制一张图。
3. 让 Codex 生成或插入图片到某个选中的图形里。
4. 导出 `.excalidraw/json/svg/png`。
5. 切换到另一个 project 后，再要求 Codex 修改旧 project 的图。

预期：

- 所有 scene/comment/action/selection/session 文件只在当前 project 的 `canvas/excalidraw/`。
- 图片只在当前 project 的 `canvas/excalidraw/assets/`。
- 导出只在当前 project 的 `canvas/excalidraw/exports/`。
- 切换 project 后，旧 project 写入应被拒绝或要求先切回正确 project。

检查：

```bash
find "/tmp/codex excalidraw boundary project/sub dir" -maxdepth 4 -type f | sort
find /tmp/codex-excalidraw-outside -type f | sort
find "$CODEX_EXCALIDRAW_REPO" -maxdepth 3 -path '*/canvas/excalidraw/*' -print
```

通过标准：

- 第一个 `find` 只显示该测试 project 下的 `canvas/excalidraw` 文件。
- 第二个 `find` 为空。
- 插件仓库自身没有新增用户 project 的 `canvas/excalidraw` 产物。
- MCP 明确使用 `get_excalidraw_session` 或 active API 校验 project，不能静默写错项目。

## 6.3 手动用例：SKILL runtime 边界

目的：确认 Codex 在创建、打开、修改、插图、优化和导出前会先判断依赖、服务、session、产物目录和已有 scene，不把 file-backed 写入伪装成可见画布更新。

### 6.3.1 无 session 时创建绘图

准备：

```bash
rm -rf /tmp/codex-excalidraw-no-session
mkdir -p /tmp/codex-excalidraw-no-session
```

操作：

在 Codex App 中把 workspace 指向该目录，输入：

```text
创建一张可编辑的系统架构图
```

预期：

- Codex 先启动或复用 local canvas service。
- Codex 返回本地 URL。
- 如果 Codex App 内置浏览器工具可用，画布被打开并显示。
- `canvas/excalidraw/session.json` 和 `scene.excalidraw` 都存在。
- MCP 写入结果应是 `api` source mode；如果是 `file`，回复必须明确说明降级并返回 URL。

失败标准：

- 只生成 `scene.excalidraw`，没有 `session.json`，且回复说已经完成可编辑画布。
- 没有返回 URL。
- 用系统默认浏览器打开，而不是 Codex App 内置浏览器或返回 URL。

### 6.3.2 已有 scene 时创建新绘图

准备：

```bash
./scripts/start-canvas.sh /tmp/codex-excalidraw-existing-scene
```

先让 Codex 画一组元素，再输入：

```text
再创建一个支付链路图
```

预期：

- 原有元素保留。
- 新图作为新的 editable elements/group 插入。
- 除非用户明确要求重置，不得清空或覆盖 `scene.excalidraw`。

### 6.3.3 stale session 或错误 project

准备：

1. 启动 project A 的画布。
2. 停止服务，或切到 project B。
3. 在 project A 中要求 Codex 修改画布。

预期：

- Codex 不信任 stale `session.json`。
- 如果 live API 指向错误 project，应调用 project switch 或重新启动 project A 的服务。
- MCP 不得静默写入 project B。

### 6.3.4 依赖或启动失败

准备：

临时破坏启动环境，例如让 `npm` 不可用，或让 `scripts/start-canvas.sh` 返回失败。

预期：

- Codex 报告具体失败命令和错误。
- Codex 不继续进行普通绘图的 file-backed fallback。
- 只有用户明确接受 headless 文件产物时，才允许写 `scene.excalidraw`。

### 6.3.5 选择区、评论、图片、优化和导出边界

| 场景 | 前置条件 | 预期 |
|---|---|---|
| 修改“选中的部分” | 无 live selection | 要求用户打开画布并选择元素，不靠文字匹配目标 |
| 处理 `Run with Codex` | 有 pending action | 先 claim，再按 action target ids 执行，最后 complete |
| 插入图片到区域 | 无 selection/action/comment target | 要求用户提供结构化目标，不按自然语言猜区域 |
| 优化手绘草图 | 无 selection | 要求用户选择原始草图；不得猜测某个区域并覆盖 |
| 导出 PNG | 无 live browser canvas | 先打开/返回画布 URL；不能把 basic SVG 或 JSON 冒充 PNG |
| 导出 JSON/basic SVG | 已有 scene，无 live service | 可 headless 导出，并明确导出文件路径 |

## 7. 手动用例：刷新后状态恢复

目的：确认数据持久化。

操作：

1. 刷新画布页面。
2. 或停止 `start-canvas.sh` 后重新启动。

预期：

- 之前生成的图仍然存在。
- 评论状态仍然存在。

通过标准：

- scene、files、comments 都从用户项目目录恢复。
- 没有写入插件仓库的 `canvas/` 目录。

## 8. 失败判定

以下情况都算失败：

- Codex 需要通过浏览器截图、鼠标点击、视觉识别才能完成核心绘制或修改。
- 修改选区时误改非选中元素。
- 评论没有 `targetElementIds`。
- 导出文件写到了插件仓库，而不是用户项目。
- 多项目同时打开时，MCP 写入了错误项目的 `canvas/excalidraw/`。
- 图片、导出文件、临时文件或 asset 写到了 active project 的 `canvas/excalidraw` 之外。
- UI dark/light 只改变外层壳，不改变 Excalidraw 原生画布主题。
- 手动图片插入必须绕过 Excalidraw 原生 image 工具。
- 用户要求创建、查看或编辑可见画布时，只写入 `scene.excalidraw`，没有启动或复用 live canvas service，也没有返回 URL。
- `sourceMode: file` 的降级写入被描述成已经更新了可见画布。
