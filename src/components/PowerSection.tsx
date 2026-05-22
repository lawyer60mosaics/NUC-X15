import React from 'react';
import GlassCard from './GlassCard';
import LiquidSlider from './LiquidSlider';
import ColorCirclePicker from './ColorCirclePicker';

import { CPU_POWER_PROFILES } from '../hooks/usePower';

interface PowerSectionProps {
  // usePower hook variables
  powerMode: string;
  applyPowerMode: (mode: string) => void;
  cpuPl1: number;
  setCpuPl1: (val: number) => void;
  cpuPl2: number;
  setCpuPl2: (val: number) => void;
  gpuPl1: number;
  setGpuPl1: (val: number) => void;
  gpuPl2: number;
  setGpuPl2: (val: number) => void;
  applyTdpLimits: (pl1: number, pl2: number, gpl1: number, gpl2: number) => void;
  currentHz: number;
  supportedHz: number[];
  displayDetail: string;
  applyDisplayHz: (hz: number) => void;
  powerBusy: boolean;

  // useVendorService hook variables
  whisperMode: string;
  setWhisperMode: (mode: string) => void;
  whisperFps: number;
  setWhisperFps: (val: number) => void;
  batteryMode: string;
  setBatteryMode: (mode: string) => void;
  batteryLevel: number;
  setBatteryLevel: (val: number) => void;
  lightingColor: string;
  setLightingColor: (color: string) => void;
  keyboardBrightness: number;
  setKeyboardBrightness: (val: number) => void;
  lightbarBrightness: number;
  setLightbarBrightness: (val: number) => void;
  lightbarBreathing: boolean;
  setLightbarBreathing: (val: boolean) => void;
  vendorBusy: boolean;
  applyWhisper: (mode: string, fps: number) => void;
  applyBattery: (mode: string, level: number) => void;
  applyLighting: (colorHex: string, kbBright: number, lbBright: number, breathing: boolean) => void;
}

