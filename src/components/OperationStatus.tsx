import React from 'react';

export type OperationState = 'readback' | 'requested' | 'unavailable';
export type OperationOwner = 'EC' | 'NUCtool.dll' | 'Windows';

interface OperationStatusProps {
  owner: OperationOwner;
  state: OperationState;
  language: 'en' | 'zh';
  detail?: string;
  className?: string;
}

const labels: Record<OperationState, { zh: string; en: string }> = {
  readback: { zh: '硬件已读回', en: 'HARDWARE READBACK' },
  requested: { zh: '请求已发送，无法确认', en: 'REQUEST SENT · UNVERIFIED' },
  unavailable: { zh: '暂不可用', en: 'TEMPORARILY UNAVAILABLE' },
};

export const OperationStatus: React.FC<OperationStatusProps> = ({
  owner,
  state,
  language,
  detail,
  className = '',
}) => (
  <div className={`operation-status is-${state} ${className}`.trim()} role="status" aria-live="polite" aria-atomic="true">
    <span className="operation-status-owner">{owner}</span>
    <span className="operation-status-label">{labels[state][language]}</span>
    {detail && <span className="operation-status-detail">{detail}</span>}
  </div>
);

export default OperationStatus;
