# EC / NUCtool.dll 控制需求基线（草案）

- 状态：核心控制模型已按用户补充确认；代码已拆分 EC 风扇、DLL profile、基准请求和 DLL 厂商计划入口。基准关闭只清除标记、保留计划 4 已由用户确认；硬件行为仍待目标设备验收。本文件仍是需求草案，不是硬件验收报告。
- 日期：2026-09-26。
- 依据：用户在当前项目中明确提出的使用目标与控制归属、当前工作区代码静态核对、已打包 NUCtool.dll 的导出表。
- 研究边界：没有进行外部用户访谈、产品分析数据统计或真实设备逐项实测。所有未由用户明确指定、也未被代码证实的结论均标记为“假设”或“待确认”。

## 一句话目标

把设备性能模式直接呈现为 NUCtool.dll 的省电、平衡、性能三档；风扇转速独立由 EC 控制；基准模式是独立的 DLL 开关/计划。这里移除“影视/游戏”作为性能档名称，不影响显示视觉模式中的影视/游戏/阅读选项。每项设置都要让用户看懂控制方与实际状态，避免 EC、NUCtool.dll、Windows 电源管理和旧厂商 SDK 互相覆盖。

## 问题陈述

用户需要区分 EC 风扇、NUCtool.dll 性能档、DLL 厂商计划、Windows 电源计划和 TDP；此前 UI 使用“影视/游戏”场景名把这些控制混在一起。用户已明确：性能直接选择 DLL 的省电/平衡/性能；EC 只负责风扇；基准是单独的 DLL 开关/计划，不触发 EC。首轮代码核对发现风扇场景联动和 DLL/Windows 计划混称；目前 UI 与可调用命令已拆分，旧 `apply_system_power_profile` 复合入口和 EC TDP 写入口已从 Tauri 命令注册表撤下。底层实现暂保留作兼容与后续评估，但用户界面不能调用；此轮没有目标设备回读验证。

因此核心问题不是单纯缺少控制项，而是**控制归属、联动范围和成功状态没有形成统一、可解释的产品契约**。

## 用户与场景（工作假设）

- 主要用户：NUC 设备拥有者，希望直接选择省电、平衡或性能档，并独立调节 EC 风扇。
- 次要用户：需要单独调试性能预设、Windows 电源计划、基准模式、充电上限或灯光的高级用户。
- 以上是根据当前用户需求形成的工作假设，不代表访谈验证出的用户画像。

## 产品原则与控制归属