export const PowerSection: React.FC<PowerSectionProps> = ({
  powerMode,
  applyPowerMode,
  cpuPl1,
  setCpuPl1,
  cpuPl2,
  setCpuPl2,
  gpuPl1,
  setGpuPl1,
  gpuPl2,
  setGpuPl2,
  applyTdpLimits,
  currentHz,
  supportedHz,
  displayDetail,
  applyDisplayHz,
  powerBusy,

  whisperMode,
  setWhisperMode,
  whisperFps,
  setWhisperFps,
  batteryMode,
  setBatteryMode,
  batteryLevel,
  setBatteryLevel,
  lightingColor,
  setLightingColor,
  keyboardBrightness,
  setKeyboardBrightness,
  lightbarBrightness,
  setLightbarBrightness,
  lightbarBreathing,
  setLightbarBreathing,
  vendorBusy,
  applyWhisper,
  applyBattery,
  applyLighting,
}) => {

  const handleApplyTdp = () => {
    applyTdpLimits(cpuPl1, cpuPl2, gpuPl1, gpuPl2);
  };

  const handleApplyWhisper = (mode: string) => {
    setWhisperMode(mode);
    applyWhisper(mode, whisperFps);
  };

  const handleApplyBattery = (mode: string) => {
    setBatteryMode(mode);
    applyBattery(mode, batteryLevel);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
      
      {/* 左列：系统功耗与显卡 PL 配置 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* 模块：系统功耗预设 */}
        <GlassCard style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
            系统性能能效模型 (TDP Profiles)
          </h3>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: 1.4 }}>
            选择符合你当前用机习惯的功耗限制，切换将在线修改 ACPI 寄存器组。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.keys(CPU_POWER_PROFILES).map((key) => {
              const profile = CPU_POWER_PROFILES[key];
              const isSelected = powerMode === key;
              return (
                <button
                  key={key}
                  onClick={() => applyPowerMode(key)}
                  style={{
                    background: isSelected ? 'var(--glass-gradient-hover)' : 'rgba(255,255,255,0.02)',
                    border: isSelected ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.04)',
                    boxShadow: isSelected ? '0 8px 24px rgba(0,0,0,0.25), 0 0 8px var(--accent-color-glow)' : 'none',
                    borderRadius: '12px',
                    padding: '12px 16px',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '14px', fontWeight: 800 }}>{profile.label}</span>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-display)', color: isSelected ? 'var(--accent-color)' : 'rgba(255,255,255,0.4)', fontWeight: 700 }}>
                      PL1: {profile.cpu1}W / PL2: {profile.cpu2}W
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0 0', fontSize: '11px', opacity: isSelected ? 0.9 : 0.6, lineHeight: 1.4 }}>
                    {profile.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* 模块：手动 TDP 滑条配置 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
              PL 限额自定义调节 (TDP Limits)
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              防 ACPI 竞争保护队列已启动，滑块拖拽松手后执行自适应排队锁定。
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <LiquidSlider
                label="CPU 持续功耗 PL1"
                min={15}
                max={90}
                value={cpuPl1}
                unit="W"
                onChange={setCpuPl1}
              />
              <LiquidSlider
                label="CPU 睿频功耗 PL2"
                min={20}
                max={115}
                value={cpuPl2}
                unit="W"
                onChange={setCpuPl2}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <LiquidSlider
                label="GPU 持续功耗 PL1"
                min={30}
                max={110}
                value={gpuPl1}
                unit="W"
                onChange={setGpuPl1}
              />
              <LiquidSlider
                label="GPU 睿频功耗 PL2"
                min={40}
                max={140}
                value={gpuPl2}
                unit="W"
                onChange={setGpuPl2}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', opacity: 0.7 }}>
              手动微调滑块将退出当前预设模式并标为 “自定义限制”
            </span>
            <button
              onClick={handleApplyTdp}
              disabled={powerBusy}
              style={{
                background: powerBusy ? 'rgba(255,255,255,0.04)' : 'var(--accent-color)',
                color: powerBusy ? 'var(--text-secondary)' : '#040812',
                border: 'none',
                borderRadius: '10px',
                padding: '8px 16px',
                fontWeight: 800,
                fontSize: '12px',
                cursor: powerBusy ? 'not-allowed' : 'pointer',
                boxShadow: powerBusy ? 'none' : '0 4px 12px var(--accent-color-glow)',
                transition: 'all 0.2s ease',
              }}
            >
              {powerBusy ? '排队写入中...' : '提交 PL 锁定'}
            </button>
          </div>
        </GlassCard>

        {/* 模块：显示器与屏幕刷新率 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
              屏幕刷新率与超频 (Display Hz)
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
              检测到的活动显卡设备: <strong style={{ color: 'var(--text-primary)' }}>{displayDetail}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>目标刷新率:</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {supportedHz.map((hz) => {
                const isActive = currentHz === hz;
                return (
                  <button
                    key={hz}
                    onClick={() => applyDisplayHz(hz)}
                    disabled={powerBusy}
                    style={{
                      background: isActive ? 'var(--accent-color)' : 'rgba(255,255,255,0.03)',
                      border: isActive ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.05)',
                      color: isActive ? '#040812' : 'var(--text-secondary)',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      fontSize: '11px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {hz}Hz
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>

      </div>

      {/* 右列：外设 RGB 灯效与厂商专享养护 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        {/* RGB 灯效星云舱 (Embedded Picker) */}
        <ColorCirclePicker
          color={lightingColor}
          onChangeColor={setLightingColor}
          keyboardBrightness={keyboardBrightness}
          onChangeKeyboardBrightness={setKeyboardBrightness}
          lightbarBrightness={lightbarBrightness}
          onChangeLightbarBrightness={setLightbarBrightness}
          lightbarBreathing={lightbarBreathing}
          onChangeLightbarBreathing={setLightbarBreathing}
          busy={vendorBusy}
          onApply={() => applyLighting(lightingColor, keyboardBrightness, lightbarBrightness, lightbarBreathing)}
        />

        {/* 模块：Whisper 游戏静音与电池养护 */}
        <GlassCard style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Uniwill 增值管理 (Whisper & Battery)
            </h3>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0 }}>
              对主板 EC 的 Whisper 静音算法和锂电池寿命养护阈值提供直读写入。
            </p>
          </div>

          {/* Whisper 极静控温 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>Whisper 极静控温</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['Off', 'On'].map((mode) => {
                  const isActive = whisperMode === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => handleApplyWhisper(mode)}
                      style={{
                        background: isActive ? 'var(--accent-color)' : 'rgba(255,255,255,0.04)',
                        border: 'none',
                        color: isActive ? '#040812' : 'var(--text-secondary)',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {mode === 'On' ? '开启' : '关闭'}
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', width: '70px' }}>限制游戏帧:</span>
              <input
                type="range"
                min={30}
                max={120}
                step={5}
                value={whisperFps}
                disabled={whisperMode === 'Off'}
                onChange={(e) => {
                  setWhisperFps(Number(e.target.value));
                  if (whisperMode === 'On') {
                    applyWhisper('On', Number(e.target.value));
                  }
                }}
                style={{ flex: 1, height: '4px', accentColor: 'var(--accent-color)' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--accent-color)', width: '40px', textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {whisperFps} FPS
              </span>
            </div>
          </div>

          {/* 锂电养护阈值 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '12px', background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>锂电充电阈值控制</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[
                  { id: 'BestBattery', label: '养护 (60%)', level: 60 },
                  { id: 'Standard', label: '平衡 (80%)', level: 80 },
                  { id: 'FullCharge', label: '满电 (100%)', level: 100 }
                ].map((mode) => {
                  const isActive = batteryMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => {
                        setBatteryLevel(mode.level);
                        handleApplyBattery(mode.id);
                      }}
                      style={{
                        background: isActive ? 'var(--accent-color)' : 'rgba(255,255,255,0.04)',
                        border: 'none',
                        color: isActive ? '#040812' : 'var(--text-secondary)',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', width: '70px' }}>自定义上限:</span>
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={batteryLevel}
                onChange={(e) => {
                  setBatteryLevel(Number(e.target.value));
                  applyBattery(batteryMode, Number(e.target.value));
                }}
                style={{ flex: 1, height: '4px', accentColor: 'var(--accent-color)' }}
              />
              <span style={{ fontSize: '11px', color: 'var(--accent-color)', width: '40px', textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                {batteryLevel}%
              </span>
            </div>
            <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '4px 0 0 0', opacity: 0.6, lineHeight: 1.3 }}>
              限制充电阈值能极大减缓长期插电使用对锂电池正极材料的晶格损耗与鼓胀几率。
            </p>
          </div>

        </GlassCard>

      </div>

    </div>
  );
};

export default PowerSection;
