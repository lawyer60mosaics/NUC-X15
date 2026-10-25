using System;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using NssWpfHost.Ec;

namespace IntelNucStudio.Ec
{
    public partial class EcControlPage : UserControl, IDisposable
    {
        private readonly IEcFanController _module;
        private readonly DispatcherTimer _timer;
        private Task _action = Task.CompletedTask;
        private Task _poll = Task.CompletedTask;
        private bool _busy;
        private bool _closing;
        private bool _fixed;
        private int _left = 40;
        private int _right = 40;
        private bool _reportedControl;

        public bool HasControlRequest => _module.IsManualControlRequested;
        public event EventHandler ControlStateChanged;

        public EcControlPage() : this(new EcFanModule()) { }

        internal EcControlPage(IEcFanController module)
        {
            _module = module ?? throw new ArgumentNullException(nameof(module));
            InitializeComponent();
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
            _timer.Tick += (sender, args) => Poll();
            Loaded += (sender, args) => { _timer.Start(); Poll(); };
        }

        private void SpeedChanged(object sender, RoutedPropertyChangedEventArgs<double> args)
        {
            if (LeftPercent != null) LeftPercent.Text = Math.Round(LeftSpeed.Value) + "%";
            if (RightPercent != null) RightPercent.Text = Math.Round(RightSpeed.Value) + "%";
        }

        private void Poll()
        {
            if (_closing || _busy || !_poll.IsCompleted) return;
            _poll = PollAsync();
        }

        private async Task PollAsync()
        {
            try
            {
                // Recheck thermal protection continuously for fixed-speed control.
                if (_fixed) await _module.SetFanPercentAsync(_left, _right);
                var value = await _module.ReadSnapshotAsync();
                CpuTemperature.Text = value.CpuTemperatureC + "°C";
                GpuTemperature.Text = value.GpuTemperatureC + "°C";
                LeftRpm.Text = value.LeftFanRpm + " RPM";
                RightRpm.Text = value.RightFanRpm + " RPM";
                ReadbackStatus.Text = value.Model + " · 硬件读回 " + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception error)
            {
                CpuTemperature.Text = GpuTemperature.Text = LeftRpm.Text = RightRpm.Text = "—";
                ReadbackStatus.Text = "硬件读取暂不可用：" + error.Message;
                if (_fixed)
                {
                    _fixed = false;
                    try { await _module.StopCurveControlAsync(); ActionStatus.Text = "固定转速保护检测失败，已请求交还固件自动控制。"; }
                    catch (Exception recovery) { ActionStatus.Text = "自动控制恢复请求失败，请重试交还：" + recovery.Message; }
                }
            }
            UpdateControlState();
        }

        private void UpdateControlState()
        {
            ControlState.Text = _module.IsCurveControlRunning ? "EC 平衡温控请求运行中"
                : _module.IsManualControlRequested ? "EC 固定转速请求运行中" : "未持有 EC 接管请求";
            if (_reportedControl != HasControlRequest)
            {
                _reportedControl = HasControlRequest;
                ControlStateChanged?.Invoke(this, EventArgs.Empty);
            }
        }

        private void RunAction(Func<Task> action)
        {
            if (_busy || _closing) return;
            _action = RunActionAsync(action);
        }

        private async Task RunActionAsync(Func<Task> action)
        {
            _busy = true;
            ControlActions.IsEnabled = ReleaseButton.IsEnabled = false;
            try { await _poll; await action(); }
            catch (Exception error) { ActionStatus.Text = "操作未完成：" + error.Message; }
            finally
            {
                _busy = false;
                ControlActions.IsEnabled = ReleaseButton.IsEnabled = !_closing;
                UpdateControlState();
            }
        }

        private static void RequireAdministrator()
        {
            using (var identity = WindowsIdentity.GetCurrent())
                if (!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator))
                    throw new InvalidOperationException("请先退出本程序，再右键 NucSoftwareStudio.exe，选择“以管理员身份运行”。");
        }

        private void StartCurve(object sender, RoutedEventArgs args) => RunAction(async () =>
        {
            RequireAdministrator();
            _fixed = false;
            await _module.StopCurveControlAsync();
            await _module.StartCurveControlAsync(
                message => Dispatcher.BeginInvoke(new Action(() => { ActionStatus.Text = message; UpdateControlState(); })),
                snapshot => { });
            ActionStatus.Text = "已发送 EC 温控接管请求；请观察温度和 RPM。";
        });

        private void ApplyFixed(object sender, RoutedEventArgs args) => RunAction(async () =>
        {
            RequireAdministrator();
            _fixed = false;
            await _module.StopCurveControlAsync();
            await _module.SetManualControlAsync();
            _left = (int)Math.Round(LeftSpeed.Value);
            _right = (int)Math.Round(RightSpeed.Value);
            try { await _module.SetFanPercentAsync(_left, _right); _fixed = true; }
            catch { await _module.StopCurveControlAsync(); throw; }
            ActionStatus.Text = "固定转速请求已发送，温度保护持续运行；实际转速请看 RPM 读回。";
        });

        private void ReleaseControl(object sender, RoutedEventArgs args) => RunAction(async () =>
        {
            _fixed = false;
            await _module.StopCurveControlAsync();
            ActionStatus.Text = "已请求交还固件自动控制。";
        });

        private void RefreshReadback(object sender, RoutedEventArgs args) => Poll();

        public async Task DeactivateAsync()
        {
            _closing = true;
            _timer.Stop();
            ControlActions.IsEnabled = ReleaseButton.IsEnabled = false;
            try
            {
                await _action;
                await _poll;
                _fixed = false;
                await _module.ReleaseManualControlOnExitAsync();
            }
            catch
            {
                _closing = false;
                ControlActions.IsEnabled = ReleaseButton.IsEnabled = true;
                _timer.Start();
                throw;
            }
        }

        public void ReleaseBeforeProcessExit()
        {
            _fixed = false;
            if (!_module.IsManualControlRequested) return;
            // Hardware work runs on its MTA worker and never needs the UI dispatcher.
            if (!_module.ReleaseManualControlOnExitAsync().Wait(TimeSpan.FromSeconds(4)))
                IntegrationDiagnostics.Write("Timed out requesting EC auto during process exit.");
        }

        public void Dispose() { _timer.Stop(); _module.Dispose(); }
    }
}
