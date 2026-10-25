using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

namespace NssWpfHost.Ec
{
    public sealed class EcFanSnapshot
    {
        public string Model { get; internal set; }
        public int CpuTemperatureC { get; internal set; }
        public int GpuTemperatureC { get; internal set; }
        public int LeftFanRpm { get; internal set; }
        public int RightFanRpm { get; internal set; }
        public long RawMode { get; internal set; }
    }

    /// <summary>In-process WPF feature module for the existing Uniwill EC fan protocol.</summary>
    public sealed class EcFanModule : IDisposable
    {
        private const long EcCommunicationFailure = 0xFEFEFEFE;
        private const int MinimumFanPercent = 20;
        private const int ThermalBoostC = 78;
        private const int ThermalProtectC = 88;
        private const int ThermalEmergencyC = 95;
        private readonly EcWmiSession _wmi = new EcWmiSession();
        private readonly SemaphoreSlim _hardwareGate = new SemaphoreSlim(1, 1);
        private readonly SemaphoreSlim _curveLifecycleGate = new SemaphoreSlim(1, 1);
        private string _model;
        private bool _manualRequested;
        private CancellationTokenSource _curveCancellation;
        private Task _curveTask = Task.CompletedTask;
        private volatile bool _curveRunning;

        public bool IsCurveControlRunning => _curveRunning;

        public async Task<EcFanSnapshot> ReadSnapshotAsync()
        {
            var model = await GetModelAsync().ConfigureAwait(false);
            var isAc71H = model.Equals("LAPAC71H", StringComparison.OrdinalIgnoreCase);
            var leftHighAddress = isAc71H ? 0x046C : 0x0464;
            var leftLowAddress = isAc71H ? 0x046D : 0x0465;
            var rightHighAddress = isAc71H ? 0x0464 : 0x046C;
            var rightLowAddress = isAc71H ? 0x0465 : 0x046D;

            var values = await Task.WhenAll(
                ReadByteAsync(0x043E), ReadByteAsync(0x044F),
                ReadByteAsync(leftHighAddress), ReadByteAsync(leftLowAddress),
                ReadByteAsync(rightHighAddress), ReadByteAsync(rightLowAddress),
                ExecuteAsync("0x0000010000000751")).ConfigureAwait(false);

            return new EcFanSnapshot
            {
                Model = model,
                CpuTemperatureC = checked((int)values[0]),
                GpuTemperatureC = checked((int)values[1]),
                LeftFanRpm = NormalizeRpm(CombineFanBytes(values[2], values[3])),
                RightFanRpm = NormalizeRpm(CombineFanBytes(values[4], values[5])),
                RawMode = values[6]
            };
        }

        public async Task SetManualControlAsync()
        {
            if (_curveRunning)
                throw new InvalidOperationException("EC 温控曲线正在运行，请先停止曲线控制。");
            await _hardwareGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (_curveRunning)
                    throw new InvalidOperationException("EC 温控曲线正在运行，请先停止曲线控制。");
                var model = await GetModelAsync().ConfigureAwait(false);
                var payload = model.Equals("LAPAC71H", StringComparison.OrdinalIgnoreCase)
                    ? "0x0000000000400751"
                    : "0x0000000000500751";
                EnsureCallSucceeded(await ExecuteAsync(payload).ConfigureAwait(false), "EC 手动风扇接管");
                _manualRequested = true;
            }
            finally { _hardwareGate.Release(); }
        }

