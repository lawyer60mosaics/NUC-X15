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

const PRESET_COLORS = [
  { name: 'HOT RED', hex: '#ff453a', glow: 'rgba(255, 69, 58, 0.4)' },
  { name: 'LAVA ORANGE', hex: '#ff9f0a', glow: 'rgba(255, 159, 10, 0.4)' },
  { name: 'AURORA GREEN', hex: '#30d158', glow: 'rgba(48, 209, 88, 0.4)' },
  { name: 'GLACIER BLUE', hex: '#64d2ff', glow: 'rgba(100, 210, 255, 0.4)' },
  { name: 'DEEP BLUE', hex: '#0a84ff', glow: 'rgba(10, 132, 255, 0.4)' },
  { name: 'MAGIC PURPLE', hex: '#bf5af2', glow: 'rgba(191, 90, 242, 0.4)' },
  { name: 'PURE WHITE', hex: '#ffffff', glow: 'rgba(255, 255, 255, 0.3)' },
  { name: 'SHADOW GOLD', hex: '#ffd60a', glow: 'rgba(255, 214, 10, 0.4)' },
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

    setPickerPos({ x: targetX / scaleX, y: targetY / scaleY });
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
    <GlassCard className="color-picker-card lighting-console">
      <div className="control-panel-header lighting-panel-header">
        <div className="control-panel-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /><circle cx="12" cy="12" r="4" /></svg>
        </div>
        <div>
          <h3 className="card-title">KEYBOARD & CHASSIS LIGHTING</h3>
          <p className="card-subtitle">Choose a color and tune both lighting zones</p>
        </div>
        <div className="lighting-hex-readout">
          <i style={{ background: color, boxShadow: `0 0 16px ${color}` }} />
          {color.toUpperCase()}
        </div>
      </div>

      <div className="lighting-workbench">
        <div 
          className="lighting-color-wheel"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          <canvas 
            ref={canvasRef} 
            width={300} 
            height={300} 
            className="lighting-color-canvas"
          />
          <div 
            className="lighting-color-anchor"
            style={{
              left: `${pickerPos.x}px`,
              top: `${pickerPos.y}px`,
              background: color,
            }}
          />
          <span className="lighting-wheel-label">COLOR MATRIX</span>
        </div>

        <div className="lighting-tuning">
          <div className="lighting-control-block">
            <div className="lighting-block-label">COLOR PRESETS</div>
            <div className="lighting-preset-grid">
              {PRESET_COLORS.map((preset) => {
                const isSelected = color.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => onChangeColor(preset.hex)}
                    title={preset.name}
                    className={`lighting-preset ${isSelected ? 'is-active' : ''}`}
                    aria-pressed={isSelected}
                  >
                    <span 
                      className="lighting-preset-dot"
                      style={{
                        background: preset.hex,
                        boxShadow: `0 0 8px ${preset.glow}`
                      }}
                    />
                    <span>
                      {preset.name.slice(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lighting-native-picker">
            <span>PRECISION PICKER</span>
            <label>
              <input
                type="color"
                value={color}
                onChange={(e) => onChangeColor(e.target.value)}
                aria-label="Choose an exact lighting color"
              />
              <span>OPEN SYSTEM COLOR PICKER</span>
            </label>
          </div>
        </div>
      </div>

      <div className="lighting-slider-grid">
        <LiquidSlider
          label="KEYBOARD BACKLIGHT"
          min={0}
          max={100}
          value={keyboardBrightness}
          unit="%"
          onChange={onChangeKeyboardBrightness}
        />
        <LiquidSlider
          label="CHASSIS LIGHTBAR"
          min={0}
          max={100}
          value={lightbarBrightness}
          unit="%"
          onChange={onChangeLightbarBrightness}
        />
      </div>

      <div className="lighting-footer">
        <label className="lighting-breathing-toggle">
          <button
            type="button"
            role="switch"
            aria-checked={lightbarBreathing}
            aria-label="Toggle chassis lightbar breathing"
            className={lightbarBreathing ? 'is-on' : ''}
            onClick={() => onChangeLightbarBreathing(!lightbarBreathing)}
          >
            <i />
          </button>
          <span><strong>LIGHTBAR BREATHING</strong><small>{lightbarBreathing ? 'EFFECT ENABLED' : 'STEADY BRIGHTNESS'}</small></span>
        </label>

        <button
          type="button"
          onClick={onApply}
          disabled={busy}
          className="lighting-apply-button"
        >
          {busy ? (
            <>
              <span className="lighting-button-loader" />
              WRITING TO PERIPHERAL CONTROLLER...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              APPLY LIGHTING SETTINGS
            </>
          )}
        </button>
      </div>
    </GlassCard>
  );
};

export default ColorCirclePicker;