| 功能/参数 | 当前代码实际通道 | 需求基线/用户意图 | 状态与差异 |
|---|---|---|---|
| 风扇转速、曲线、接管 | EC/WMI；写入后可读风扇传感器 | EC 独立控制风扇风速 | 用户已明确；当前 UI 场景已改为静音/均衡/散热优先 EC 曲线，不再联动 DLL。旧 Gaming/Performance/Benchmark 配置会迁移成 Custom；实机曲线效果仍需验证。 |
| CPU/GPU PL1、PL2、TCC | EC/WMI；当前 UI 只读，旧 `set_tdp` 不再注册为前端命令 | 常规性能模式直接由 DLL profile 控制 | 选 DLL profile 时不隐式写 EC TDP。DLL profile 不代表精确瓦数或实时功耗；未来若恢复 EC TDP 写入，须作为独立高级控制项审查。 |
| 厂商性能预设 | NUCtool.dll `wcf_apply_profile` | 直接提供省电、平衡、性能三档 | 当前索引映射为 3/2/1；wrapper 写入后读取当前 profile，索引一致才报告已验证。切换 profile 会请求关闭 benchmark flag，但不修改 vendor plan；benchmark flag 本身无回读。 |
| DLL 基准模式 | NUCtool.dll `wcf_apply_benchmark_mode`；启用另请求 `wcf_set_power_plan(4)` | 独立 DLL 开关/计划，不调用 EC | UI/命令已改成独立 DLL-only 开关。关闭时仅清除 flag，按用户确认计划 4 保留；无回读，所以只显示最近请求。 |
| 厂商电源计划 | NUCtool.dll `wcf_set_power_plan`，索引 0–4 | 高级项，与性能档分开解释 | UI 已改称“NUCtool 厂商计划”，与 Windows `powercfg` 分区；当前没有回读，只显示最近请求。 |
| Windows 电源方案/处理器偏好 | Windows `powercfg`；当前 UI 只读 | 可单独管理，但不能与 DLL 档位混称或暗中联动 | 旧 `apply_system_power_profile` 的跨子系统路径已从 Tauri 命令注册表撤下，前端自动调度及复合功耗写入也已移除；底层实现仍待单独清理。 |
| 充电上限 | NUCtool.dll；写入范围 50–100，可回读阈值 | 显示真实充电上限 | 控制及回读已接通；应确保 UI 展示的是回读值而不只是上次请求值。 |
| 键盘背光开关/亮度 | NUCtool.dll；开关可回读，亮度无已验证回读 | 开关和基础亮度 | 符合已提出的基础控制范围。亮度只能标记为请求值，不能冒充实际读回。 |
| 键盘固定颜色 / 光条单色与呼吸 | 官方 Uniwill SDK；按键盘和光条分别写入并读回 | 有可靠接口的 Studio 控件可操作 | 本机服务报告 `KeyboardLedIndividualKeyControl`、`LightbarSingleColor`；键盘与光条分开写，避免一次操作覆盖两个设备。Aurora 未接入。 |
| 系统键开关 / OSD / WhisperMode / 最佳电池健康 | 官方 Uniwill SDK | 与 DLL 控制分开标明来源 | WinKey、FnKey、NumPad、触控板快捷键、WhisperMode、BestBattery 可由服务读回；OSD 无状态读回，仅显示最近请求。 |
| 显示视觉模式（标准/游戏/影视/阅读） | NUCtool.dll 桥接；不再自动回退 Uniwill SDK | 影视、阅读等场景可用；不得和刷新率混成一个功能 | DLL 路径没有可靠回读；仅展示“请求已发送”。DLL 文件校验与原厂服务接口读回单独呈现。 |
| 自定义画质参数 | 官方 Uniwill SDK `GetSavedDisplayModes`/`UpdateDisplayMode`/`SetDisplayMode` | 可调整插电/电池亮度、色温、对比度及 RGB | 已接入自定义配置读写；保存参数可从服务读回。当前实际启用模式仍无可靠回读，因此启用仅报告请求状态。 |
| 显示刷新率 | Windows 显示 API | 独立显示设置 | 与色彩/厂商视觉模式是不同参数。 |
| 旧组合灯光命令 | Uniwill SDK / PowerShell 底层代码仍在 | 避免误改多个子系统 | 旧 `apply_vendor_lighting` 仍未注册；当前界面使用键盘颜色、光条颜色的独立命令。 |
| 操作日志/诊断 | UI 有监控/诊断事件；后端也有诊断记录 | 用户此前提出日志记录可以取消 | 需区分“移除用户可见操作历史”和“关闭内部故障诊断/安全事件记录”，避免误删排障与风扇安全所需信息。 |

## 推荐范围

### Must：下一轮功能实现前先达成一致

1. **控制所有权可见且唯一**：控件旁标注 EC、NUCtool.dll、Windows 或厂商 SDK；同一参数不得出现隐式双写。
2. **性能模式直连 DLL 三档**：省电（索引 3）、平衡（索引 2）、性能（索引 1）；不再用影视/游戏场景名替代，切换时不写 EC。（代码路径已改，待实机验证。）
3. **风扇与性能解耦**：风扇页面/控制项只由 EC 调速；选择任一 DLL 性能档不得更改风扇曲线/转速。（前端路径已拆分，旧 EC 配置已迁移。）
4. **基准模式 DLL-only**：单独 DLL 开关；启用时请求 benchmark flag 和 vendor plan 4，不调用 EC；关闭只清 flag、计划 4 保留。没有回读时只显示请求状态。（代码已改，待实机验证。）
5. **拆开三类“电源”**：DLL profile、DLL vendor power plan、Windows `powercfg` scheme 独立命名、独立读写。审查并避免旧 `apply_system_power_profile` 的跨子系统副作用。

### Should：核心边界明确后补齐

- 基准模式作为独立的 DLL 功能；保留显式的启用/停止状态说明。当前没有 benchmark 状态回读，不能显示“已确认开启”。
- 充电上限、键盘灯开关、厂商性能档显示实际回读；键盘亮度注明“最近请求值”，直至出现可靠回读。
- 对每个可选硬件能力单独确认后再展示；`supported_features_count > 0` 不能证明特定灯条或 Aurora 功能支持。
- 把 DLL 视觉模式与 Windows 刷新率场景分区展示，并标注 DLL 的视觉模式缺少回读。

### Could / 暂不纳入核心场景

- RGB 颜色、灯条、Aurora、OSD、GPU 温度目标、厂商 Whisper、自动检测游戏等高级能力；先验证 DLL ABI/设备能力，或明确批准旧 SDK 路径。
- 删除用户可见操作历史。内部诊断与安全记录保留策略需另行决定。

## 优先级方法

建议当前用 **MoSCoW + 影响/证据置信度/工程量（高/中/低）** 排序，而不是给 RICE 编造 Reach 或用户量。当前可用证据是一个主要用户的明确反馈和静态代码路径，没有使用分析、客户样本或团队工时数据；外部优先级技能也明确把数据可用性作为框架选择条件。待有设备使用量和验收样本后，再考虑量化评分。

