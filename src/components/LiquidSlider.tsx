import React from 'react';

interface LiquidSliderProps {
  label: string;
  min: number;
  max: number;
  value: number;
  unit?: string;
  step?: number;
  disabled?: boolean;
  onChange: (val: number) => void;
  className?: string;
}

export const LiquidSlider: React.FC<LiquidSliderProps> = ({
  label,
  min,
  max,
  value,
  unit = '',
  step = 1,
  disabled = false,
  onChange,
  className = '',
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  return (
    <div className={`liquid-slider-group ${className}`} style={{ opacity: disabled ? 0.55 : 1, transition: 'opacity 0.25s ease' }}>
      <div className="slider-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
        <span className="slider-label" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span className="slider-value" style={{ color: 'var(--accent-color)', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
          {value}{unit}
        </span>
      </div>
      
      <div className="slider-container" style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '24px' }}>
        {/* 液态模拟轨道 */}
        <div 
          className="slider-track-bg" 
          style={{
            position: 'absolute',
            width: '100%',
            height: '6px',
            borderRadius: '99px',
            background: 'var(--progress-track)',
            pointerEvents: 'none',
          }}
        />
        <div 
          className="slider-track-fill" 
          style={{
            position: 'absolute',
            width: `${percentage}%`,
            height: '6px',
            borderRadius: '99px',
            background: 'linear-gradient(90deg, var(--accent-color), var(--text-primary))',
            pointerEvents: 'none',
            boxShadow: '0 0 6px var(--accent-color-glow)',
          }}
        />
        
        {/* 原生 range input 采用自定义样式以匹配极致手感 */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={handleInput}
          className="liquid-range-input"
          style={{
            width: '100%',
            height: '24px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            position: 'relative',
            zIndex: 2,
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
};
export default LiquidSlider;
