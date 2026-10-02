# 缺陷排查报告（2026-10-02，基线 v2.54）

> **状态：3 项缺陷已全部修复并回归通过（v2.55）。**
> 复现与验证脚本：`_probe_persist.js`（D2/D3 复现）、`_probe_migrate.js`（D1 复现）、
> `_probe_v255.js`（修复后 11 条断言全绿）；E2E 守卫见 `_e2e.js` section 25。

排查方式：① 静态扫描（`_scan.py`：静默 catch / 裸写库 / 重复 id / 未定义调用 / fetch 超时 / 事件绑定覆盖）；
② 逐段代码走查（数据层、启动引导、多剧目、迁移、批量、导出、播放器）；
③ **实证探测**（假 localStorage + 假写入失败，对每条候选做可判定验证）。

基线门禁：`_e2e.js` 295 断言 / 0 失败、`_test_cue.js` 1032 / 0、`_test_ai51.js` 43 / 0
—— **下面这些缺陷全部是现有测试没覆盖到的路径**。

---

## 严重度说明
- **P0 丢数据**：用户会真实丢失内容，且界面上不报错或报错驴唇不对马嘴，刷新或切剧目后才发现。
- **P1 静默失效**：功能产出与预期不符，或提示缺失，用户无从判断发生了什么。

---

# P0 — 会真实丢数据

## D1　老用户升级时迁移失败「静默丢数据」，且永不重试

- **位置**：`ensureProjects()`（修复前 L9690–L9715）
- **背景**：v2.49 引入多剧目命名空间后，首跑要把旧的全局 key
  （`wb_novel2drama_shots` / `chs` / `novel` / `cfg` / `assets` / `aud_*` / `cuedur_*` / `undo` / `redo`）
  迁到默认剧目命名空间 `wb_novel2drama_prj_default:*`。
- **根因**：迁移写入全部是 `try{ localStorage.setItem(...) }catch(e){}` —— **静默吞**。
  而函数尾部**无条件**执行 `state.projects = [def]; saveProjects();`
  （`saveProjects` 走 `lsSet`，会腾挪，所以**大概率写成功**）。
- **复现**（`_probe_migrate.js`）：旧数据存在 + `setItem` 必抛（模拟配额满 / 隐私模式）：
  ```
  setItem 尝试写入的 key: ["...prj_default:shots","...prj_default:novel","...prj_default:cfg",
                           "...projects","...lastpid"]
  迁移后命名空间里的 key : []
  旧 key 是否还在        : 在（数据没丢但读不到）
  state.pid              : prj_default
  state.projects         : [{"id":"prj_default", ...}]
  ```
- **影响链**：
  1. 迁移写失败 → 数据仍在旧 key 下，但 `state.pid` 已切到 `prj_default`、
     `loadShots()` 读 `pk('shots')` → **读到空** → 用户看到「分镜 / 正文全没了」；
  2. 唯一的提示是「剧目列表保存失败（存储已满）：本次改动刷新后不保留」——**与真实后果完全对不上**；
  3. `projects` 已落盘 → **下次启动 `ensureProjects` 走 `if(Array.isArray(raw) && raw.length){...return}` 早退**
     → **迁移永不再执行 ＝ 数据永久丢失**（除非用户手动改 localStorage）。
- **修复**：迁移逐项走 `lsSet`；新增 `migFail` 标记；`migFail` 为真时**不写 `projects`、不切 `pid`**
  （保持未迁移状态）并明确提示，下次启动**重新尝试迁移**。
- **复验**（`_probe_v255.js`）：
  ```
  ✓ pid 未被切到默认剧目（保持未迁移）
  ✓ 未写入 projects 列表
  ✓ 给出迁移失败提示
  ✓ 旧数据仍在（未丢）
  ✓ 对照：迁移成功时 pid 照切、数据已迁、projects 已落盘（行为不变）
  ```

---

# P1 — 静默失效

## D2　`saveCfg()` 裸写 + 静默 catch：存储满时所有设置静默丢失

- **位置**：`saveCfg()`（修复前 L1570）
- **根因**：`try{ localStorage.setItem(pk('cfg'), JSON.stringify(cfg)); }catch(e){}`。
  全项目 **~40 个调用点**依赖它：API Key、提示词前缀、筛选视图、风格套餐、类型套餐、
  镜号预设、导出范围 / 选项、用量统计清零…