| 顺序 | 需求 | 用户影响 | 证据置信度 | 工作量估计 | 为什么先做 |
|---|---|---|---|---|---|
| M1 | 确认控制所有权、拆开旧复合电源路径、准确报告部分失败 | 高 | 高（代码已核对、用户明确困惑） | 中 | 避免误控制和虚假成功，是后续功能的安全基础。 |
| M2 | 直接选择 DLL 省电/平衡/性能档；性能档与 EC 风扇解耦 | 高 | 高（用户已明确；当前命名/联动不符） | 中 | 让控制名称和实际执行方一致。 |
| M3 | 基准切为独立 DLL 开关与 vendor plan 4，不触发 EC | 高 | 高（用户已明确；当前实现仍写 EC） | 小至中 | 消除基准对 EC 的隐式控制，并明确缺少回读。 |
| S1 | 性能档/充电上限/键盘开关实际状态展示 | 中高 | 高（DLL 已有回读） | 小至中 | 复用已接通的读取接口，降低“看不出变化”的困惑。 |
| S2 | DLL vendor plan 与 Windows 计划分离 | 中高 | 高（代码事实） | 中 | 防止产品命名继续混淆。 |
| S3 | 基准、视觉模式能力与请求状态 | 中 | 中（部分接口无回读/仅名称推断） | 中至大 | 需要实机确认和能力探测设计。 |
| C1 | RGB/Aurora/Whisper 等历史入口清理 | 中低 | 中低 | 中至大 | 先决定支持边界，避免为未验证接口增加风险。 |
| C2 | 用户可见日志精简 | 低至中 | 中 | 小 | 先区分 UI 历史与必要内部诊断。 |

## 用户故事与验收标准

### US-01：直接选择 DLL 性能档

作为 NUC 用户，我希望直接选择设备的省电、平衡或性能档，以使用 DLL 原生提供的性能模式，而不被影视/游戏场景名称代替。

- Given DLL 可用，When 选择“省电”，Then NUCtool.dll 请求 profile index 3；回读到 3 才显示已确认。
- Given DLL 可用，When 选择“平衡”或“性能”，Then 分别请求 profile index 2 或 1，并按 profile 回读显示结果。
- When 用户切换任一性能档，Then 不调用 EC 风扇/曲线/TDP 写入，也不暗中切换 Windows `powercfg` scheme。
- When 用户从基准状态切回普通性能档，Then 明确显示 DLL benchmark flag 已被清除；若 vendor plan 仍为 4，应如实显示并按待决恢复规则处理。
- Given DLL 操作未确认或回读失败，Then 显示“请求已发送/无法读取”，不得仅凭所选按钮显示为硬件当前档位。

### US-02：独立 EC 风扇控制

作为 NUC 用户，我希望风扇控制独立工作，由 EC 调整风速，不被性能档切换或基准模式覆盖。

- When 用户调整风扇风速/曲线，Then 操作由 EC 执行，且不修改 DLL profile 或 vendor plan。
- When 用户选择 DLL 性能档，Then EC 风扇设定保持不变。
- When 用户启用 DLL 基准模式，Then 不向 EC 发送风扇、曲线或 TDP 命令。

### US-03：独立基准模式

作为高级用户，我希望单独开关 DLL 基准模式，按作者 DLL 逻辑启用基准 flag 和 vendor plan，而不把它当作 EC 风扇模式。

- When 用户开启基准，Then 仅调用 DLL benchmark flag=1 和 vendor plan index 4；不调用 EC。
- When 用户关闭基准，Then 关闭 DLL benchmark flag；plan/profile 的恢复规则必须明示，不能静默写 EC。当前 DLL profile-only wrapper 会清除 benchmark flag、设置所选 profile，但保留 vendor plan 4，因此需要明确是否同时恢复进入基准前的 plan。
- Then 无 benchmark 状态回读时展示“已发送的请求”，不显示“硬件已确认开启”。
- Then DLL vendor plan 4 与 Windows 电源方案分开命名。

### US-04：区分性能档、厂商计划、Windows 计划和 TDP

作为用户，我希望知道每项电源设置具体会改什么，避免一次选择改动意料之外的系统状态。

- Given 用户打开任一控制项，Then UI 明确显示控制器和影响范围：DLL profile、DLL vendor plan、Windows `powercfg` scheme 或 EC TDP。
- When 修改 DLL profile，Then 不得同时修改 Windows 计划、EC 风扇或 EC TDP，除非产品明确将该联动列入验收范围。
- When 修改 Windows 方案，Then 列出本操作实际涉及的子项；不能继续用一个模糊的“系统电源模式”隐藏刷新率、厂商档位或 GPU 时钟变化。

