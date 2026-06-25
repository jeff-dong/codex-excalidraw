# Codex Excalidraw 高保真设计 Brief

这份文档用于交给另一个设计 AI 生成高保真 UI 方案。请先理解产品边界：这是一个嵌入 Codex App 的本地 Excalidraw 白板插件，不是一个独立网页工具，也不是重做 Excalidraw 本体。

## 1. 项目背景

Codex Excalidraw 是面向 Codex App 的本地 AI 白板插件。

它把三个东西连接起来：

- Excalidraw 的手绘风格无限画布。
- Codex 的多轮对话和代码代理能力。
- 本地 MCP/API/文件系统的数据流。

用户在画布中直接画、选中、评论、导出；Codex 在聊天窗口中根据用户的自然语言指令生成图、修改选区、处理评论、导出文件。核心机制不是浏览器自动点击，而是结构化数据交互：Codex 通过 MCP 读取 scene、selection、comments、actions，再写入 Excalidraw elements 或导出文件。

产品最终形态是 Codex App 中的一个插件面板：

```text
+--------------------------------------------------------------+
| Codex App                                                    |
|                                                              |
|  Chat / Composer                         Excalidraw Canvas   |
|  用户输入:                               +----------------+  |
|  "把选中的图改成三层架构"                 | editable board |  |
|                                          | comments panel |  |
|                                          +----------------+  |
+--------------------------------------------------------------+
```

## 2. 产品定位

一句话定位：

> Codex Excalidraw 是给 Codex 使用的本地 AI 白板工作台，让用户用对话生成和修改可编辑的手绘图，并用结构化注释把白板问题交给 Codex 执行。

不是：

- 不是 Excalidraw 官方云服务替代品。
- 不是多人实时协作白板。
- 不是素材库、图片生成器或设计稿编辑器。
- 不是依赖截图识别和浏览器点击的自动化演示页面。

是：

- 单人本地工作流。
- Codex 项目上下文里的白板。
- 可编辑 diagram 的生成和修改工具。
- 类似 Codex code comment 的白板注释工作流。

## 3. 目标用户和核心场景

### 3.1 用户画像

目标用户是经常在 Codex 中做架构设计、产品规划、系统流程梳理、代码理解和方案评审的人。

他们的典型习惯：

- 在 Codex 输入框中描述需求。
- 希望 AI 直接生成可继续编辑的图。
- 会在画布里手动选择、拖动、框选、评论。
- 希望评论可以被 Codex 读取并执行，而不是只作为视觉标记。
- 希望数据保存在当前项目中，后续打开项目时上下文还在。

### 3.2 用户操作场景

设计时要把用户的“操作位置”表达清楚：用户不是只在一个网页里完成所有事情，而是在 Codex Chat 和 Excalidraw Canvas 之间来回工作。

```text
Codex Chat：说清楚意图、让 AI 绘图、让 AI 修改、让 AI 处理评论
Canvas：手动画图、选中元素、写评论、看结果、导出
MCP/API：在背后同步 scene、selection、comments、actions
```

#### 场景 A：打开当前项目的白板

用户位置：

- Codex Chat。

用户动作：

```text
打开 Codex Excalidraw 画布
```

系统响应：

- 启动本地画布服务。
- 在 Codex 内置浏览器或未来原生 panel 中打开白板。
- 读取当前项目下的白板数据。
- 顶部标题栏显示当前项目或 scene 路径，并提供项目下拉菜单。
- 右侧注释面板只显示注释目标、评论和执行状态，不承担项目主入口。

数据位置：

```text
<current-project>/canvas/excalidraw/
```

设计必须表达清楚：

- 用户当前打开的是哪个项目的白板。
- 这是本地项目上下文，不是一个全局云白板。
- 如果项目不对，用户可以从顶部标题栏的项目下拉菜单切换。

#### 场景 B：让 Codex 生成第一版图

用户位置：

- Codex Chat 发起。
- Canvas 中查看结果。

