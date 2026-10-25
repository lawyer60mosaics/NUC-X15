import React from 'react';

interface SurfaceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  interactive?: boolean;
  children: React.ReactNode;
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({
  hoverable = false,
  interactive = false,
  children,
  className = '',
  ...props
}) => (
  <div
    className={`surface-card ${hoverable ? 'surface-card-hover' : ''} ${interactive ? 'surface-card-interactive' : ''} ${className}`}
    {...props}
  >
    {children}
  </div>
);

export default SurfaceCard;