        public async Task StartCurveControlAsync(Action<string> statusChanged, Action<EcFanSnapshot> snapshotUpdated)
        {
            await _curveLifecycleGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (_curveRunning) return;
                await _curveTask.ConfigureAwait(false);
                _curveCancellation?.Dispose();
                _curveCancellation = null;

                await SetManualControlAsync().ConfigureAwait(false);
                _curveCancellation = new CancellationTokenSource();
                _curveRunning = true;
                _curveTask = RunCurveControlAsync(_curveCancellation.Token, statusChanged, snapshotUpdated);
            }
            finally { _curveLifecycleGate.Release(); }
        }

        public async Task StopCurveControlAsync()
        {
            await _curveLifecycleGate.WaitAsync().ConfigureAwait(false);
            try
            {
                _curveCancellation?.Cancel();
                try { await _curveTask.ConfigureAwait(false); } catch { }
                _curveCancellation?.Dispose();
                _curveCancellation = null;
                await ReturnToEcAutoAsync().ConfigureAwait(false);
            }
            finally { _curveLifecycleGate.Release(); }
        }

        public Task<bool> SetFanPercentAsync(int leftPercent, int rightPercent) =>
            SetFanPercentCoreAsync(leftPercent, rightPercent, false);

        private async Task<bool> SetFanPercentCoreAsync(int leftPercent, int rightPercent, bool fromCurve)
        {
            if (leftPercent < 0 || leftPercent > 100 || rightPercent < 0 || rightPercent > 100)
                throw new ArgumentOutOfRangeException("Fan percentages must be between 0 and 100.");
            if (_curveRunning && !fromCurve)
                throw new InvalidOperationException("EC 温控曲线正在运行，请先停止曲线控制。");

            await _hardwareGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (_curveRunning && !fromCurve)
                    throw new InvalidOperationException("EC 温控曲线正在运行，请先停止曲线控制。");
                if (!_manualRequested)
                    throw new InvalidOperationException("请先请求 EC 手动接管，再调整风扇速度。");
                var model = await GetModelAsync().ConfigureAwait(false);
                var cpuTemp = await ReadByteAsync(0x043E).ConfigureAwait(false);
                var gpuTemp = await ReadByteAsync(0x044F).ConfigureAwait(false);
                if (cpuTemp < 1 || cpuTemp > 105 || gpuTemp < 1 || gpuTemp > 105)
                {
                    var autoRestoreRequested = false;
                    try { autoRestoreRequested = !IsFailure(await _wmi.ExecuteAsync("0x0000000000A00751").ConfigureAwait(false)); }
                    catch { }
                    _manualRequested = !autoRestoreRequested;
                    var recovery = autoRestoreRequested ? "已请求交还 EC 自动控制" : "交还 EC 自动控制请求失败，请手动重试";
                    throw new InvalidOperationException("温度读数无效，拒绝手动调速；" + recovery + "。");
                }
                if (cpuTemp >= ThermalEmergencyC || gpuTemp >= ThermalEmergencyC)
                {
                    await WriteBothFansAsync(model, 100, 100).ConfigureAwait(false);
                    return true;
                }
                var thermalOverride = cpuTemp >= ThermalBoostC || gpuTemp >= ThermalBoostC;
                leftPercent = Math.Max(leftPercent, MinimumSafeSpeed((int)cpuTemp));
                rightPercent = Math.Max(rightPercent, MinimumSafeSpeed((int)gpuTemp));
                if (cpuTemp >= ThermalProtectC) leftPercent = 100;
                if (gpuTemp >= ThermalProtectC) rightPercent = 100;

                await WriteBothFansAsync(model, leftPercent, rightPercent).ConfigureAwait(false);
                return thermalOverride;
            }
            finally { _hardwareGate.Release(); }
        }

        private async Task RunCurveControlAsync(CancellationToken cancellationToken, Action<string> statusChanged,
            Action<EcFanSnapshot> snapshotUpdated)
        {
            int? lastLeft = null;
            int? lastRight = null;
            var cpuZeroRpmSamples = 0;
            var gpuZeroRpmSamples = 0;
            var cpuRecoveredSamples = 0;
            var gpuRecoveredSamples = 0;
            var cpuStalled = false;
            var gpuStalled = false;
            statusChanged?.Invoke("EC 温控曲线已启动，使用平衡默认曲线。");

            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    var snapshot = await ReadSnapshotAsync().ConfigureAwait(false);
                    snapshotUpdated?.Invoke(snapshot);
                    if (!IsValidSensor(snapshot.CpuTemperatureC) || !IsValidSensor(snapshot.GpuTemperatureC))
                    {
                        statusChanged?.Invoke("温度传感器读数无效，停止曲线并请求 EC 自动模式。");
                        break;
                    }

                    UpdateStallState(snapshot.CpuTemperatureC, snapshot.LeftFanRpm,
                        ref cpuZeroRpmSamples, ref cpuRecoveredSamples, ref cpuStalled);
                    UpdateStallState(snapshot.GpuTemperatureC, snapshot.RightFanRpm,
                        ref gpuZeroRpmSamples, ref gpuRecoveredSamples, ref gpuStalled);

                    var left = ProfileSpeed(snapshot.CpuTemperatureC, CpuOfficeCurve);
                    var right = ProfileSpeed(snapshot.GpuTemperatureC, GpuOfficeCurve);
                    left = ApplyThermalFloor(snapshot.CpuTemperatureC, left);
                    right = ApplyThermalFloor(snapshot.GpuTemperatureC, right);
                    var emergency = snapshot.CpuTemperatureC >= ThermalEmergencyC || snapshot.GpuTemperatureC >= ThermalEmergencyC;
                    if (emergency || cpuStalled || gpuStalled)
                    {
                        left = 100;
                        right = 100;
                        statusChanged?.Invoke(emergency
                            ? "达到紧急温度阈值，已请求双风扇满速。"
                            : "检测到高温下风扇转速为零，已请求双风扇满速。请检查 RPM。 ");
                    }

                    if (!emergency && !cpuStalled && !gpuStalled)
                    {
                        left = Ramp(lastLeft, left, 10, 6);
                        right = Ramp(lastRight, right, 10, 6);
                        left = ApplyThermalFloor(snapshot.CpuTemperatureC, left);
                        right = ApplyThermalFloor(snapshot.GpuTemperatureC, right);
                    }

                    if (lastLeft != left || lastRight != right)
                    {
                        await SetFanPercentCoreAsync(left, right, true).ConfigureAwait(false);
                        lastLeft = left;
                        lastRight = right;
                    }
                    await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
            catch (Exception error)
            {
                statusChanged?.Invoke("EC 温控循环出错：" + error.Message + "；正在请求恢复 EC 自动模式。");
            }
            finally
            {
                _curveRunning = false;
                try { await ReturnToEcAutoAsync().ConfigureAwait(false); }
                catch (Exception error) { statusChanged?.Invoke("恢复 EC 自动模式失败：" + error.Message); }
                statusChanged?.Invoke("EC 温控曲线已停止。");
            }
        }

        private static readonly (int Temperature, int Speed)[] CpuOfficeCurve =
        {
            (37, 20), (45, 20), (57, 46), (70, 62), (85, 70)
        };

        private static readonly (int Temperature, int Speed)[] GpuOfficeCurve =
        {
            (35, 20), (43, 20), (54, 42), (65, 57), (82, 65)
        };

        private static bool IsValidSensor(int temperature) => temperature >= 1 && temperature <= 105;

        private static int ProfileSpeed(int temperature, (int Temperature, int Speed)[] curve)
        {
            if (temperature <= curve[0].Temperature) return curve[0].Speed;
            for (var index = 1; index < curve.Length; index++)
            {
                var upper = curve[index];
                if (temperature <= upper.Temperature)
                {
                    var lower = curve[index - 1];
                    var deltaTemp = upper.Temperature - lower.Temperature;
                    if (deltaTemp <= 0) return Math.Max(lower.Speed, upper.Speed);
                    var interpolated = lower.Speed + (upper.Speed - lower.Speed) *
                        (temperature - lower.Temperature) / deltaTemp;
                    return Math.Max(MinimumFanPercent, interpolated);
                }
            }
            return Math.Max(MinimumFanPercent, curve[curve.Length - 1].Speed);
        }

        private static int ApplyThermalFloor(int temperature, int requested)
        {
            if (temperature >= ThermalProtectC) return 100;
            if (temperature >= ThermalBoostC)
                return Math.Max(requested, Math.Min(100, 60 + (temperature - ThermalBoostC) * 3));
            return Math.Max(MinimumFanPercent, requested);
        }

        private static int Ramp(int? current, int target, int rampUp, int rampDown)
        {
            if (!current.HasValue) return target;
            if (target > current.Value) return Math.Min(target, current.Value + rampUp);
            return Math.Max(target, current.Value - rampDown);
        }

        private static void UpdateStallState(int temperature, int rpm, ref int zeroSamples,
            ref int recoveredSamples, ref bool stalled)
        {
            if (temperature >= 60 && rpm <= 0)
            {
                zeroSamples++;
                recoveredSamples = 0;
                if (zeroSamples >= 2) stalled = true;
            }
            else
            {
                zeroSamples = 0;
                if (rpm > 0)
                {
                    recoveredSamples++;
                    if (recoveredSamples >= 2) stalled = false;
                }
                else recoveredSamples = 0;
            }
        }

        private async Task WriteBothFansAsync(string model, int leftPercent, int rightPercent)
        {
                var left = leftPercent * 2;
                var right = rightPercent * 2;
                // ApiFan.set_fan() swaps channels for model_id 0 (LAPKC71E/F),
                // while LAPAC71H/model_id 1 keeps the requested left/right order.
                if (!model.Equals("LAPAC71H", StringComparison.OrdinalIgnoreCase))
                {
                    var swap = left;
                    left = right;
                    right = swap;
                }

                try
                {
                    var leftResult = await _wmi.ExecuteAsync(string.Format(CultureInfo.InvariantCulture, "0x0000000000{0:X2}1809", left)).ConfigureAwait(false);
                    EnsureCallSucceeded(leftResult, "左风扇 EC 写入");
                    var rightResult = await _wmi.ExecuteAsync(string.Format(CultureInfo.InvariantCulture, "0x0000000000{0:X2}1804", right)).ConfigureAwait(false);
                    EnsureCallSucceeded(rightResult, "右风扇 EC 写入");
                }
                catch (Exception writeError)
                {
                    // A partial dual-fan update is unsafe: immediately request EC auto mode.
                    var autoRestoreRequested = false;
                    try { autoRestoreRequested = !IsFailure(await _wmi.ExecuteAsync("0x0000000000A00751").ConfigureAwait(false)); }
                    catch { }
                    _manualRequested = !autoRestoreRequested;
                    var recovery = autoRestoreRequested ? "已请求恢复 EC 自动模式" : "恢复 EC 自动模式的请求也失败";
                    throw new InvalidOperationException("双风扇 EC 写入未完整成功；" + recovery + "。", writeError);
                }
        }

        private static int MinimumSafeSpeed(int temperatureC)
        {
            if (temperatureC >= ThermalProtectC) return 100;
            if (temperatureC >= ThermalBoostC) return Math.Min(100, 60 + (temperatureC - ThermalBoostC) * 3);
            return MinimumFanPercent;
        }

        private async Task ReturnToEcAutoAsync()
        {
            await _hardwareGate.WaitAsync().ConfigureAwait(false);
            try
            {
                if (!_manualRequested) return;
                EnsureCallSucceeded(await ExecuteAsync("0x0000000000A00751").ConfigureAwait(false), "风扇恢复 EC 自动模式");
                _manualRequested = false;
            }
            finally { _hardwareGate.Release(); }
        }

        public Task ReleaseManualControlOnExitAsync() => StopCurveControlAsync();

        private async Task<long> ReadByteAsync(int address)
        {
            var raw = await ExecuteAsync(string.Format(CultureInfo.InvariantCulture, "0x000001000000{0:X4}", address)).ConfigureAwait(false);
            EnsureCallSucceeded(raw, "EC 寄存器读取");
            return raw & 0xFF;
        }

        private async Task<long> ExecuteAsync(string payload)
        {
            var value = await _wmi.ExecuteAsync(payload).ConfigureAwait(false);
            if (IsFailure(value)) throw new InvalidOperationException("EC WMI 返回通信失败值。");
            return value;
        }

        private async Task<string> GetModelAsync()
        {
            if (_model != null) return _model;
            // Model detection is read-only and follows the model IDs used by ApiFan.try_init().
            // Querying arbitrary unsupported models is rejected before any EC write is allowed.
            var model = await Task.Run(() => ReadSystemModel()).ConfigureAwait(false);
            if (model != "LAPKC71E" && model != "LAPKC71F" && model != "LAPAC71H")
                throw new NotSupportedException("不支持的 NUC X15 型号：" + model);
            _model = model;
            return _model;
        }

        private static string ReadSystemModel()
        {
            using (var searcher = new System.Management.ManagementObjectSearcher(
                new System.Management.ManagementScope(@"\\.\ROOT\CIMV2"),
                new System.Management.ObjectQuery("SELECT Model FROM Win32_ComputerSystem")))
            using (var results = searcher.Get())
            {
                foreach (System.Management.ManagementObject item in results)
                using (item)
                    return Convert.ToString(item["Model"], CultureInfo.InvariantCulture).Trim().ToUpperInvariant();
            }
            throw new InvalidOperationException("无法读取本机型号。");
        }

        private static int CombineFanBytes(long high, long low)
        {
            if (high < 0 || low < 0 || high == EcCommunicationFailure || low == EcCommunicationFailure)
                throw new InvalidOperationException("EC 风扇转速读取失败。");
            return checked((int)(((high & 0xFF) << 8) | (low & 0xFF)));
        }

        private static int NormalizeRpm(int rpm) => rpm >= 0 && rpm <= 7000 ? rpm : 0;

        private static bool IsFailure(long value) => value < 0 || value == EcCommunicationFailure;

        private static void EnsureCallSucceeded(long value, string operation)
        {
            if (IsFailure(value)) throw new InvalidOperationException(operation + "失败（EC 返回值：" + value + "）。");
        }

        public void Dispose()
        {
            _wmi.Dispose();
            _hardwareGate.Dispose();
        }
    }
}