用户动作：

```text
画一个 Codex 插件的数据流图，包含 Chat、MCP Server、Local API、scene 文件和 exports。
```

系统响应：

- Codex 生成结构化 drawing plan。
- MCP 插入 Excalidraw elements。
- Canvas 自动刷新或呈现新增元素。
- 保存状态显示正在保存/已保存。

设计必须表达清楚：

- 画布里的内容是可编辑 Excalidraw 元素，不是一张图片。
- 顶部保存状态要稳定、低干扰。
- 生成后用户可以继续手动选中、拖动、评论。

#### 场景 C：用户自己在画布里继续画

用户位置：

- Canvas。

用户动作：

- 用 Excalidraw 官方工具栏画矩形、箭头、文字。
- 拖动画布、缩放画布、框选元素。
- 调整元素位置和样式。

系统响应：

- 页面自动保存 scene。
- selection 同步到本地 API。
- 右侧注释面板如果打开，会显示当前选区数量。

设计必须表达清楚：

- Excalidraw 本体是主工作区，不能被右侧面板和顶部栏压迫。
- 右侧面板应该可以收起，让用户专心画图。
- 不要重做 Excalidraw 官方工具栏。

#### 场景 D：选中元素后让 Codex 修改

用户位置：

- 先在 Canvas 选中元素。
- 再回到 Codex Chat 输入修改要求。

用户动作：

```text
把我选中的内容改成三层架构，不要改其他元素。
```

系统响应：

- MCP 读取当前 selection。
- Codex 只修改 selected element IDs。
- Canvas 更新目标元素。
- 非选中元素不应变化。

设计必须表达清楚：

- 右侧注释面板里的 “Annotation target” 不是独立功能页，而是当前选区状态。
- 有选区和无选区的视觉差异要明确。
- 不要出现让用户误以为“选择”是一个单独菜单的设计。

#### 场景 E：添加白板注释，但暂不执行

用户位置：

- Canvas 选中元素。
- 右侧 Annotation Panel 写评论。

用户动作：

```text
这里删掉，换成本地 API 层。
```

然后点击：

```text
添加评论 / Add comment
```

系统响应：

- 创建结构化 comment。
- comment 绑定当前 selected element IDs。
- 评论进入 open 状态。
- 评论显示在 timeline 顶部。

设计必须表达清楚：

- 未选择元素时，comment composer 应该不可用或明显提示先选择元素。
- 添加评论只是记录需求，不代表 Codex 已经执行。
- open 评论应该比 resolved 评论更突出。

#### 场景 F：把注释交给 Codex 执行

用户位置：

- 从右侧 Annotation Panel 发起。
- 回到 Codex Chat 观察或继续对话。

用户动作：

```text
交给 Codex 执行 / Run with Codex
```

系统响应：

- 页面把 comment 转成 pending action。
- action 带有 commentId、targetElementIds、instruction。
- Codex 读取 pending action、claim、执行结构化修改、complete action。
- 评论最终变为 resolved。

设计必须表达清楚：

- 这个按钮不是页面自己理解评论文本并直接改图。
- 它的含义是“把这条结构化任务交给 Codex”。
- queued、running、completed、failed 状态要在评论卡片中清楚显示。
- 如果当前 Codex App 只能复制指令到输入框，UI 要把“已复制，可发送给 Codex”表达清楚。
- 如果未来 Codex App 支持直接注入 composer，UI 可以升级成更直接的 handoff，但数据流仍然是 action queue。

#### 场景 G：多条评论的评审和收口

用户位置：

- Annotation Panel。

用户动作：

- 查看 open 评论。
- 对某条评论点击 Run with Codex。
- 手动 Resolve 已经不需要处理的评论。
- 展开更早的评论。

系统响应：

- open 评论保留主操作。
- resolved 评论弱化展示。
- 超过一定数量的评论默认折叠旧评论。
- timeline 保留处理历史。

设计必须表达清楚：

