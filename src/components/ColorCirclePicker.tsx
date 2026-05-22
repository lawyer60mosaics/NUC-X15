import React, { useRef, useEffect, useState } from 'react';
import GlassCard from './GlassCard';
import LiquidSlider from './LiquidSlider';

interface ColorCirclePickerProps {
  color: string;
  onChangeColor: (hex: string) => void;
  keyboardBrightness: number;
  onChangeKeyboardBrightness: (val: number) => void;
  lightbarBrightness: number;
  onChangeLightbarBrightness: (val: number) => void;
  lightbarBreathing: boolean;
  onChangeLightbarBreathing: (val: boolean) => void;
  onApply: () => void;
  busy: boolean;
}

// 苹果 iOS 预设高饱和度霓虹色彩
const PRESET_COLORS = [
  { name: '炙热红', hex: '#ff453a', glow: 'rgba(255, 69, 58, 0.4)' },
  { name: '熔岩橘', hex: '#ff9f0a', glow: 'rgba(255, 159, 10, 0.4)' },
  { name: '极光绿', hex: '#30d158', glow: 'rgba(48, 209, 88, 0.4)' },
  { name: '冰川蓝', hex: '#64d2ff', glow: 'rgba(100, 210, 255, 0.4)' },
  { name: '幽邃蓝', hex: '#0a84ff', glow: 'rgba(10, 132, 255, 0.4)' },
  { name: '魅惑紫', hex: '#bf5af2', glow: 'rgba(191, 90, 242, 0.4)' },
  { name: '纯净白', hex: '#ffffff', glow: 'rgba(255, 255, 255, 0.3)' },
  { name: '暗影金', hex: '#ffd60a', glow: 'rgba(255, 214, 10, 0.4)' },
];