- **复现**（`_probe_persist.js` 场景 1）：
  ```
  toast 提示数        : 0 （无提示 = 静默失败）
  尝试的 lsFreeAud 删除: 0 （0 = 没有腾挪尝试）
  ```
- **影响**：存储写满后，用户改的设置**刷新即回默认**，界面全程无提示 → 用户完全无从判断。
- **修复**：改走 `lsSet(pk('cfg'), …, { warn:true, msg:'设置保存失败…' })`。

## D3　`localSave()` 写失败不做配额腾挪：可再生配音挤掉不可替代的分镜

- **位置**：`localSave(list)`（修复前 L1919）
- **根因**：`catch(e){ toast('本地存储写入失败…'); }` —— 有提示，但**不腾挪**。
  而本项目的设计前提是「配音缓存可再生、分镜不可替代」（见 `lsFreeAud` 注释），
  `lsSet` 已经实现了「先删最老配音缓存再重试」，唯独**分镜的兜底路径没接上**。
- **复现**（`_probe_persist.js` 场景 2）：`removeLog = 0`（未尝试腾挪）；
  对照场景 3 `lsSet` 同样条件下删掉 3 条 `aud_*`。
- **影响**：配音把空间占满时，分镜（不可替代）反而写不进去 —— **优先级刚好反了**。
- **修复**：改走 `lsSet(pk('shots'), …)`，与其它写入同一口径。

---

# 本轮排查中的「疑似但已排除」

| 候选 | 结论 | 依据 |
|---|---|---|
| `parseCues` 单行长旁白不自动拆句 | **非 bug** | 29 字单句仅一个句末句号 → 拆不开（拆了会剩一条只有 `。`）；38 字真·多句 → 正确拆 3 条。阈值 `>22` 是设计契约。 |
| `data-act="projclose/projmgr/projnew/serialstop"` 无处理器 | **误报** | 四个都在 `bind()` 的 `switch(act)` 里（L9186–9192），扫描器正则漏配。 |
| 5 处裸 `localStorage.getItem` | **误报** | 均被**前一行**的 `try{` 包裹，扫描器按行匹配导致漏判。 |
| `apiFetch` 内 L3182 的 `fetch` 无超时 | **非 bug** | 那是 `AbortController` 不可用时的**降级分支**。 |
| `ensureProjects` 迁移 `pk()` 的 pid 时序 | **非 bug** | 启动顺序为 `ensureProjects()` → `loadCfg()`（L9814–9815），pid 先定后读，正确。 |

---

# 修复结果（v2.55）

| # | 缺陷 | 修复方式 | 守卫 |
|---|---|---|---|
| D1 | 迁移失败静默丢数据 + 永不重试 | 迁移走 `lsSet` + `migFail` 不落盘不切 pid | `_probe_v255.js` D1 组 5 条 + E2E 25 组 |
| D2 | `saveCfg` 静默失败 | 走 `lsSet({warn:true})` | `_probe_v255.js` D2 组 2 条 + E2E 25 组 |
| D3 | `localSave` 不腾挪 | 走 `lsSet` | `_probe_v255.js` D3 组 2 条 + E2E 25 组 |

**回归结果**：
- `_e2e.js`：**301 通过 / 0 失败**（v2.54 基线 295，新增 section 25 共 6 条）
- `_test_cue.js`：**1032 / 0**
- `_test_ai51.js`：**43 / 0**
- `_probe_v255.js`：**11 / 0**

---
---

# 附录：上一轮排查报告（2026-09-17，基线 v2.52 → v2.53）

# 缺陷排查报告（2026-09-17，基线 v2.52）

> **状态：9 项缺陷已全部修复并回归通过（v2.53），详见文末「修复结果」。**
> 复现与验证脚本：`_probe_bugs.js`（修复前 9 项全复现，修复后 0 项复现）。

排查方式：① 静态扫描（自定义 `_scan.py`：静默 catch / 裸写库 / 重复 id / 未定义调用 / fetch 超时 /
事件绑定覆盖率）；② 逐段代码走查（数据层、并发批量、撤销栈、多剧目、流水线、导入导出、字幕与剪映导出）；
③ **实证探测**（`_probe_bugs.js`：无头 Chromium + 内存假云库 + 假 AI，对每条候选缺陷做可判定验证）。