- 这是类似 Codex code comments 的评审队列。
- 用户应该优先处理 open 评论。
- 历史评论可以追溯，但不应占据太多注意力。

#### 场景 H：切换或恢复项目白板

用户位置：

- Top Bar 的当前项目下拉菜单。

用户动作：

- 查看当前项目。
- 从 Recent projects 中选择历史项目。
- 输入新的 project path 并 Open。
- 点击 Refresh。

系统响应：

- Canvas 切换到目标 project 的 scene。
- comments/actions/exports 也跟着项目上下文切换。
- 顶部路径和项目菜单状态更新。

设计必须表达清楚：

- Project switcher 是上下文管理，不是主导航。
- 切换项目会切换整张白板上下文。
- 长路径要可读但不能撑破布局。
- 切换中、成功、失败状态要清楚。

#### 场景 I：导出当前白板

用户位置：

- Top Bar。

用户动作：

- 点击 Export 下拉。
- 选择 PNG、SVG、JSON 或 `.excalidraw`。

系统响应：

- 保存导出文件。
- 显示导出结果路径或错误。

导出结果位置：

```text
<current-project>/canvas/excalidraw/exports/
```

设计必须表达清楚：

- 导出是顶部全局操作，不放在右侧注释面板。
- 导出菜单要短、明确、低干扰。
- 成功反馈要能让用户知道文件已经保存到本地项目。

#### 场景 J：多轮协作的真实节奏

典型完整路径：

```text
1. 用户在 Codex 中打开白板
2. 用户让 Codex 生成第一版架构图
3. 用户在 Canvas 中手动拖动和补充
4. 用户选中一组元素
5. 用户在 Codex 中要求修改选区
6. 用户在 Canvas 中对某些元素写评论
7. 用户点击 Run with Codex，把评论转成 action
8. Codex 执行 action 并 resolve 评论
9. 用户从 Export 导出 PNG/SVG
```

设计必须表达清楚：

- 用户会频繁在 Chat 和 Canvas 之间切换。
- Canvas 负责可视操作，Codex Chat 负责 AI 意图。
- 右侧注释面板是连接 Canvas 和 Codex 的任务桥。
- 页面不要看起来像“所有 AI 都在右侧面板按钮里完成”。

## 4. 当前页面结构

当前页面大致如下：

```text
+--------------------------------------------------------------------------------+
| Top Bar                                                                        |
| [App Icon] Codex Excalidraw Canvas / current scene path      [Saved] [Export] [Comment] |
+--------------------------------------------------------------------------------+
|                                                                                |
|  Excalidraw Canvas Area                                      Right Side Panel   |
|  +--------------------------------------------------------+  +----------------+ |
|  |                                                        |  | Annotation     | |
|  |     Excalidraw official toolbar and infinite canvas    |  | Current project| |
|  |                                                        |  | Target         | |
|  |     User draws, selects, zooms, pans here              |  | New comment    | |
|  |                                                        |  | Timeline       | |
|  +--------------------------------------------------------+  +----------------+ |
|                                                                                |
| [Settings: language]                                                            |
+--------------------------------------------------------------------------------+
```

页面分成四块：

- 顶部应用栏：品牌、当前路径、保存状态、导出、注释开关。
- Excalidraw 画布区域：官方 Excalidraw 组件渲染。
- 右侧注释面板：项目 session、注释目标、新评论、评论时间线。
- 左下设置入口：语言切换。

## 5. 可设计区域

设计 AI 可以重点设计这些区域。

### 5.1 App 外壳

可设计：

- 顶部 app bar 的信息层级。
- 品牌图标区域。
- 当前项目/scene path 的显示方式。
- 保存状态提示。
- 导出按钮和下拉菜单。
- 注释 icon 和评论数量 badge。
- Light/Dark mode 的整体壳层风格。

目标：

- 看起来像 Codex 内的专业工作台，而不是营销页面。
- 顶部栏不能抢 Excalidraw 画布注意力。
- 状态反馈要稳定，不要闪屏、跳动或占据过多空间。

