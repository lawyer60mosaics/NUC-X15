using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.Linq;
using System.Management;
using System.Threading;
using System.Threading.Tasks;

namespace NssWpfHost.Ec
{
    /// <summary>
    /// Serializes Uniwill EC WMI calls on one dedicated MTA thread. This keeps
    /// COM/WMI state off the WPF dispatcher and preserves the Rust helper's
    /// single-request-at-a-time behavior.
    /// </summary>
    internal sealed class EcWmiSession : IDisposable
    {
        private readonly BlockingCollection<Action> _queue = new BlockingCollection<Action>();
        private readonly Thread _worker;
        private readonly TaskCompletionSource<bool> _ready = new TaskCompletionSource<bool>();
        private ManagementObject _ecInstance;
        private bool _disposed;

        public EcWmiSession()
        {
            _worker = new Thread(WorkerLoop) { IsBackground = true, Name = "NUCtool EC WMI" };
            _worker.SetApartmentState(ApartmentState.MTA);
            _worker.Start();
        }

        public async Task<long> ExecuteAsync(string payload)
        {
            if (_disposed) throw new ObjectDisposedException(nameof(EcWmiSession));
            if (string.IsNullOrWhiteSpace(payload) || !payload.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("EC payload must be a hexadecimal 0x value.", nameof(payload));

            await _ready.Task.ConfigureAwait(false);
            var completion = new TaskCompletionSource<long>();
            _queue.Add(() =>
            {
                try { completion.TrySetResult(Invoke(payload)); }
                catch (Exception error) { completion.TrySetException(error); }
            });
            return await completion.Task.ConfigureAwait(false);
        }

        private void WorkerLoop()
        {
            try
            {
                var options = new ConnectionOptions
                {
                    Impersonation = ImpersonationLevel.Impersonate,
                    Authentication = AuthenticationLevel.Call,
                    Timeout = TimeSpan.FromSeconds(5)
                };
                var scope = new ManagementScope(@"\\.\ROOT\WMI", options);
                scope.Connect();
                using (var searcher = new ManagementObjectSearcher(scope, new ObjectQuery("SELECT * FROM AcpiTest_MULong")))
                {
                    searcher.Options.Timeout = TimeSpan.FromSeconds(5);
                    using (var instances = searcher.Get())
                        _ecInstance = instances.Cast<ManagementObject>().FirstOrDefault();
                }
                if (_ecInstance == null)
                    throw new InvalidOperationException("ROOT\\WMI 中没有找到 AcpiTest_MULong EC 接口。");
                _ready.TrySetResult(true);
            }
            catch (Exception error)
            {
                _ready.TrySetException(new InvalidOperationException("EC WMI 初始化失败：" + error.Message, error));
                return;
            }

            foreach (var work in _queue.GetConsumingEnumerable()) work();
            _ecInstance?.Dispose();
        }

        private long Invoke(string payload)
        {
            var hex = payload.Substring(2);
            var data = ulong.Parse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
            using (var input = _ecInstance.GetMethodParameters("GetSetULong"))
            {
                input["Data"] = data.ToString(CultureInfo.InvariantCulture);
                using (var output = _ecInstance.InvokeMethod("GetSetULong", input,
                    new InvokeMethodOptions { Timeout = TimeSpan.FromSeconds(5) }))
                {
                    if (output == null || output["Return"] == null)
                        throw new InvalidOperationException("EC WMI 没有返回 Return 值。");
                    return Convert.ToInt64(output["Return"], CultureInfo.InvariantCulture);
                }
            }
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _queue.CompleteAdding();
            if (Thread.CurrentThread != _worker) _worker.Join(TimeSpan.FromSeconds(2));
            _queue.Dispose();
        }
    }
}
