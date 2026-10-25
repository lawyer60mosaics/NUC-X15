export type UiLanguage = 'en' | 'zh';

export const tr = (language: UiLanguage, english: string, chinese: string) =>
  language === 'zh' ? chinese : english;

const scenarioLabels: Record<string, { en: string; zh: string; noiseEn: string; noiseZh: string }> = {
  quiet: { en: 'QUIET FAN CURVE', zh: '静音风扇曲线', noiseEn: 'LOW', noiseZh: '低' },
  balanced: { en: 'BALANCED FAN CURVE', zh: '均衡风扇曲线', noiseEn: 'MEDIUM', noiseZh: '中' },
  cooling: { en: 'COOLING FAN CURVE', zh: '散热优先曲线', noiseEn: 'HIGH', noiseZh: '高' },
  // Legacy values remain readable but are presented as EC-only fan curves.
  media: { en: 'QUIET FAN CURVE', zh: '静音风扇曲线', noiseEn: 'LOW', noiseZh: '低' },
  silent: { en: 'QUIET FAN CURVE', zh: '静音风扇曲线', noiseEn: 'LOW', noiseZh: '低' },
  game: { en: 'COOLING FAN CURVE', zh: '散热优先曲线', noiseEn: 'HIGH', noiseZh: '高' },
  performance: { en: 'COOLING FAN CURVE', zh: '散热优先曲线', noiseEn: 'HIGH', noiseZh: '高' },
  benchmark: { en: 'COOLING FAN CURVE', zh: '散热优先曲线', noiseEn: 'HIGH', noiseZh: '高' },
};

export function scenarioLabel(language: UiLanguage, key: string) {
  const scenario = scenarioLabels[key];
  return scenario ? scenario[language] : key.toUpperCase();
}

export function scenarioNoise(language: UiLanguage, key: string) {
  const scenario = scenarioLabels[key];
  return scenario ? (language === 'zh' ? scenario.noiseZh : scenario.noiseEn) : '--';
}