### 5.2 右侧注释面板

这是最需要高保真设计的区域。

可设计：

- 面板宽度、边界、阴影、背景层级。
- 展开/收起状态。
- 拖拽调整宽度的 handle。
- 注释标题区。
- 当前 project 折叠区。
- 注释目标区域。
- 新评论输入区。
- 评论时间线。
- Open / Resolved 状态。
- “交给 Codex 执行”、“复制指令”、“关闭/Resolve”等操作。
- action 状态，例如 queued、running、completed、failed。
- 空状态、未选择元素状态、加载状态、错误状态。

目标：

- 让用户一眼知道“先选元素，再写评论，再交给 Codex”。
- 像 Codex 的 code comment，不像普通表单。
- 多条评论要用时间线样式组织，超过一定数量默认折叠。
- resolved 评论要弱化，但仍可追溯。
- open 评论要突出可执行性。

建议的信息架构：

```text
+------------------------------------+
| Annotation                    [<]  |
| 0 selected / 2 selected             |
+------------------------------------+
| Current project                     |
| $PROJECT_DIR                   v    |
+------------------------------------+
| Target                             |
| [ + ] Select canvas elements        |
| selected: rectangle, text, arrow    |
+------------------------------------+
| New comment                         |
| [textarea: describe requested edit] |
| [Add comment]                       |
+------------------------------------+
| Comments                       3    |
|  o OPEN      1 target      2m ago   |
|    去掉这个节点                     |
|    [Run with Codex] [Copy] [Close] |
|  o RESOLVED  2 targets     8m ago  |
|    删除这个节点                     |
|  [Show older comments]              |
+------------------------------------+
```

### 5.3 Project Switcher 区域

可设计：

- 当前项目路径展示。
- 最近项目下拉。
- 输入 project path。
- Open / Refresh 操作。
- 切换成功、失败、加载提示。

目标：

- 让用户知道当前画布属于哪个项目。
- 支持切换历史 project 和打开新 project。
- 不要把 project session 做成主导航，它只是注释面板里的上下文管理。

### 5.4 导出菜单

可设计：

- 顶部单个 Export 按钮。
- 下拉菜单的格式分组。
- 导出成功/失败反馈。

约束：

- 导出入口只放顶部，不要在右侧注释面板再做一个导出菜单。

### 5.5 设置入口

可设计：

- 左下角 Settings icon。
- 语言切换 UI。
- 后续可扩展 theme、density 等设置。

当前必须支持：

- 中文
- English

## 6. 不可设计或不能随意改动的区域

这些地方是硬边界，设计 AI 不要重新设计。

### 6.1 Excalidraw 画布本体

不要重做：

- Excalidraw 官方画布。
- Excalidraw 官方工具栏。
- 画布里的 selection handles。
- 画布内元素的编辑体验。
- 画布里的快捷键和默认交互。

可以做：

- 外部容器留白。
- 页面壳层与 Excalidraw 的视觉衔接。
- 注释面板开关对画布可用区域的影响。

不要把 Excalidraw 本体画成自定义白板 UI。画布区域应该明确保留官方 Excalidraw 体验。

### 6.2 结构化数据流

不要改变核心数据流：

```text
Codex Chat -> MCP tools -> Local API -> canvas/excalidraw files
Canvas UI -> Local API -> canvas/excalidraw files
```

不要设计成：

- 页面按钮直接理解评论文本并执行复杂修改。
- 用浏览器截图识别画布内容。
- 用鼠标自动点击 Excalidraw 工具栏完成核心任务。
- 把评论只画成画布内文本，没有结构化 JSON。

### 6.3 目标定位规则

AI 修改目标必须来自结构化对象：

- 当前 selection。
- explicit element IDs。
- comment ID。
- `targetElementIds`。
- `customData.codex.semanticId`。