基线门禁：`_e2e.js` 276 断言 / 0 失败 —— **下面这些缺陷全部是现有测试没覆盖到的路径**。

---

## 严重度说明
- **P0 丢数据**：用户会真实丢失内容，且界面上不报错，刷新或切换后才发现。
- **P1 功能失效/误导**：功能产出与预期不符，或把用户引向错误结论。
- **P2 健壮性/兼容**：在老数据、资源受限等特定条件下才暴露。

---

# P0 — 会真实丢数据

## B1　导入的备份在非默认剧目下「导入成功但一条都看不到」
- **位置**：`runImport()` 的 `build(it)` / `buildAsset(it)`（L8870-8895），云端分支 `p.addRecord(...toProps(build(it)))`（L8915 / L8921）
- **根因**：v2.49 引入多剧目后，所有写库路径都要带 `pid: state.pid`，但**导入路径漏了**。
  `build()` 逐字段重建对象，不包含 `pid`；`toProps()` 也不会补。新记录写入云端后没有 pid，
  `loadShots()` 里的 `pidOk()` 判定 `!r.pid && state.pid === 'prj_default'` 只在默认剧目成立。
- **复现**：切到任意新建剧目 → 导入 JSON 备份（2 镜）→ 提示「导入完成，共 2 个分镜」→ 列表为空。
- **实证**：`[BUG] B1 … 切到非默认剧目 prj_mu4c4m71ump 后导入 2 镜，loadShots 只看到 0 镜`
- **影响**：数据其实写进了云端，但当前剧目永远读不到；用户以为导入失败而重复导入 → 云端堆积重复记录。

## B2　撤销 / 重做恢复的镜头丢失 pid，撤销后镜头直接消失
- **位置**：`restoreSnap()` 的 `p.addRecord({ properties: toProps(x) })`（L6489）
- **根因**：与 B1 同源。快照对象 `x` 若有 pid 尚可，但 v2.49 之前的旧快照、
  以及经由导入/复制产生的无 pid 记录，恢复后写入的新记录没有 pid → 立刻被 `pidOk` 过滤。
- **复现**：非默认剧目下造 2 镜 → `pushUndo()` → 删掉 1 镜 → 撤销 → 该镜不回来。
- **实证**：`[BUG] B2 撤销恢复的镜头应带当前剧目 pid … pid=MISSING，当前剧目 pid=prj_…`
- **影响**：比 B1 更严重——撤销是「后悔药」，点了反而丢数据，且用户不会怀疑撤销本身。

## B3　章节与 AI 剧本化结果写入失败时静默吞掉
- **位置**：`saveChapters()`（L7967-7974）`try{…}catch(e){}`
- **根因**：`adapted`（AI 剧本化产出，每章数千字）全量持久化，几十章极易撑爆 localStorage 5MB 配额；
  写失败被空 catch 吞掉，界面照常显示章节状态。
- **复现**：造 300KB 章节数据 → 让 `setItem` 抛 QuotaExceeded → 调 `saveChapters()` → 无提示。
- **实证**：`[BUG] B3 … 写入失败后 toast 仍是上一条无关提示`
- **影响**：刷新后所有章节的完成状态、勾选、以及**花钱跑出来的 AI 剧本**全部消失，用户无从得知。

## B4　（系统性）本机存储写失败普遍静默，配额一满全线崩
- **位置**：`pk('assets')` 共 7 处（L2149/2161/2173/2350/2413/8726/8900）、
  `saveProjects()`（L9591）、`batchSaveAll()`（L1659）、`saveSnaps()`（L6329）、`cueDurSave()`（L4254）
- **根因**：应用把每镜配音以 base64 存进 localStorage（单条可达数百 KB），
  配额一旦写满，**后续所有 key 的写入全部失败**——包括分镜兜底、配置、剧目列表、续跑存档、撤销栈。
  这些点全是空 catch，失败无声。已经修好的 `localSave()` / `audSave()` 会提示，其余不会。
- **影响**：这是 B3 的放大版。用户表现为「操作都正常，刷新后什么都没了」。

---

# P1 — 功能失效 / 误导

## B5　字幕导出的「按逐句 cue 拆分」提示永远不会出现
- **位置**：`exportSrt()`（L4988）`(r.cueTotal > r.n ? '（按逐句 cue 拆分）' : '')`
- **根因**：`n` 是字幕总条数，`cueTotal` 只是「被拆分出来的那部分」条数，恒有 `cueTotal <= n`。
  条件写反，该提示是死代码。
