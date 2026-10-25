import type { useFanControl } from '../../hooks/useFanControl';
import type { usePower } from '../../hooks/usePower';
import type { useVendorService } from '../../hooks/useVendorService';

export type StudioFan = ReturnType<typeof useFanControl>;
export type StudioPower = ReturnType<typeof usePower>;
export type StudioVendor = ReturnType<typeof useVendorService>;

export interface StudioHardware {
  fan: StudioFan;
  power: StudioPower;
  vendor: StudioVendor;
}
