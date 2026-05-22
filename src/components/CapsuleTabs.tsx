import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  subtitle?: string;
  index: number;
}

interface CapsuleTabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export const CapsuleTabs: React.FC<CapsuleTabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = '',
}) => {
  return (
    <nav className={`capsule-tabs-nav ${className}`} style={{ width: '100%' }}>
      <div 
        className="capsule-tabs-container" 
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          gap: '8px',
          background: 'rgba(0, 0, 0, 0.18)',
          border: '1px solid rgba(255, 255, 255, 0.04)',
          borderRadius: '16px',
          padding: '6px',
          position: 'relative',
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              style={{
                background: isActive ? 'var(--glass-gradient-hover)' : 'transparent',
                border: isActive ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
                boxShadow: isActive ? '0 6px 20px rgba(0, 0, 0, 0.2), 0 1px 0 rgba(255,255,255,0.04) inset' : 'none',
                borderRadius: '12px',
                padding: '10px 14px',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                outline: 'none',
                position: 'relative',
                zIndex: 2,
              }}
            >
              {/* iOS 风格的数字圆圈微标 */}
              <div 
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: isActive ? 'var(--accent-color)' : 'rgba(255,255,255,0.06)',
                  color: isActive ? '#040812' : 'var(--text-secondary)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '12px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {tab.index}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1.2 }}>{tab.label}</span>
                {tab.subtitle && (
                  <span style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tab.subtitle}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
export default CapsuleTabs;
