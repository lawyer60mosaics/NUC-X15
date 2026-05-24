import React, { useState, useEffect, useCallback } from 'react';
import CapsuleTabs, { TabItem } from './components/CapsuleTabs';
import GlassCard from './components/GlassCard';
import OverviewSection from './components/OverviewSection';
import PowerSection from './components/PowerSection';
import MonitorSection from './components/MonitorSection';

// 导入核心 Hooks
import { useFanControl, SCENARIOS } from './hooks/useFanControl';
import { usePower } from './hooks/usePower';
import { useVendorService } from './hooks/useVendorService';
import { useDiagnostics } from './hooks/useDiagnostics';

export const App: React.FC = () => {
  // 1. Toast 全局弹窗通知系统
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);
  
  const showToast = useCallback((msg: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message: msg }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  // 2. 挂载所有底层的 React 硬件桥接 Hooks
  const fanCtrl = useFanControl(showToast);
  const powerCtrl = usePower(showToast);
  const vendorCtrl = useVendorService(showToast);
  const getFanPayload = useCallback(() => fanCtrl.buildPayload(), [fanCtrl.buildPayload]);
  const getFanRunning = useCallback(() => fanCtrl.running, [fanCtrl.running]);
  const diagCtrl = useDiagnostics(showToast, getFanPayload, getFanRunning);

  // 3. 全局切页 Tab 状态
  const [activeTab, setActiveTab] = useState<string>('overview');

  const tabs: TabItem[] = [
    { id: 'overview', label: '温控矩阵', subtitle: '拖拽曲线 · 恒速接管', index: 1 },
    { id: 'power', label: '功耗外设', subtitle: 'TDP调节 · RGB星云 · 养护', index: 2 },
    { id: 'monitor', label: '诊断哨兵', subtitle: '哨兵测试 · 日志', index: 3 },
  ];

  // 4. 让 selectedScenario 与全局 HTML 属性联动，触发 theme.css 中的液态光晕流转
  useEffect(() => {
    document.documentElement.setAttribute('data-scenario', fanCtrl.selectedScenario);
  }, [fanCtrl.selectedScenario]);

  useEffect(() => {
    const syncTimeTheme = () => {
      const hour = new Date().getHours();
      const theme = hour >= 7 && hour < 18 ? 'day' : 'night';
      document.documentElement.setAttribute('data-time-theme', theme);
    };

    syncTimeTheme();
    const timer = window.setInterval(syncTimeTheme, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div 
      style={{ 
        minHeight: '100dvh', 
        height: 'auto',
        padding: '24px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '20px', 
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: 'none',
        margin: '0 auto',
        overflow: 'visible',
      }}
    >
      {/* 炫彩流体背景定位光圈 (配合 theme.css 动画) */}
      <div className="fluid-glow-container">
        <div className="fluid-glow-orb-1" />
        <div className="fluid-glow-orb-2" />
      </div>

      {/* 极简折射 Toast 提醒组件 */}
      <div 
        style={{ 
          position: 'fixed', 
          top: '24px', 
          right: '24px', 
          zIndex: 99999, 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '12px',
          pointerEvents: 'none'
        }}
      >
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            style={{
              background: 'var(--surface-toast)',
              backdropFilter: 'blur(20px)',
              border: '1px solid var(--border-strong)',
              borderRadius: '12px',
              padding: '12px 20px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 0 10px rgba(255,255,255,0.05)',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              animation: 'fadeInSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-color)' }}></span>
            {toast.message}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes fadeInSlide {
          from { opacity: 0; transform: translateY(-10px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* 顶级浮动玻璃顶栏 (Float Glass Topbar) */}
      <GlassCard 
        style={{ 
          padding: '12px 24px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          borderRadius: '18px',
          boxShadow: '0 10px 40px rgba(0,0,0,0.18)'
        }}
      >
        {/* 左侧：Logo 与状态呼吸灯 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <h1 
              style={{ 
                margin: 0, 
                fontSize: '18px', 
                fontWeight: 900, 
                fontFamily: 'var(--font-display)', 
                letterSpacing: '-0.02em',
                background: 'var(--brand-title-gradient)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              NUCtool
            </h1>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', letterSpacing: '0.05em', fontWeight: 600 }}>
              LIQUID GLASS CONSOLE
            </span>
          </div>

          <div style={{ height: '14px', width: '1px', background: 'var(--divider-color)' }} />

          {/* 实时状态胶囊 */}
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              background: 'var(--surface-sunken)', 
              padding: '4px 10px', 
              borderRadius: '99px',
              border: '1px solid var(--border-muted)',
            }}
          >
            <span 
              className="status-dot" 
              style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                background: fanCtrl.running ? 'var(--accent-color)' : '#8e8e93', 
                boxShadow: fanCtrl.running ? '0 0 8px var(--accent-color-glow)' : 'none',
                display: 'inline-block',
                animation: fanCtrl.running ? 'pulse 2s infinite' : 'none'
              }}
            />
            <span style={{ fontSize: '10px', fontWeight: 700, color: fanCtrl.running ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              {fanCtrl.running ? 'EC 驱动接管中' : '系统默认托管'}
            </span>
          </div>
        </div>

        {/* 右侧：开机接管自启与功耗总阀门 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          
          {/* 电源控制总开关按钮 */}
          <button
            onClick={fanCtrl.toggleControl}
            style={{
              background: fanCtrl.running ? 'rgba(255, 69, 58, 0.15)' : 'var(--accent-color)',
              border: fanCtrl.running ? '1px solid rgba(255, 69, 58, 0.3)' : 'none',
              color: fanCtrl.running ? 'var(--text-danger)' : 'var(--text-inverse)',
              borderRadius: '10px',
              padding: '6px 14px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: fanCtrl.running ? 'none' : '0 4px 12px var(--accent-color-glow)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {fanCtrl.running ? (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
                断开托管
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                启动接管
              </>
            )}
          </button>
        </div>
      </GlassCard>

      {/* 浮动场景选择器 (Scenic Glow Scenario Pills) */}
      <GlassCard 
        style={{ 
          padding: '8px', 
          borderRadius: '16px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 6px 20px rgba(0,0,0,0.12)'
        }}
      >
        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '12px', fontWeight: 700, letterSpacing: '0.05em' }}>
          ENVIRONMENT SCENARIO SELECTOR
        </span>
        <div style={{ display: 'flex', gap: '6px', flex: 1, justifySelf: 'end', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {Object.keys(SCENARIOS).map((key) => {
            const sc = SCENARIOS[key];
            const isSelected = fanCtrl.selectedScenario === key;
            return (
              <button
                key={key}
                onClick={() => {
                  fanCtrl.setSelectedScenario(key);
                  // 联动触发底层功耗模式的快捷选择
                  if (key === 'silent' || key === 'office') {
                    powerCtrl.applyPowerMode('powersave');
                  } else if (key === 'gaming') {
                    powerCtrl.applyPowerMode('balanced');
                  } else {
                    powerCtrl.applyPowerMode('performance');
                  }
                }}
                style={{
                  background: isSelected ? 'var(--accent-color)' : 'var(--surface-muted)',
                  border: isSelected ? '1px solid var(--border-soft)' : '1px solid var(--border-muted)',
                  color: isSelected ? 'var(--text-inverse)' : 'var(--text-secondary)',
                  borderRadius: '10px',
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: isSelected ? '0 4px 14px var(--accent-color-glow)' : 'none',
                }}
              >
                {sc.label}
              </button>
            );
          })}
        </div>
      </GlassCard>

      {/* 主选项卡导航轨道 */}
      <CapsuleTabs 
        tabs={tabs} 
        activeTab={activeTab} 
        onChange={setActiveTab} 
      />

      {/* 中部核心功能卡片切页逻辑 */}
      <main style={{ flex: '1 0 auto', minHeight: 0, overflow: 'visible' }}>
        {activeTab === 'overview' && (
          <OverviewSection
            cpuTemp={fanCtrl.cpuTemp}
            gpuTemp={fanCtrl.gpuTemp}
            cpuFanRpm={fanCtrl.cpuFanRpm}
            gpuFanRpm={fanCtrl.gpuFanRpm}
            cpuCurve={fanCtrl.cpuCurve}
            gpuCurve={fanCtrl.gpuCurve}
            setCpuCurve={fanCtrl.setCpuCurve}
            setGpuCurve={fanCtrl.setGpuCurve}
            constantSpeedEnabled={fanCtrl.constantSpeedEnabled}
            setConstantSpeedEnabled={fanCtrl.setConstantSpeedEnabled}
            constantSpeed={fanCtrl.constantSpeed}
            setConstantSpeed={fanCtrl.setConstantSpeed}
            startupTakeoverEnabled={fanCtrl.startupTakeoverEnabled}
            setStartupTakeoverEnabled={fanCtrl.setStartupTakeoverEnabled}
            running={fanCtrl.running}
            toggleControl={fanCtrl.toggleControl}
            saveConfig={fanCtrl.saveConfig}
            loadConfig={fanCtrl.loadConfig}
            actorStateText={fanCtrl.actorStateText}
            lastSampledTime={fanCtrl.lastSampledTime}
          />
        )}

        {activeTab === 'power' && (
          <PowerSection
            powerMode={powerCtrl.powerMode}
            applyPowerMode={powerCtrl.applyPowerMode}
            cpuPl1={powerCtrl.cpuPl1}
            setCpuPl1={powerCtrl.setCpuPl1}
            cpuPl2={powerCtrl.cpuPl2}
            setCpuPl2={powerCtrl.setCpuPl2}
            gpuPl1={powerCtrl.gpuPl1}
            setGpuPl1={powerCtrl.setGpuPl1}
            gpuPl2={powerCtrl.gpuPl2}
            setGpuPl2={powerCtrl.setGpuPl2}
            applyTdpLimits={powerCtrl.applyTdpLimits}
            currentHz={powerCtrl.currentHz}
            supportedHz={powerCtrl.supportedHz}
            displayDetail={powerCtrl.displayDetail}
            displaySceneMode={powerCtrl.displaySceneMode}
            displaySceneDetail={powerCtrl.displaySceneDetail}
            applyDisplayHz={powerCtrl.applyDisplayHz}
            applyDisplayScene={powerCtrl.applyDisplayScene}
            powerBusy={powerCtrl.busy}
            whisperMode={vendorCtrl.whisperMode}
            setWhisperMode={vendorCtrl.setWhisperMode}
            whisperFps={vendorCtrl.whisperFps}
            setWhisperFps={vendorCtrl.setWhisperFps}
            batteryMode={vendorCtrl.batteryMode}
            setBatteryMode={vendorCtrl.setBatteryMode}
            batteryLevel={vendorCtrl.batteryLevel}
            setBatteryLevel={vendorCtrl.setBatteryLevel}
            lightingColor={vendorCtrl.lightingColor}
            setLightingColor={vendorCtrl.setLightingColor}
            keyboardBrightness={vendorCtrl.keyboardBrightness}
            setKeyboardBrightness={vendorCtrl.setKeyboardBrightness}
            lightbarBrightness={vendorCtrl.lightbarBrightness}
            setLightbarBrightness={vendorCtrl.setLightbarBrightness}
            lightbarBreathing={vendorCtrl.lightbarBreathing}
            setLightbarBreathing={vendorCtrl.setLightbarBreathing}
            vendorBusy={vendorCtrl.busy}
            applyWhisper={vendorCtrl.applyWhisper}
            applyBattery={vendorCtrl.applyBattery}
            applyLighting={vendorCtrl.applyLighting}
          />
        )}

        {activeTab === 'monitor' && (
          <MonitorSection
            cpuTemp={fanCtrl.cpuTemp}
            gpuTemp={fanCtrl.gpuTemp}
            cpuFanRpm={fanCtrl.cpuFanRpm}
            gpuFanRpm={fanCtrl.gpuFanRpm}
            summary={diagCtrl.summary}
            logs={diagCtrl.logs}
            runSentinelTest={diagCtrl.runSentinelTest}
          />
        )}
      </main>

      {/* 页脚 */}
      <footer style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '20px', padding: '10px 0' }}>
        <span>NUCtool Matrix System v2.6.0-React</span>
        <span>Advanced agentic pairing</span>
      </footer>
    </div>
  );
};

export default App;
