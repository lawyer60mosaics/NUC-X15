import React from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  busyText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmText = 'CONFIRM',
  cancelText = 'CANCEL',
  busyText = 'PROCESSING...',
  busy = false,
  onConfirm,
  onCancel,
}) => (
  <div className="confirm-dialog-backdrop" role="presentation">
    <div
      className="confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <div className="confirm-dialog-marker" aria-hidden="true" />
      <div className="confirm-dialog-body">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-message">{message}</p>
      </div>
      <div className="confirm-dialog-actions">
        <button className="confirm-dialog-button secondary" type="button" onClick={onCancel}>
          {cancelText}
        </button>
        <button
          className="confirm-dialog-button primary"
          type="button"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? busyText : confirmText}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmDialog;
