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
  const blurVal = intensity === 'low' ? '0px' : intensity === 'high' ? '0px' : '0px';
  const saturation = intensity === 'low' ? '100%' : intensity === 'high' ? '100%' : '100%';
  const brightness = intensity === 'low' ? '1' : intensity === 'high' ? '1' : '1';

  const cardStyle: React.CSSProperties = {
    backdropFilter: `blur(${blurVal}) saturate(${saturation}) brightness(${brightness})`,
    WebkitBackdropFilter: `blur(${blurVal}) saturate(${saturation}) brightness(${brightness})`,
    background: 'var(--glass-gradient)',
    border: 'var(--glass-border)',
    borderRadius: 'var(--radius-panel)',
    boxShadow: 'var(--glass-shadow), var(--glass-border-inner)',
    padding: '18px',
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
      {children}
    </div>
  );
};
export default GlassCard;