export const ColorCirclePicker: React.FC<ColorCirclePickerProps> = ({
  color,
  onChangeColor,
  keyboardBrightness,
  onChangeKeyboardBrightness,
  lightbarBrightness,
  onChangeLightbarBrightness,
  lightbarBreathing,
  onChangeLightbarBreathing,
  onApply,
  busy,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pickerPos, setPickerPos] = useState({ x: 75, y: 75 });

  // 绘制炫彩极光色相环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const radius = width / 2;
    const cx = width / 2;
    const cy = height / 2;

    // 清空
    ctx.clearRect(0, 0, width, height);

    // 绘制色相圆盘 (HSL 环形填充)
    for (let angle = 0; angle < 360; angle += 0.5) {
      const startAngle = (angle - 0.5) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius - 4, startAngle, endAngle);
      ctx.closePath();

      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius - 4);
      gradient.addColorStop(0, '#ffffff'); // 中心白，越往外饱和度越高
      gradient.addColorStop(1, `hsl(${angle}, 100%, 50%)`);

      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // 绘制柔和黑色阴影边缘
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 更新十字锚点位置
    updatePositionFromColor(color);
  }, []);

  // 根据当前 Color 计算锚点在 Canvas 上的对应位置
  const updatePositionFromColor = (hex: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // 简易解析 RGB 并转化为 HSL
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    const angle = h * 2 * Math.PI;
    const maxRadius = canvas.width / 2 - 6;
    const currentRadius = s * maxRadius;

    setPickerPos({
      x: canvas.width / 2 + Math.cos(angle) * currentRadius,
      y: canvas.height / 2 + Math.sin(angle) * currentRadius
    });
  };

  // 监听色彩变动
  useEffect(() => {
    if (!isDragging) {
      updatePositionFromColor(color);
    }
  }, [color]);

  // 处理色彩点选/拖拽
  const handleColorPick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(clientY - rect.top, rect.height));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 获取坐标下的色彩像素
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = Math.round(x * scaleX);
    const py = Math.round(y * scaleY);
    
    // 限制在色盘圆形中
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxRadius = canvas.width / 2 - 4;

    let targetX = px;
    let targetY = py;

    if (dist > maxRadius) {
      targetX = cx + (dx / dist) * maxRadius;
      targetY = cy + (dy / dist) * maxRadius;
    }

    const imgData = ctx.getImageData(Math.round(targetX), Math.round(targetY), 1, 1).data;
    const r = imgData[0];
    const g = imgData[1];
    const b = imgData[2];

    const toHex = (c: number) => {
      const hex = c.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    const nextHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;

    setPickerPos({ x: targetX / scaleX * rect.width / scaleX, y: targetY / scaleY * rect.height / scaleY });
    onChangeColor(nextHex);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleColorPick(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleColorPick(e.clientX, e.clientY);
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  return (
    <GlassCard className="color-picker-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: color, boxShadow: `0 0 12px ${color}` }}></span>
          外设 RGB 灯效星云舱
        </h3>
        <div style={{ fontSize: '11px', opacity: 0.6, background: 'rgba(255,255,255,0.04)', padding: '4px 8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)', fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>
          {color.toUpperCase()}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '24px', alignItems: 'center' }}>
        {/* 左侧：液态霓虹 Canvas 色盘 */}
        <div 
          style={{ position: 'relative', width: '150px', height: '150px', cursor: 'crosshair', userSelect: 'none' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          <canvas 
            ref={canvasRef} 
            width={300} 
            height={300} 
            style={{ width: '100%', height: '100%', borderRadius: '50%' }}
          />
          {/* 取色锚点 */}
          <div 
            style={{
              position: 'absolute',
              left: `${pickerPos.x}px`,
              top: `${pickerPos.y}px`,
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: color,
              border: '2px solid #ffffff',
              boxShadow: '0 3px 10px rgba(0,0,0,0.5)',
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
              transition: isDragging ? 'none' : 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>

        {/* 右侧：预设快选泡泡 & 精细亮度滑块 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', fontWeight: 600 }}>
              iOS 26 炫光霓虹预设
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {PRESET_COLORS.map((preset) => {
                const isSelected = color.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    onClick={() => onChangeColor(preset.hex)}
                    title={preset.name}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: isSelected ? '1.5px solid rgba(255, 255, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.05)',
                      borderRadius: '10px',
                      padding: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease',
                      boxShadow: isSelected ? `0 0 14px ${preset.glow}` : 'none',
                    }}
                  >
                    <span 
                      style={{
                        display: 'block',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: preset.hex,
                        boxShadow: `0 0 8px ${preset.glow}`
                      }}
                    />
                    <span style={{ fontSize: '11px', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isSelected ? 700 : 500 }}>
                      {preset.name.slice(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* HTML 原生取色器微调 */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>调色盘微调:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '10px', padding: '4px 10px', flex: 1 }}>
              <input
                type="color"
                value={color}
                onChange={(e) => onChangeColor(e.target.value)}
                style={{
                  border: 'none',
                  background: 'none',
                  width: '26px',
                  height: '24px',
                  padding: 0,
                  cursor: 'pointer',
                  borderRadius: '4px',
                }}
              />
              <span style={{ fontSize: '11px', fontFamily: 'var(--font-display)', color: 'var(--text-secondary)' }}>
                手动拾色精密对准
              </span>
            </div>
          </div>
        </div>
      </div>

      <hr style={{ border: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', margin: '4px 0' }} />

      {/* 滑块调节区域 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <LiquidSlider
          label="键盘背光亮度"
          min={0}
          max={100}
          value={keyboardBrightness}
          unit="%"
          onChange={onChangeKeyboardBrightness}
        />
        <LiquidSlider
          label="底盘灯带亮度"
          min={0}
          max={100}
          value={lightbarBrightness}
          unit="%"
          onChange={onChangeLightbarBrightness}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        {/* 底盘灯呼吸效果开关 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
          <div 
            onClick={() => onChangeLightbarBreathing(!lightbarBreathing)}
            style={{
              width: '40px',
              height: '22px',
              borderRadius: '99px',
              background: lightbarBreathing ? 'var(--accent-color)' : 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              position: 'relative',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div 
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: '#ffffff',
                boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                position: 'absolute',
                top: '2px',
                left: lightbarBreathing ? '20px' : '2px',
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </div>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>底盘灯带流光呼吸效果</span>
        </label>

        {/* 写入 EC 硬件按钮 */}
        <button
          onClick={onApply}
          disabled={busy}
          style={{
            background: busy ? 'rgba(255,255,255,0.04)' : 'var(--accent-color)',
            border: 'none',
            borderRadius: '12px',
            padding: '10px 20px',
            color: busy ? 'var(--text-secondary)' : '#040812',
            fontWeight: 800,
            fontSize: '13px',
            cursor: busy ? 'not-allowed' : 'pointer',
            boxShadow: busy ? 'none' : '0 6px 20px var(--accent-color-glow)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {busy ? (
            <>
              <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.2)', borderTop: '2px solid var(--text-secondary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              写入外设芯片...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              应用 RGB 灯效策略
            </>
          )}
        </button>
      </div>
    </GlassCard>
  );
};

export default ColorCirclePicker;
