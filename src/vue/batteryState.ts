export type BatteryChoice = 'best' | 'custom' | 'full';

export interface BatteryReadback {
  choice: BatteryChoice | null;
  label: string;
  detail: string;
  consistent: boolean | null;
}

function level(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 100 ? value : null;
}

export function batteryReadback(mode: unknown, serviceLevel: unknown, dllLevel: unknown): BatteryReadback {
  const service = level(serviceLevel);
  const dll = level(dllLevel);
  if (mode === 'BestBattery') {
    return { choice: 'best', label: '最佳电池健康', detail: '厂商模式已读回；DLL 保存的充电阈值不代表此模式的实际停止点', consistent: null };
  }
  if (mode === 'Custom') {
    if (service === null || dll === null) return { choice: 'custom', label: '自定义模式', detail: '厂商模式已读回，但充电阈值缺少完整读回', consistent: null };
    return { choice: 'custom', label: '自定义模式', detail: service === dll ? `厂商服务与 DLL 均读回 ${dll}%` : `阈值不一致：厂商服务 ${service}% · DLL ${dll}%`, consistent: service === dll };
  }
  if (mode === 'AcMode') {
    if (dll === null) return { choice: 'full', label: '充至 100%', detail: '厂商模式已读回，但 DLL 阈值未读到', consistent: null };
    return { choice: 'full', label: '充至 100%', detail: dll === 100 ? '厂商模式与 DLL 100% 阈值均已读回' : `阈值不一致：厂商模式为充满，DLL 仍为 ${dll}%`, consistent: dll === 100 };
  }
  return { choice: null, label: '模式未读到', detail: dll === null ? '厂商模式与 DLL 阈值均未读到' : `仅 DLL 阈值读回 ${dll}%；不能据此判断厂商模式`, consistent: null };
}