- **实证**：`[BUG] B4 … cueTotal=2 n=3，但 toast="字幕已导出，共 3 条"`
- **影响**：提示缺失，用户不知道字幕已按逐句切分（这本来是个卖点）。

## B6　配音 / 口型失败时不显示失败原因
- **位置**：`renderShotTable()`（L2660）
  `var err = (s['错误信息'] && (is === '失败' || vs === '失败')) ? …`
- **根因**：只判断了图片/视频两类失败；v2.38 已把失败口径扩到配音、口型（`failKindOf` / `FAIL_KINDS`），
  渲染层没跟上。
- **实证**：`[BUG] B5 … 镜同时「配音失败 + 口型失败」且错误信息非空，但分镜卡里没渲染错误信息`
- **影响**：配音/口型失败后用户看不到「TTS 401 未授权」这类原因，只能盲目重试、反复花钱。

## B7　切换 / 新建剧目后残留上一剧目的失败清单与筛选条件
- **位置**：`switchProject()`（L9650）、`createProject()`（L9633）均未重置 `state.bulkFail` / `state.filter` / `cfg.filterExpr`
- **实证**：`[BUG] B6 … 切剧目前 bulkFail=1 filter=fail expr=1-3；切后 bulkFail=1 filter=fail expr=1-3`
- **影响**：带着「只看失败」的筛选进入空的新剧目 → 列表空白 → 用户第一反应是「数据丢了」。

## B8　切换 / 新建剧目后残留指向旧镜头的浮层 id
- **位置**：同上，`cbShotId`（候选图面板）/ `cueShotId`（字幕编辑）/ `pmShotId`（提示词覆盖）未清空，浮层也未关闭
- **实证**：`[BUG] B7 … 切剧目后 cbShotId=ghostcb cueShotId=ghostcue pmShotId=ghostpm`
- **影响**：若浮层正开着，切换后编辑/保存会写到新剧目里根本不存在的镜 id 上。

## B9　导入失败只说「导入失败」，不带原因
- **位置**：`runImport()` 收尾 `.catch(function(e){ console.error(e); toast('导入失败'); })`（L8941）
- **影响**：导入是最容易出问题的路径（文件编码、字段缺失、云端写入失败），用户拿不到任何可自查线索。

---

# P2 — 健壮性 / 兼容

## B10　旧版（v2.49 前）数据迁移不完整
- **位置**：`ensureProjects()`（L9606）只迁移 `['shots','chs','novel','cfg','assets']`
- **缺失**：`aud_*`（配音缓存）、`cuedur_*`（逐句时长账本）、`undo`、`redo` 仍留在旧全局 key
  （`wb_novel2drama_aud_xxx`），而读取走的是 `pk('aud_'+id)` → 读不到。
- **实证**：`[BUG] B8`
- **影响**：老用户升级后，配音缓存与撤销栈「看起来没了」（数据还在，只是读不到）；
  逐句时长账本丢失会让字幕回退到按字数估算，与口型对不齐。

## B11　配音存储写满时不主动腾空间
- **位置**：`audSave()`（L4235）失败仅 toast，不清理
- **影响**：一旦配额满，之后每条配音都存不下，且不会自动恢复；必须用户手工删分镜。

---

# 未复现 / 经核为设计如此（不作为缺陷）
- `runPool` 并发取任务下标 `i` 的共享访问：所有取用都在微任务阶段串行发生，无竞态。
- `runPool` 暂停用 `setInterval` 轮询：停止/恢复路径均有 `clearInterval`，未发现泄漏。
- `viewShots('fail')` 的硬编码四类判定：与 `FAIL_KINDS` 口径一致（但 B6 的渲染层漏了两类）。
- 288 个 DOM id 无重复；`getElementById` / `$('#…')` 目标全部存在；75 个 `data-act` 均有处理器。
- `innerHTML` 拼接中的用户数据均经 `esc()` 转义，未发现 XSS 注入点。

---

# 修复计划