const exactZh: Record<string, string> = {
  'Saving application settings': '正在保存应用设置',
  'WAITING FOR EC BACKEND': '正在等待 EC 后端',
  'SYNCING FAN SCENE POLICY': '正在同步风扇场景策略',
  'RELEASING EC CONTROL': '正在释放 EC 控制',
  'STARTING EC CONTROL': '正在启动 EC 控制',
  'SAVING CURRENT SCENE': '正在保存当前场景',
  'SAVING DAY/NIGHT SCENE': '正在保存昼夜场景',
  'SAVING STARTUP TAKEOVER POLICY': '正在保存开机接管策略',
  'CONFIGURING STARTUP': '正在配置开机启动',
  'READING STARTUP STATUS': '正在读取开机启动状态',
  'ENABLING STARTUP': '正在开启开机启动',
  'DISABLING STARTUP': '正在关闭开机启动',
  'LOADING LAST SAVED CONFIGURATION': '正在载入上次配置',
  'TRIGGERING RECOVERY WATCHDOG TEST': '正在触发恢复看门狗测试',
  'WRITING WHISPER GAME SILENCE POLICY': '正在写入游戏静音策略',
  'WRITING BATTERY CARE LIMIT': '正在写入电池保护限制',
  'WRITING KEYBOARD LIGHTING SETTINGS': '正在写入键盘灯光设置',
  'WRITING TDP LIMITS': '正在写入 TDP 限制',
  'ENABLING NUCTOOL BENCHMARK MODE': '正在请求启用 NUCtool.dll 基准模式',
  'DISABLING NUCTOOL BENCHMARK MODE': '正在请求关闭 NUCtool.dll 基准标记',
  'Operation history cleared.': '操作历史已清除。',
  'Application settings saved.': '应用设置已保存。',
  'Application settings restored to defaults.': '应用设置已恢复默认值。',
  'Current scene policy saved.': '当前场景策略已保存。',
  'Startup fan takeover saved.': '开机风扇接管已保存。',
  'Startup fan takeover disabled and saved.': '开机风扇接管已关闭并保存。',
  'Last saved configuration loaded.': '已载入上次保存的配置。',
  'Recovery watchdog test command dispatched.': '恢复看门狗测试命令已发送。',
  'Launch at startup enabled.': '已启用开机启动。',
  'Launch at startup disabled.': '已关闭开机启动。',
  'Adaptive core scheduling enabled': '已启用自适应核心调度',
  'Adaptive core scheduling disabled': '已关闭自适应核心调度',
  'Whisper frame limit policy synced to the vendor service.': '游戏静音帧率限制策略已同步到厂商服务。',
  'Battery care limit written to the EC controller.': '电池保护限制已写入 EC 控制器。',
  'RGB lighting policy written to the peripheral controller.': 'RGB 灯光策略已写入外设控制器。',
  'Vendor visual profile applied and verified.': '厂商画质模式已应用并完成回读验证。',
  'Visual profile request sent through the compatibility bridge; hardware readback is unavailable.': '画质模式请求已通过兼容桥接发送，但当前硬件服务不提供回读。',
  'Day/night scene saved as automatic.': '昼夜场景已保存为自动模式。',
  'Day/night scene saved as day mode.': '昼夜场景已保存为日间模式。',
  'Day/night scene saved as night mode.': '昼夜场景已保存为夜间模式。',
  'IDLE': '空闲',
  'NORMAL': '正常',
  'DROPPED SAMPLES': '采样丢失',
  'CORE UNAVAILABLE': '核心不可用',
  'Save settings': '保存设置',
  'Save settings failed': '保存设置失败',
  'Change scene': '切换场景',
  'Sync power': '同步功耗',
  'Restore lighting': '恢复灯光',
  'Restored keyboard and lightbar defaults': '已恢复键盘和灯条默认值',
  'Release EC control': '释放 EC 控制',
  'Start EC control': '启动 EC 控制',
  'Returned fan control to the system': '已将风扇控制交还系统',
  'Enabled the current fan curve': '已启用当前风扇曲线',
  'Sentinel test': '哨兵测试',
  'Manually triggered a sentinel restart test': '已手动触发哨兵重启测试',
};