不要设计依赖“文本里包含某个词就修改某个元素”的交互。评论文本可以作为 instruction，但不能在页面侧通过硬编码关键词判断意图。

### 6.4 图片能力边界

当前版本已去掉宿主顶部栏里的“示例”和自定义“图片”功能，但保留两类图片能力：

- Excalidraw 原生 image tool：用户手动插入本地图片。
- Codex `insert_excalidraw_image`：用户明确要求生成/插入 bitmap、photo、screenshot 时，由 Codex 通过结构化 target 插入。

不要设计：

- 图片上传入口。
- 图片生成入口。
- 素材库作为核心功能。
- image element 管理器。

设计重点是不要额外制造宿主级图片入口；图片能力是 Excalidraw 原生工具和 Codex 结构化执行能力的补充。

## 7. 关键组件清单

请为以下组件给出高保真设计。

### 7.1 Top Bar

状态：

- 正常
- 自动保存中
- 已自动保存
- 保存失败
- 导出菜单打开
- 注释面板打开/关闭

元素：

- App icon
- App title
- current scene/project path
- saved status pill
- Export dropdown
- Annotation icon with badge

### 7.2 Right Annotation Panel

状态：

- 展开
- 收起
- 调宽 hover/drag
- 无选区
- 有选区
- 无评论
- 有 open 评论
- 有 resolved 评论
- action queued/running/completed/failed

元素：

- Header
- Collapse button
- Project dropdown belongs to the top app bar, not this panel
- Target state
- Comment composer
- Timeline list
- Comment item
- Timeline collapse toggle
- Message/toast inline feedback

### 7.3 Project Dropdown

状态：

- 折叠
- 展开
- 正在切换 project
- 切换失败
- 最近项目为空
- 路径过长

元素：

- Current project label
- Recent projects select
- Project path input
- Open button
- Refresh button

### 7.4 Comment Item

状态：

- open
- resolved
- queued
- running
- completed
- failed

信息：

- status
- target count
- created/resolved time
- body
- action id when exists
- primary action
- secondary actions

### 7.5 Settings Popover

状态：

- closed
- open
- language zh
- language en

元素：

- Settings icon
- Language options

## 8. 视觉方向

关键词：

- Quiet productivity
- Local-first workspace
- Dense but organized
- Codex-native
- Hand-drawn canvas, structured side panel
- Professional, not playful
- Calm, not decorative

建议：

- 主背景使用浅色、低饱和、中性工作台背景。
- 右侧面板可以略微暖白，但不能变成卡片堆叠。
- 使用细边框和轻微分割线，不要大面积阴影。
- 按钮尽量使用 icon + 短文本。
- 注释的 primary action 可以更明显，但不要满屏蓝色。
- 评论时间线用很轻的线和节点，open 状态比 resolved 更醒目。
- 文案尽量短，避免教学式大段说明。

避免：

- 营销 landing page 风格。
- 过度圆角和泡泡风。
- 大面积渐变。
- 装饰性插图。
- 把右侧面板做成多个嵌套卡片。
- 用强色块抢画布注意力。
- 使用大量解释性文案描述功能。

## 9. 推荐设计 Token 方向

设计 AI 可以自由出高保真，但建议接近这些方向：

```text
palette = light_clean
accent = electric_blue 或 muted_sage
typography = system_ui / Inter
display = same_as_body
layout = app_shell + canvas + right_panel
mood = professional_minimal
density = compact_to_balanced
exclude = marketing_hero, decorative_gradients, stock_images, nested_cards
```

颜色角色建议：

- App background：中性浅色。
- Canvas shell：尽量不干扰 Excalidraw 本体。
- Right panel：比画布背景略有区分。
- Border/divider：低对比。
- Primary action：用于“交给 Codex 执行”或“添加评论”。
- Resolved：低对比灰。
- Open：正常对比或轻量强调。
- Error：清晰但克制。

## 10. 文案原则

中文界面主文案：

