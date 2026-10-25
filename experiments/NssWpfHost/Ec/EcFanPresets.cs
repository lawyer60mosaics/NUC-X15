using System;

namespace NssWpfHost.Ec
{
    public enum EcFanPreset { Quiet, Balanced, Performance }

    public sealed class EcFanCurveProfile
    {
        private readonly int[] _cpu;
        private readonly int[] _gpu;
        public EcFanPreset Preset { get; }
        public string Name { get; }
        public string Description { get; }
        public int RampUp { get; }
        public int RampDown { get; }

        internal EcFanCurveProfile(EcFanPreset preset, string name, string description,
            int[] cpu, int[] gpu, int rampUp, int rampDown)
        {
            Preset = preset; Name = name; Description = description;
            _cpu = cpu; _gpu = gpu; RampUp = rampUp; RampDown = rampDown;
        }

        // Existing NUCtool presets use 35..85 C in 5 C steps. Keep those curves,
        // interpolating between points; the controller applies thermal overrides.
        public int CpuSpeed(int temperature) => Interpolate(temperature, _cpu);
        public int GpuSpeed(int temperature) => Interpolate(temperature, _gpu);

        private static int Interpolate(int temperature, int[] speeds)
        {
            if (temperature <= 35) return speeds[0];
            if (temperature >= 85) return speeds[speeds.Length - 1];
            var index = (temperature - 35) / 5;
            var remainder = (temperature - 35) % 5;
            return speeds[index] + (speeds[index + 1] - speeds[index]) * remainder / 5;
        }
    }

    public static class EcFanPresets
    {
        private static readonly EcFanCurveProfile Quiet = new EcFanCurveProfile(EcFanPreset.Quiet,
            "静音", "低噪声优先，风扇加减速更缓和；高温时仍会自动提高转速。",
            new[] { 20,20,24,29,34,39,44,48,50,50,50 },
            new[] { 20,20,23,28,33,39,44,48,50,50,50 }, 2, 2);
        private static readonly EcFanCurveProfile Balanced = new EcFanCurveProfile(EcFanPreset.Balanced,
            "平衡", "兼顾日常噪声与散热，按 CPU 和显卡温度分别调节。",
            new[] { 25,28,34,42,50,58,66,72,76,79,80 },
            new[] { 25,29,36,44,52,60,68,74,78,80,80 }, 5, 5);
        private static readonly EcFanCurveProfile Performance = new EcFanCurveProfile(EcFanPreset.Performance,
            "性能", "散热优先，较早提高风扇速度、快速响应负载升温。",
            new[] { 35,40,48,58,68,76,84,90,95,98,100 },
            new[] { 35,42,52,62,72,82,90,95,98,100,100 }, 10, 6);

        public static EcFanCurveProfile Get(EcFanPreset preset)
        {
            switch (preset)
            {
                case EcFanPreset.Quiet: return Quiet;
                case EcFanPreset.Balanced: return Balanced;
                case EcFanPreset.Performance: return Performance;
                default: throw new ArgumentOutOfRangeException(nameof(preset), "未知 EC 风扇档位。");
            }
        }
    }
}