const phraseZh: Array<[RegExp, string]> = [
  [/^APPLYING NUCTOOL PROFILE: (.+)$/, '正在请求 NUCtool.dll 性能档：$1'],
  [/^NUCtool\.dll profile confirmed by hardware readback \(index (\d+)\)\. Benchmark disable was requested; vendor plan was left unchanged\.$/, 'NUCtool.dll 性能档已由硬件回读确认（索引 $1）；已请求关闭基准标记，厂商计划未更改。'],
  [/^NUCtool\.dll profile request sent, but readback did not confirm index (\d+)\. Vendor plan was left unchanged\.$/, '已发送 NUCtool.dll 性能档请求，但回读未确认索引 $1；厂商计划未更改。'],
  [/^NUCtool\.dll benchmark calls returned \(connect=(.+), benchmark=(.+), plan\[(.+)\]=(.+)\); hardware state cannot be read back, so acceptance and effect are unconfirmed\.$/, 'NUCtool.dll 基准控制函数已返回（连接码 $1、基准码 $2、计划 $3 返回码 $4）；DLL 不提供状态回读，是否接受或生效尚无法确认。'],
  [/^NUCtool\.dll benchmark-disable call returned \(connect=(.+), benchmark=(.+), plan unchanged\); hardware state cannot be read back, so acceptance and effect are unconfirmed\.$/, 'NUCtool.dll 关闭基准控制函数已返回（连接码 $1、基准码 $2）；DLL 不提供状态回读，是否接受或生效尚无法确认，厂商计划保持不变。'],
  [/^APPLYING VENDOR DISPLAY MODE: /, '正在应用厂商画质模式：'],
  [/^Failed to save application settings: /, '保存应用设置失败：'],
  [/^Failed to load application settings: /, '载入应用设置失败：'],
  [/^Failed to sync fan policy: /, '同步风扇策略失败：'],
  [/^Failed to switch fan control: /, '切换风扇控制失败：'],
  [/^Failed to save policy: /, '保存策略失败：'],
  [/^Failed to save day\/night scene: /, '保存昼夜场景失败：'],
  [/^Failed to save startup takeover policy: /, '保存开机接管策略失败：'],
  [/^Failed to load policy: /, '载入策略失败：'],
  [/^Failed to trigger recovery test: /, '触发恢复测试失败：'],
  [/^Failed to apply Whisper: /, '应用游戏静音策略失败：'],
  [/^Failed to apply battery limit: /, '应用电池限制失败：'],
  [/^Failed to apply RGB lighting: /, '应用 RGB 灯光失败：'],
  [/^Failed to apply visual profile: /, '应用画质模式失败：'],
  [/^Failed to change NUCtool benchmark mode: /, '更改 NUCtool.dll 基准模式失败：'],
  [/^Failed to write TDP limits: /, '写入 TDP 限制失败：'],
  [/^Failed to switch power profile: /, '切换功耗配置失败：'],
  [/^Failed to set display refresh rate: /, '设置显示刷新率失败：'],
  [/^Failed to switch display profile: /, '切换显示配置失败：'],
  [/^Failed to read startup status: /, '读取开机启动状态失败：'],
  [/^Failed to configure startup: /, '配置开机启动失败：'],
  [/^Power profile switched: /, '功耗配置已切换：'],
  [/^Display profile switched: /, '显示配置已切换：'],
  [/^Display refresh rate set to /, '显示刷新率已设置为 '],
  [/^SWITCHING DISPLAY REFRESH RATE TO /, '正在切换显示刷新率至 '],
  [/^SYNCING DISPLAY PROFILE: /, '正在同步显示配置：'],
  [/^Warning: (.+) fan stall detected\. EC is forcing both fans to full speed\.$/, '警告：检测到 $1 风扇停转，EC 正在强制双风扇满速散热。'],
];

export function translateRuntimeText(text: string, language: UiLanguage) {
  if (language === 'en' || !text) return text;
  const exact = exactZh[text];
  if (exact) return exact;
  const changedScene = text.match(/^Scene changed to (.+)$/);
  if (changedScene) {
    const key = changedScene[1].toLowerCase();
    return `场景已切换为${scenarioLabel('zh', key)}`;
  }
  const syncedPower = text.match(/^(SILENT|BALANCED|PERFORMANCE) automatically matched (.+) power and locked$/);
  if (syncedPower) {
    const powerModeZh: Record<string, string> = {
      powersave: '低功耗',
      balanced: '平衡',
      performance: '性能',
    };
    return `${scenarioLabel('zh', syncedPower[1].toLowerCase())}场景已自动匹配并锁定${powerModeZh[syncedPower[2]] ?? syncedPower[2]}功耗配置`;
  }
  const namedProfiles: Record<string, string> = {
    READING: '阅读',
    VIDEO: '视频',
    GAMING: '游戏',
    OFFICE: '办公',
    STANDARD: '标准',
    'MAX PERFORMANCE': '最高性能',
    BALANCED: '平衡',
    'MAX EFFICIENCY': '最高能效',
  };
  const switchedPowerProfile = text.match(/^Power profile switched: (.+)$/);
  if (switchedPowerProfile) return `功耗配置已切换为：${namedProfiles[switchedPowerProfile[1]] ?? switchedPowerProfile[1]}`;
  const switchedDisplayProfile = text.match(/^Display profile switched: (.+)$/);
  if (switchedDisplayProfile) return `显示配置已切换为：${namedProfiles[switchedDisplayProfile[1]] ?? switchedDisplayProfile[1]}`;
  const syncingDisplayProfile = text.match(/^SYNCING DISPLAY PROFILE: (.+)$/);
  if (syncingDisplayProfile) return `正在同步显示配置：${namedProfiles[syncingDisplayProfile[1]] ?? syncingDisplayProfile[1]}`;
  for (const [pattern, replacement] of phraseZh) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}
