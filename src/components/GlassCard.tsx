import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  interactive?: boolean;
  intensity?: 'low' | 'normal' | 'high';
  children: React.ReactNode;
}

export const GlassCard: React.FC<GlassCardProps> = ({
  hoverable = false,
  interactive = false,
  intensity = 'normal',
  children,
  className = '',
  style,
  ...props
}) => {
  const blurVal = intensity === 'low' ? '12px' : intensity === 'high' ? '42px' : '28px';
  const saturation = intensity === 'low' ? '140%' : intensity === 'high' ? '200%' : '180%';
  const brightness = intensity === 'low' ? '1.02' : intensity === 'high' ? '1.08' : '1.05';

  const cardStyle: React.CSSProperties = {
    backdropFilter: `blur(${blurVal}) saturate(${saturation}) brightness(${brightness})`,
    WebkitBackdropFilter: `blur(${blurVal}) saturate(${saturation}) brightness(${brightness})`,
    background: 'var(--glass-gradient)',
    border: 'var(--glass-border)',
    borderRadius: 'var(--radius-panel)',
    boxShadow: 'var(--glass-shadow), var(--glass-border-inner)',
    padding: '20px',
    position: 'relative',
    overflow: 'hidden',
    ...style,
  };

  const hoverClass = hoverable ? 'glass-card-hover' : '';
  const activeClass = interactive ? 'glass-card-active' : '';

  return (
    <div
      className={`glass-card-component ${hoverClass} ${activeClass} ${className}`}
      style={cardStyle}
      {...props}
    >
      {/* 隐藏的折射炫光微反光线（Glint） */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: '-150%',
          width: '60%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.035), transparent)',
          transform: 'skewX(-28deg)',
          pointerEvents: 'none',
          animation: 'shimmerGlint 12s ease-in-out infinite',
        }}
      />
      {children}
    </div>
  );
};
export default GlassCard;