- 注释
- 当前项目
- 最近项目
- 注释目标
- 选择画布元素后开始注释
- 新评论
- 添加评论
- 评论
- 交给 Codex 执行
- 复制指令
- 关闭
- 已自动保存
- 正在保存
- 导出
- 设置

英文界面主文案：

- Annotations
- Current project
- Recent projects
- Annotation target
- Select canvas elements to start annotating
- New comment
- Add comment
- Comments
- Run with Codex
- Copy command
- Resolve
- Saved
- Saving
- Export
- Settings

文案要短，面板里不要出现长篇教程。交互引导要靠布局和状态表达。

## 11. 设计交付物要求

请输出至少这些高保真设计：

1. Desktop 默认态：右侧注释面板展开，无选区，有 3 条评论。
2. Desktop 有选区态：选中 2 个元素，comment composer 可用。
3. Desktop action 态：某条 open comment 已 queued/running，显示 action 状态。
4. Desktop resolved 多评论态：评论时间线超过 4 条，默认折叠旧评论。
5. Desktop 右侧面板收起态：画布区域扩展，顶部注释 icon 显示 badge。
6. Project dropdown 展开态：可切换最近项目或输入新 project path。
7. Export dropdown 打开态。
8. Settings popover 打开态，展示语言切换。
9. Narrow viewport：右侧面板如何覆盖或收起，不要挤坏 Excalidraw 工具栏。

每个设计需要说明：

- 信息层级为什么这样排。
- 哪些状态是 primary action。
- 哪些内容被弱化。
- 如何避免干扰 Excalidraw 本体。
- 如何保证后续接入现有 React 结构。

## 12. 设计 AI 可直接使用的 Prompt

```text
请为 Codex Excalidraw 生成一套高保真桌面 UI 方案。

项目背景：这是 Codex App 的本地 Excalidraw 白板插件。用户在 Excalidraw 画布中绘制、选择、评论，在 Codex 聊天中让 AI 生成图、修改选区、处理评论和导出。核心数据流是 MCP/API/files，不依赖浏览器自动点击。

设计目标：让界面像 Codex 内的专业本地工作台，安静、紧凑、信息清晰。重点设计右侧注释面板，让用户能自然完成“选择元素 -> 添加评论 -> 交给 Codex 执行 -> 查看 action/resolve 状态”的流程。

必须保留：Excalidraw 官方画布和工具栏本体，不要重做白板编辑器。不要设计独立图片生成入口、素材库、示例插入。不要把导出放进右侧面板，导出只在顶部 Export 下拉。不要依赖评论文本关键词在页面侧执行操作。

页面结构：顶部 app bar + Excalidraw canvas + 右侧 annotation panel + 左下 settings。顶部 app bar 包含当前项目下拉、保存状态、Export dropdown、Annotation icon with badge。右侧面板可收起、可拖宽，只包含 Annotation target、New comment、Comments timeline。Settings 支持中文/English。

视觉方向：quiet productivity, professional minimal, local-first workspace, compact but organized。避免营销页、装饰渐变、大面积阴影、嵌套卡片和解释性大段文案。

请输出 desktop 高保真设计，包括默认态、有选区态、action queued/running 态、多评论折叠态、面板收起态、Project dropdown 展开态、Export dropdown、Settings popover 和窄屏适配。
```

## 13. 设计边界总结

可以大胆设计：

- 外层 app shell。
- 顶部状态和操作栏。
- 右侧注释面板。
- 项目 session。
- 评论时间线。
- 导出菜单。
- 设置弹层。
- 各种状态反馈。

不能动：

- Excalidraw 官方画布本体。
- Excalidraw 官方工具栏交互。
- MCP/API/files 的结构化数据流。
- selection/comment/action 的目标定位规则。
- 当前不做的宿主级图片生成入口和素材库能力。

最重要的设计判断：

> 让用户觉得这是“Codex 正在理解和处理我的白板注释”，而不是“我在一个网页工具里点按钮触发自动化脚本”。
