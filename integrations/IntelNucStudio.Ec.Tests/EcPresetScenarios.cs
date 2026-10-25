using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NssWpfHost.Ec;

namespace IntelNucStudio.Ec.Tests
{
    internal static class EcPresetScenarios
    {
        public static async Task RunAsync(Action<string> pass)
        {
            var quiet = EcFanPresets.Get(EcFanPreset.Quiet);
            var balanced = EcFanPresets.Get(EcFanPreset.Balanced);
            var performance = EcFanPresets.Get(EcFanPreset.Performance);
            for (var temperature = 1; temperature <= 105; temperature++)
            {
                Assert(quiet.CpuSpeed(temperature) >= 20 && performance.CpuSpeed(temperature) <= 100, "CPU range");
                Assert(quiet.GpuSpeed(temperature) >= 20 && performance.GpuSpeed(temperature) <= 100, "GPU range");
                Assert(quiet.CpuSpeed(temperature) <= balanced.CpuSpeed(temperature)
                    && balanced.CpuSpeed(temperature) <= performance.CpuSpeed(temperature), "CPU preset ordering");
                Assert(quiet.GpuSpeed(temperature) <= balanced.GpuSpeed(temperature)
                    && balanced.GpuSpeed(temperature) <= performance.GpuSpeed(temperature), "GPU preset ordering");
            }
            Assert(quiet.CpuSpeed(60) < balanced.CpuSpeed(60) && balanced.CpuSpeed(60) < performance.CpuSpeed(60), "Distinct CPU curves");
            Assert(quiet.GpuSpeed(60) < balanced.GpuSpeed(60) && balanced.GpuSpeed(60) < performance.GpuSpeed(60), "Distinct GPU curves");
            pass("Three CPU/GPU curves remain bounded, ordered and distinct");

            using (var ticks = new SemaphoreSlim(0))
            using (var transport = new MemoryEcTransport())
            using (var module = new EcFanModule(transport, () => Task.FromResult("LAPKC71E"), token => ticks.WaitAsync(token)))
            {
                await module.StartCurveControlAsync(EcFanPreset.Quiet, null, null);
                Assert(module.ActivePreset == EcFanPreset.Quiet && transport.FanWrites.Count == 2, "Initial quiet cycle");
                var count = transport.FanWrites.Count;
                foreach (var preset in new[] { EcFanPreset.Performance, EcFanPreset.Balanced, EcFanPreset.Quiet })
                {
                    await module.StartCurveControlAsync(preset, null, null);
                    ticks.Release();
                    count += 2;
                    await Until(() => transport.FanWrites.Count >= count);
                    Assert(module.ActivePreset == preset, "Hot swap active preset");
                }
                Assert(transport.ManualRequests == 1 && transport.AutoRequests == 0, "Hot swaps must retain EC ownership");
                await module.StopCurveControlAsync();
                Assert(transport.AutoRequests == 1 && !module.IsManualControlRequested && module.ActivePreset == null, "Stop must hand off once");
            }
            pass("Production EC loop hot-swaps all presets without auto/manual gaps");

            foreach (EcFanPreset preset in Enum.GetValues(typeof(EcFanPreset)))
            {
                using (var transport = new MemoryEcTransport { CpuTemperature = 95, GpuTemperature = 30 })
                using (var module = new EcFanModule(transport, () => Task.FromResult("LAPKC71E"), token => Task.Delay(Timeout.Infinite, token)))
                {
                    await module.StartCurveControlAsync(preset, null, null);
                    Assert(transport.FanWrites.Count == 2 && transport.FanWrites.All(value => value == 200), "Emergency must force both fans to 100%");
                    await module.StopCurveControlAsync();
                }
            }
            pass("Emergency temperature overrides quiet, balanced and performance limits");

            using (var transport = new MemoryEcTransport())
            using (var module = new EcFanModule(transport, () => Task.FromResult("UNSUPPORTED"), token => Task.Delay(Timeout.Infinite, token)))
            {
                var invalidPresetRejected = false;
                try { await module.StartCurveControlAsync((EcFanPreset)99, null, null); } catch (ArgumentOutOfRangeException) { invalidPresetRejected = true; }
                var unsupportedRejected = false;
                try { await module.StartCurveControlAsync(EcFanPreset.Quiet, null, null); } catch (NotSupportedException) { unsupportedRejected = true; }
                Assert(invalidPresetRejected && unsupportedRejected && transport.ManualRequests == 0 && transport.FanWrites.IsEmpty,
                    "Unsupported input must fail before EC writes");
            }
            pass("Unknown presets and unsupported models are rejected before writes");

            using (var ticks = new SemaphoreSlim(0))
            using (var transport = new MemoryEcTransport())
            using (var module = new EcFanModule(transport, () => Task.FromResult("LAPKC71E"), token => ticks.WaitAsync(token)))
            {
                var messages = new ConcurrentQueue<string>();
                await module.StartCurveControlAsync(EcFanPreset.Quiet, messages.Enqueue, null);
                transport.FailReads = transport.FailAuto = true;
                ticks.Release();
                await Until(() => messages.Any(value => value.Contains("恢复 EC 自动模式失败")));
                Assert(!module.IsCurveControlRunning && module.IsManualControlRequested && messages.Last().Contains("恢复 EC 自动模式失败"),
                    "Recovery failure must retain ownership and its failure message");
                transport.FailAuto = false;
                await module.StopCurveControlAsync();
                Assert(!module.IsManualControlRequested, "Retry should hand off ownership");
            }
            pass("Loop failure retains ownership on failed recovery and supports retry");
        }

        private static async Task Until(Func<bool> condition)
        {
            var deadline = DateTime.UtcNow.AddSeconds(3);
            while (!condition())
            {
                if (DateTime.UtcNow > deadline) throw new Exception("Timed out waiting for EC sample");
                await Task.Delay(5);
            }
        }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    }

    internal sealed class MemoryEcTransport : IEcTransport
    {
        public int CpuTemperature = 60;
        public int GpuTemperature = 55;
        public volatile bool FailReads;
        public volatile bool FailAuto;
        public int ManualRequests;
        public int AutoRequests;
        public readonly ConcurrentQueue<int> FanWrites = new ConcurrentQueue<int>();

        public Task<long> ExecuteAsync(string payload)
        {
            var data = ulong.Parse(payload.Substring(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
            var address = (int)(data & 0xffff);
            if (payload.StartsWith("0x000001", StringComparison.Ordinal))
            {
                if (FailReads) return Task.FromException<long>(new InvalidOperationException("Simulated sensor failure"));
                switch (address)
                {
                    case 0x043E: return Task.FromResult((long)CpuTemperature);
                    case 0x044F: return Task.FromResult((long)GpuTemperature);
                    case 0x0464: return Task.FromResult(7L);
                    case 0x0465: return Task.FromResult(8L);
                    case 0x046C: return Task.FromResult(6L);
                    case 0x046D: return Task.FromResult(64L);
                    default: return Task.FromResult(80L);
                }
            }
            if (address == 0x1809 || address == 0x1804) FanWrites.Enqueue((int)((data >> 16) & 0xff));
            else if (data == 0xA00751)
            {
                Interlocked.Increment(ref AutoRequests);
                if (FailAuto) return Task.FromException<long>(new InvalidOperationException("Simulated auto failure"));
            }
            else if (address == 0x0751) Interlocked.Increment(ref ManualRequests);
            return Task.FromResult(1L);
        }
        public void Dispose() { }
    }
}
