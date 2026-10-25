import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';
import { useFanControl } from './hooks/useFanControl';
import { usePower } from './hooks/usePower';
import { useVendorService } from './hooks/useVendorService';
import { StudioDashboard } from './components/studio/StudioDashboard';
import { StudioEcPage } from './components/studio/StudioEcPage';
import { StudioDisplayPage, StudioKeyboardPage, StudioLightbarPage, StudioMonitorPage, StudioPerformancePage } from './components/studio/StudioPages';
import type { StudioPage } from './components/studio/StudioAtoms';

type Notice = { id: number; text: string };

export default function StudioApp() {
  const [page, setPage] = useState<StudioPage>('home');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const showToast = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);
  const fan = useFanControl(showToast);
  const power = usePower(showToast);
  const vendor = useVendorService(showToast);
  const hardware = { fan, power, vendor };

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice((current) => current?.id === notice.id ? null : current), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const windowAction = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    if (!isTauri()) return;
    void getCurrentWindow()[action]();
  };

  return <div className="nss-app">
    <header className="nss-titlebar" data-tauri-drag-region>
      <div className="nss-title-brand" data-tauri-drag-region><span>nuc</span><strong>NUCtool 软件工作室</strong></div>
      <div className="nss-title-actions"><button type="button" aria-label="关于 NUCtool" title="关于" onClick={() => setAboutOpen(true)}>⚙</button><button type="button" aria-label="最小化" onClick={() => windowAction('minimize')}>—</button><button type="button" aria-label="最大化" onClick={() => windowAction('toggleMaximize')}>□</button><button type="button" aria-label="关闭" onClick={() => windowAction('close')}>×</button></div>
    </header>
    <main className="nss-main">
      {page === 'home' && <StudioDashboard {...hardware} navigate={setPage} />}
      {page === 'ec' && <StudioEcPage fan={fan} onHome={() => setPage('home')} />}
      {page === 'performance' && <StudioPerformancePage {...hardware} onHome={() => setPage('home')} />}
      {page === 'display' && <StudioDisplayPage {...hardware} onHome={() => setPage('home')} />}
      {page === 'keyboard' && <StudioKeyboardPage {...hardware} onHome={() => setPage('home')} />}
      {page === 'lightbar' && <StudioLightbarPage {...hardware} onHome={() => setPage('home')} />}
      {page === 'monitor' && <StudioMonitorPage {...hardware} onHome={() => setPage('home')} />}
    </main>
    {aboutOpen && <div className="nss-modal-backdrop" onMouseDown={() => setAboutOpen(false)}><div className="nss-about" role="dialog" aria-modal="true" aria-label="关于 NUCtool" onMouseDown={(e) => e.stopPropagation()}><button type="button" className="nss-about-close" onClick={() => setAboutOpen(false)} aria-label="关闭关于">×</button><strong>NUCtool 软件工作室</strong><p>参考 Intel NUC Software Studio 的界面布局设计。</p><p>这是独立项目，并非 Intel 官方软件。</p><button type="button" onClick={() => setAboutOpen(false)}>关闭</button></div></div>}
    {notice && <div className="nss-toast" role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
  </div>;
}