### US-05：查看硬件实际状态

作为用户，我希望能分辨真实回读和最近一次操作请求。

- Given DLL 提供某字段回读，When页面刷新或应用设置后，Then 电量阈值、键盘开关、性能索引显示硬件回读值。
- Given 字段没有回读，Then 显示“最近请求”或“无法读取”，不得显示为“当前硬件状态”。键盘亮度、benchmark 和 vendor power plan 属于当前缺少已验证回读的字段。
- Given 可选功能只有总数探测，Then 不单凭总数显示特定灯条/Aurora“支持”。

### US-06：区分视觉模式和刷新率

作为用户，我希望选择影视、阅读等屏幕预设时知道它改变了色彩模式还是刷新率。

- Then 厂商视觉模式（Standard/Gaming/Video/Reading）与 Windows 刷新率设置使用不同区域、不同状态标签。
- Then DLL 视觉模式无可靠回读时显示“请求已发送”；Windows 刷新率按其独立读取结果展示。
- **待决**：NUCtool.dll 不可用时是否允许回退到旧 Uniwill SDK；默认建议先不做静默 fallback。

### US-07：精简日志可见性

作为普通用户，我希望界面不被操作日志占据，但设备故障仍可排查。

- Then 移除/隐藏用户可见的冗余操作历史（范围需确认）。
- Then 不在没有评估的情况下关闭 EC 超温、安全失败和故障诊断记录。

## 成功标准

- 100% 核心控制项标注唯一控制器与实际影响；无“DLL/EC/Windows”混称。
- 省电/平衡/性能可分别验证为 DLL profile 3/2/1；选档不改变 EC 风扇。
- 基准启停仅影响 DLL benchmark/计划接口，不触发 EC 写入。
- 任何“已应用/当前状态”文案都能追溯到成功返回码或实际回读；无回读字段明确标注为请求状态。
- 用户在一次选择后能解释哪些值改变、哪些没有改变；验证方式需在可用性检查中补充，不假设已有分析埋点。

## 约束、风险与非目标

- Windows 及支持的 NUC 型号是当前 DLL/WMI 控制的适用范围；必须用目标设备实测。
- NUCtool.dll 未提供其全部导出函数的公开实现/ABI说明；名字存在不等于可安全调用。
- 不把风扇控制迁移到 DLL；不把 DLL profile 当作确切 TDP/实际功耗读数。
- 本草案不要求增加自动游戏识别、计划任务、Aurora、OSD 或新增 RGB 动画。
- 本轮只做需求整理与项目 Skill；没有修改应用代码、界面或打包产物。

## 待确认决策（建议按顺序）

1. 已确认：关闭基准仅清除 benchmark flag，vendor plan 4 保留；由于 DLL 没有 benchmark/plan 回读，UI 不声称计划/档位已恢复。
2. 平衡档、性能档与省电档的 profile 索引按 3/2/1 展示；上线前在目标设备实测效果和回读，确认实际硬件行为与标签一致。
3. DLL vendor power plan 是否保留在高级区？应命名为“NUCtool 厂商电源计划”，与 Windows `powercfg` 单列。
4. DLL 不可用时，视觉模式是否允许旧 Uniwill SDK fallback？灯光 RGB 是否继续支持旧 SDK，还是只保留 DLL 的开关/亮度？
5. “取消日志”指移除用户可见日志界面，还是不写持久日志？建议保留必要安全/故障诊断记录。

## 发现与方法说明

Dean Peters 的需求发现流程强调问题假设和证据验证；本次没有做访谈，因此本文件是**基于用户明确反馈与代码事实的待验证需求基线**，不是完整 Discovery 结论。优先级按数据成熟度选择轻量排序，不编造 RICE Reach 数值。PRD 采用问题、范围、风险、开放问题结构；用户故事使用可测试的 Given/When/Then 验收条件。

- [Dean Peters: discovery-process](https://github.com/deanpeters/Product-Manager-Skills/blob/main/skills/discovery-process/SKILL.md)
- [Dean Peters: prioritization-advisor](https://github.com/deanpeters/Product-Manager-Skills/blob/main/skills/prioritization-advisor/SKILL.md)
- [Dean Peters: prd-development](https://github.com/deanpeters/Product-Manager-Skills/blob/main/skills/prd-development/SKILL.md)
- [Dean Peters: user-story](https://github.com/deanpeters/Product-Manager-Skills/blob/main/skills/user-story/SKILL.md)
- [NUCtool author repository, 0.5.0-AI](https://github.com/cyear/NUCtool/tree/0.5.0-AI)
