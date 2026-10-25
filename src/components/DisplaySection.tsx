import React from 'react';

import { VendorDisplayMode, VendorDisplayModeId } from '../hooks/useVendorService';
import { tr } from '../i18n';
import OperationStatus, { OperationState } from './OperationStatus';

interface DisplaySectionProps {
  currentHz: number;
  supportedHz: number[];
  displayDevices: string[];
  displayDetail: string;
  vendorDisplayMode: VendorDisplayMode | null;
  vendorServiceConnected: boolean;
  displayBridgeAvailable: boolean;
  displayBridgeDetail: string;
  lastRequestedDisplayMode: VendorDisplayModeId | 'custom' | null;
  lastDisplayModeVerified: boolean;
  busy: boolean;
  language?: 'en' | 'zh';
  onApplyVisualScene: (scene: VendorDisplayModeId) => Promise<boolean>;
  onApplyHz: (hz: number) => Promise<boolean>;
}

const visualScenes: Array<{
  id: VendorDisplayModeId;
  serviceMode: string;
  zh: string;
  en: string;
  zhDetail: string;
  enDetail: string;
  resultZh: string;
  resultEn: string;
}> = [
  {
    id: 'standard', serviceMode: 'Standard', zh: '标准显示', en: 'STANDARD',
    zhDetail: '恢复厂商保存的通用显示参数，适合桌面和混合用途。',
    enDetail: 'Restores the vendor-saved general display parameters for mixed work.',
    resultZh: '通用色彩与对比度', resultEn: 'GENERAL COLOR BALANCE',
  },
  {
    id: 'reading', serviceMode: 'Reading', zh: '阅读护眼', en: 'READING',
    zhDetail: '使用厂商阅读模式的亮度、色温、对比度与 RGB 参数。',
    enDetail: 'Uses the vendor reading profile for brightness, color temperature, contrast, and RGB.',
    resultZh: '更柔和的阅读画面', resultEn: 'COMFORT-FOCUSED OUTPUT',
  },
  {
    id: 'video', serviceMode: 'Video', zh: '影视观影', en: 'VIDEO',
    zhDetail: '使用厂商影视模式的色彩与对比度参数，不强制修改 HDR。',
    enDetail: 'Uses the vendor video color and contrast parameters without forcing HDR.',
    resultZh: '影视色彩与对比度', resultEn: 'CINEMA COLOR TUNING',
  },
  {
    id: 'gaming', serviceMode: 'Gaming', zh: '游戏画面', en: 'GAMING',
    zhDetail: '使用厂商游戏模式；需要时可在下方另行提高刷新率。',
    enDetail: 'Uses the vendor gaming profile; raise refresh rate separately below when needed.',
    resultZh: '游戏图像预设', resultEn: 'GAME VISUAL PROFILE',
  },
];

const iconPaths: Record<VendorDisplayModeId, React.ReactNode> = {
  standard: <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 20h8m-4-2v2M7 9h10" /></>,
  reading: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H12v15H7.5A3.5 3.5 0 0 0 4 22V5.5Z" /><path d="M20 5.5A3.5 3.5 0 0 0 16.5 4H12v15h4.5A3.5 3.5 0 0 1 20 22V5.5Z" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></>,
  gaming: <><path d="M7 18h10" /><path d="M8 18 6 8h12l-2 10" /><path d="M9 11h2m-1-1v2m4-1h.01m2 0h.01" /></>,
};

const DisplayIcon = ({ scene }: { scene: VendorDisplayModeId }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{iconPaths[scene]}</svg>
);

const modeName = (mode: VendorDisplayMode | null, requested: VendorDisplayModeId | 'custom' | null, isZh: boolean) => {
  const modeType = mode?.type || requested;
  if (!modeType) return isZh ? '未读取' : 'NOT AVAILABLE';
  if (modeType.toLowerCase() === 'custom') return isZh ? '自定义显示' : 'CUSTOM';
  const found = visualScenes.find((scene) => scene.serviceMode.toLowerCase() === modeType.toLowerCase());
  return found ? (isZh ? found.zh : found.en) : modeType.toUpperCase();
};

