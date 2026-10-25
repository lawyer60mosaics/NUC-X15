import { CurvePoint } from '../hooks/useFanControl';
import { SystemPowerParameters } from '../hooks/usePower';
import { FanControlBackend } from '../types/appSettings';
import type { AuthorHardwareReadback } from '../hooks/useVendorService';

export type SensorValue = number | '--';

export interface PowerSectionProps {
  view: 'overview' | 'fan' | 'performance';
  onNavigate: (view: 'overview' | 'fan' | 'performance') => void;
  cpuTemp: SensorValue;
  gpuTemp: SensorValue;
  cpuFanRpm: SensorValue;
  gpuFanRpm: SensorValue;
  running: boolean;
  toggleControl: () => void;
  fanControlBackend: FanControlBackend;
  selectedScenario: string;
  onSelectFanScenario: (scenario: string) => void;
  constantSpeedEnabled: boolean;
  setConstantSpeedEnabled: (enabled: boolean) => void;
  constantSpeed: number;
  setConstantSpeed: (speed: number) => void;
  cpuCurve: CurvePoint[];
  gpuCurve: CurvePoint[];
  setCpuCurve: (curve: CurvePoint[]) => void;
  setGpuCurve: (curve: CurvePoint[]) => void;
  saveFanConfig: () => void;
  resetCurveToScenario: (scenario: string) => void;
  fanBusy: boolean;
  cpuPowerSustainedW: number;
  cpuPowerBoostW: number;
  gpuPowerSustainedW: number;
  gpuPowerBoostW: number;
  systemPowerParameters: SystemPowerParameters | null;
  authorBridgeAvailable: boolean;
  authorBridgeDetail: string;
  vendorServiceConnected: boolean;
  authorPowerPreset: string | null;
  authorReadback: AuthorHardwareReadback | null;
  authorPowerPlan: string | null;
  authorBenchmarkEnabled: boolean | null;
  authorBridgeBusy: boolean;
  applyAuthorPowerProfile: (mode: string) => Promise<boolean>;
  applyAuthorBenchmarkMode: (enabled: boolean) => Promise<boolean>;
  applyAuthorPowerPlan: (mode: string) => Promise<boolean>;
  language?: 'en' | 'zh';
}

export type FanControlSectionProps = Pick<PowerSectionProps,
  | 'cpuTemp' | 'gpuTemp' | 'cpuFanRpm' | 'gpuFanRpm' | 'running'
  | 'toggleControl' | 'fanControlBackend' | 'selectedScenario'
  | 'onSelectFanScenario' | 'constantSpeedEnabled' | 'setConstantSpeedEnabled'
  | 'constantSpeed' | 'setConstantSpeed' | 'cpuCurve' | 'gpuCurve'
  | 'setCpuCurve' | 'setGpuCurve' | 'saveFanConfig' | 'resetCurveToScenario'
  | 'fanBusy' | 'language'
>;

export type PerformanceSectionProps = Pick<PowerSectionProps,
  | 'selectedScenario' | 'cpuPowerSustainedW' | 'cpuPowerBoostW'
  | 'gpuPowerSustainedW' | 'gpuPowerBoostW' | 'systemPowerParameters'
  | 'authorBridgeAvailable' | 'authorBridgeDetail' | 'vendorServiceConnected'
  | 'authorPowerPreset' | 'authorReadback'
  | 'authorPowerPlan' | 'authorBenchmarkEnabled' | 'authorBridgeBusy'
  | 'applyAuthorPowerProfile' | 'applyAuthorBenchmarkMode' | 'applyAuthorPowerPlan'
  | 'language'
>;