| # | 对应缺陷 | 修复动作 | 级别 |
|---|---|---|---|
| F1 | B1 | `runImport` 的 `build`/`buildAsset` 补 `pid: state.pid`（含无云分支） | P0 |
| F2 | B2 | `restoreSnap` 的 `addRecord` 改为 `Object.assign({pid: state.pid}, x)` | P0 |
| F3 | B3 | `saveChapters` 走 `lsSet`；超限时降级：先丢 `adapted` 保住章节状态，仍失败则明确提示 | P0 |
| F4 | B4 | 新增 `lsSet` 统一收口 + **配额腾挪**：写入失败先清理最老的音频缓存再重试；所有静默写改走它 | P0 |
| F5 | B5 | `exportSrt` 提示条件改为 `cueTotal > 0` | P1 |
| F6 | B6 | 错误信息展示改用 `failKindOf` 口径（四类失败都显示） | P1 |
| F7 | B7 | 切/建剧目时重置 `bulkFail`、`filter`、`filterExpr` | P1 |
| F8 | B8 | 切/建剧目时清空 `cbShotId`/`cueShotId`/`pmShotId` 并关闭对应浮层 | P1 |
| F9 | B9 | `runImport` 失败提示带上 `e.message` | P1 |
| F10 | B10 | `ensureProjects` 迁移补齐 `aud_*`/`cuedur_*`/`undo`/`redo` | P2 |
| F11 | B11 | `audSave` 失败时自动清理最老的若干条音频缓存后重试一次 | P2 |

补充：为 F1/F2/F3/F4/F7/F8 新增回归断言（`_e2e.js` 第 24 节），确保不复发。


---

# 修复结果（v2.53）

| 编号 | 修复动作 | 验证 |
|---|---|---|
| B1 | `runImport` 的分镜 / 设定卡构建器补 `pid: state.pid`（含无云分支） | 探测 + E2E §24-A |
| B2 | `restoreSnap` 写回云端改为 `Object.assign({ pid: state.pid }, x)` | 探测 + E2E §24-B |
| B3 | `saveChapters` 分两级降级（完整 → 丢 `adapted` 保进度 → 明确提示），每轮只提示一次 | 探测 + E2E §24-C |
| B4 | 新增 `lsSaveAssets()` 收口 7 处设定卡写入；`lsSet()` 增加**配额腾挪**（写入失败先清较早配音缓存再试）；`saveProjects` / `batchSaveAll` / `saveSnaps` / `cueDurSave` 不再静默 | 探测 + E2E §24-D |
| B5 | `exportSrt` 提示条件 `cueTotal > n` → `cueTotal > 0` | 探测 + E2E §24-E |
| B6 | 错误信息展示改用 `failKindOf`（四类失败都显示） | 探测 + E2E §24-F |
| B7 | 切 / 建剧目重置 `bulkFail`、`filter`、`filterExpr` | 探测 + E2E §24-G |
| B8 | 切 / 建剧目清空 `cbShotId`/`cueShotId`/`pmShotId` 并关闭对应浮层（新增 `resetProjUiState()`） | 探测 + E2E §24-G |
| B9 | `runImport` 失败提示带 `e.message` | E2E §24-H |
| B10 | `ensureProjects` 按前缀迁移 `aud_*` / `cuedur_*` / `undo` / `redo` | 探测 |
| B11 | `audSave` 改走 `lsSet`，写满自动腾挪 | E2E §24-D |

## 附带修好的门禁问题

排查时发现 `_test_cue.js` **基线其实是「1 处崩溃 + 5 处失败」**（不是绿）——
由于它在中途崩溃，后面的断言根本跑不到，长期无人察觉，等于门禁失效。
根因是三次重构后旧断言没跟上：

- v2.45 `bulkPatch` 改为返回 Promise → 4 处「返回镜数」断言还在按同步取值；
- v2.49 撤销 key 加入剧目命名空间（`pk('undo')`）→ 断言里硬编码的 `ntds_undo` 失效；
- v2.45 `moveShot` / `dupShot` / `insertShotAfter` 改走 `bulkPatch` → v2.33 那组「失败就取消操作」的断言
  与当前「内存保持一致、失败项进重试清单」的设计相悖。

现已全部更新到当前真实行为：**1032 通过 / 0 失败**。

## 回归结果

- `_probe_bugs.js`：修复前 9 项全复现 → 修复后 **0 项复现**。
- `_test_cue.js`：**1032 通过 / 0 失败**（基线为崩溃 + 5 失败）。
- `_test_ai51.js`：39 通过 / 0 失败。
- `_e2e.js`：新增 section 24（19 条）+ 原有 276 条，全量零回归。