export const DisplaySection: React.FC<DisplaySectionProps> = ({
  currentHz,
  supportedHz,
  displayDevices,
  displayDetail,
  vendorDisplayMode,
  vendorServiceConnected,
  displayBridgeAvailable,
  displayBridgeDetail,
  lastRequestedDisplayMode,
  lastDisplayModeVerified,
  busy,
  language = 'en',
  onApplyVisualScene,
  onApplyHz,
}) => {
  const isZh = language === 'zh';
  const availableHz = Array.from(new Set(supportedHz.filter((hz) => Number.isFinite(hz) && hz > 0))).sort((a, b) => a - b);
  const requestAwaitingReadback = Boolean(lastRequestedDisplayMode && !lastDisplayModeVerified);
  const currentMode = vendorDisplayMode?.type?.toLowerCase() || '';
  const displayCount = displayDevices.length;
  // SDK readback can fail independently of the DLL transport; allow a request
  // whenever the reviewed DLL is present, then report its effect as unverified.
  const displayModeAvailable = displayBridgeAvailable;
  const hasReadback = Boolean(vendorDisplayMode);
  const visualStatus: OperationState = !displayModeAvailable
    ? 'unavailable'
    : lastRequestedDisplayMode
      ? (lastDisplayModeVerified ? 'readback' : 'requested')
      : hasReadback ? 'readback' : 'unavailable';

  return (
    <div className="dashboard-section display-dashboard">
      <div className="section-intro">
        <span className="section-kicker">04 / {isZh ? '显示' : 'DISPLAY'}</span>
        <h2>{isZh ? '画质场景' : 'VISUAL PROFILES'}</h2>
        <p>{isZh ? '画质模式只通过 NUCtool.dll 请求；刷新率由 Windows 独立控制。' : 'Visual modes use NUCtool.dll only; Windows controls refresh rate separately.'}</p>
      </div>

      <OperationStatus
        owner="NUCtool.dll"
        state={visualStatus}
        language={language}
        detail={visualStatus === 'unavailable'
          ? (isZh ? `画质模式不会自动改走其他控制路径。DLL：${displayBridgeDetail}；原厂服务接口${vendorServiceConnected ? '可读' : '暂不可读'}。${displayBridgeAvailable ? '仍可发送 DLL 请求，但效果无法确认。' : '无法发送 DLL 请求。'}` : `No silent fallback. DLL: ${displayBridgeDetail}; vendor-service API ${vendorServiceConnected ? 'reachable' : 'readback unavailable'}. ${displayBridgeAvailable ? 'A DLL request can still be sent, but its effect cannot be confirmed.' : 'A DLL request cannot be sent.'}`)
          : visualStatus === 'requested'
            ? (isZh ? '画质模式接口没有可靠回读，发出请求不代表画面效果已确认。' : 'This mode has no reliable readback; a sent request does not confirm the visual result.')
            : (isZh ? '显示参数来自厂商服务回读。' : 'Display parameters were read back from the vendor service.')}
      />

      <section className="display-live-strip" aria-label={tr(language, 'Current visual status', '当前画质状态')}>
        <article>
          <span>{requestAwaitingReadback ? (isZh ? '最近请求的图像模式' : 'LAST REQUESTED VISUAL MODE') : (isZh ? '当前图像模式' : 'CURRENT VISUAL MODE')}</span>
          <strong className="display-live-label">{modeName(requestAwaitingReadback ? null : vendorDisplayMode, lastRequestedDisplayMode, isZh)}</strong>
          <small>{requestAwaitingReadback ? (isZh ? 'DLL 请求已发送，无可靠回读' : 'DLL REQUEST SENT · NO READBACK') : hasReadback ? (isZh ? '原厂服务接口回读' : 'VENDOR SERVICE API READBACK') : lastRequestedDisplayMode ? (isZh ? '已验证' : 'VERIFIED') : (isZh ? '尚未选择画质模式' : 'NO PROFILE REQUESTED')}</small>
        </article>
        <article>
          <span>{requestAwaitingReadback ? (isZh ? '上次读回参数' : 'LAST READ PARAMETERS') : (isZh ? '当前参数' : 'PROFILE PARAMETERS')}</span>
          <strong className="display-live-label">{vendorDisplayMode ? `${vendorDisplayMode.colorTemp}K / ${Math.round(vendorDisplayMode.contrast * 100)}%` : '--'}</strong>
          <small>{vendorDisplayMode ? `${isZh ? '亮度' : 'BRIGHTNESS'} ${vendorDisplayMode.brightnessAc}% · RGB ${vendorDisplayMode.red}/${vendorDisplayMode.green}/${vendorDisplayMode.blue}` : displayBridgeAvailable ? (isZh ? 'DLL 固定模式编号；暂无参数回读' : 'DLL FIXED MODE · NO PARAMETER READBACK') : (isZh ? '等待厂商服务回读' : 'WAITING FOR VENDOR READBACK')}</small>
        </article>
        <article>
          <span>{isZh ? '当前刷新率' : 'CURRENT REFRESH'}</span>
          <strong>{currentHz || '--'}<small>Hz</small></strong>
          <small>{isZh ? 'Windows 显示接口回读' : 'WINDOWS DISPLAY READBACK'}</small>
        </article>
      </section>

      <section className="panel display-scene-panel">
        <div className="panel-header compact">
          <div>
            <span className="panel-kicker">{isZh ? '作者兼容显示模式' : 'AUTHOR-COMPATIBLE VISUAL MODES'}</span>
            <h3>{isZh ? '选择当前内容类型' : 'CHOOSE THE CONTENT TYPE'}</h3>
            <p>{isZh ? '遵循作者逻辑：开启显示管理后直接写入固定编号（标准 0、游戏 1、影视 2、阅读 3）。' : 'Matches the author logic: enable display management, then write fixed indices (Standard 0, Gaming 1, Video 2, Reading 3).'}</p>
          </div>
          <span className="display-write-badge">{busy ? (isZh ? '正在应用' : 'APPLYING') : displayBridgeAvailable ? 'NUCtool.dll' : (isZh ? '暂不可用' : 'UNAVAILABLE')}</span>
        </div>

        <div className="display-scene-grid display-visual-scene-grid">
          {visualScenes.map((scene) => {
            const active = !requestAwaitingReadback && currentMode === scene.serviceMode.toLowerCase();
            const requested = requestAwaitingReadback && lastRequestedDisplayMode === scene.id;
            return (
              <button
                className={`display-scene-card ${active ? 'is-active' : ''} ${requested ? 'is-requested' : ''}`}
                key={scene.id}
                type="button"
                aria-pressed={active}
                disabled={busy || !displayModeAvailable}
                onClick={() => { void onApplyVisualScene(scene.id); }}
              >
                <span className="display-scene-icon"><DisplayIcon scene={scene.id} /></span>
                <span className="display-scene-copy">
                  <small>{isZh ? scene.resultZh : scene.resultEn}</small>
                  <strong>{isZh ? scene.zh : scene.en}</strong>
                  <em>{isZh ? scene.zhDetail : scene.enDetail}</em>
                  {requested && <span className="display-request-badge">{isZh ? '最近请求 · 未验证' : 'LAST REQUEST · UNVERIFIED'}</span>}
                </span>
                <i aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <div className={`display-scene-note ${displayModeAvailable ? '' : 'is-warning'}`}>
          <strong>{isZh ? '不包含的设置' : 'NOT INCLUDED'}</strong>
          <span>{isZh ? 'HDR、夜间模式、ICC 校色由 Windows 或 Intel Graphics 管理；刷新率在下方单独调整。' : 'HDR, Night Light, and ICC calibration stay in Windows or Intel Graphics. Refresh rate is adjusted separately below.'}</span>
        </div>
      </section>

      <section className="panel display-tuning-panel">
        <div className="panel-header compact">
          <div>
            <span className="panel-kicker">{isZh ? '刷新率辅助控制' : 'REFRESH-RATE ASSIST'}</span>
            <h3>{isZh ? '指定刷新率' : 'SET REFRESH RATE'}</h3>
            <p>{isZh ? '刷新率不再随着影视或阅读模式自动变化；只在你明确选择时才由 Windows 显示接口写入。' : 'Refresh rate no longer changes with video or reading modes; Windows is written only when you explicitly select a rate.'}</p>
          </div>
        </div>
        <div className="display-tuning-grid">
          <label>
            <span className="form-label">{isZh ? '刷新率' : 'REFRESH RATE'}</span>
            <select
              className="form-select"
              value={availableHz.includes(currentHz) ? currentHz : ''}
              disabled={busy || availableHz.length === 0}
              onChange={(event) => { void onApplyHz(Number(event.target.value)); }}
              aria-label={isZh ? '选择显示刷新率' : 'Select display refresh rate'}
            >
              {!availableHz.includes(currentHz) && <option value="">{currentHz ? `${currentHz}Hz` : '--'}</option>}
              {availableHz.map((hz) => <option key={hz} value={hz}>{hz}Hz</option>)}
            </select>
          </label>
          <div className="display-device-readback">
            <span>{isZh ? '活动显示器' : 'ACTIVE DISPLAY'}</span>
            <strong>{displayCount ? `${displayCount} ${isZh ? '台' : 'DISPLAY'}${displayCount > 1 && !isZh ? 'S' : ''}` : (isZh ? '默认显示器' : 'DEFAULT DISPLAY')}</strong>
            <small>{displayDetail || (isZh ? '正在读取显示设备信息' : 'READING DISPLAY DEVICE INFORMATION')}</small>
          </div>
        </div>
        {displayDevices.length > 0 && (
          <div className="display-device-list">
            {displayDevices.map((device, index) => <span key={`${device}-${index}`}>{device}</span>)}
          </div>
        )}
      </section>
    </div>
  );
};

export default DisplaySection;
