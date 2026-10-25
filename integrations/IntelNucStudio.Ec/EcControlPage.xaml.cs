using System;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using NssWpfHost.Ec;

namespace IntelNucStudio.Ec
{
    public partial class EcControlPage : UserControl, IDisposable
    {
        private readonly IEcFanController _module;
        private readonly Action _demandAdministrator;
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

        internal EcControlPage(IEcFanController module, Action demandAdministrator = null)
        {
            _module = module ?? throw new ArgumentNullException(nameof(module));
            _demandAdministrator = demandAdministrator ?? RequireAdministrator;
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
            var active = _module.IsCurveControlRunning ? _module.ActivePreset : null;
            ControlState.Text = active.HasValue ? "EC “" + EcFanPresets.Get(active.Value).Name + "”温控请求运行中"
                : _module.IsManualControlRequested ? (_fixed ? "EC 固定转速请求运行中" : "EC 接管尚未释放，请交还自动控制") : "未持有 EC 接管请求";
            foreach (var button in new[] { QuietPreset, BalancedPreset, PerformancePreset })
            {
                var selected = active.HasValue && button.Tag.ToString() == active.Value.ToString();
                button.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(selected ? "#00799D" : "#28495C"));
                button.BorderBrush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(selected ? "#F1D54A" : "#418197"));
                button.FontWeight = selected ? FontWeights.Bold : FontWeights.Normal;
            }
            PresetDescription.Text = active.HasValue ? EcFanPresets.Get(active.Value).Description
                : "静音降低噪声，平衡适合日常，性能优先散热。";
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

        private void SelectPreset(object sender, RoutedEventArgs args)
        {
            if (!(sender is Button button) || !Enum.TryParse(button.Tag?.ToString(), out EcFanPreset preset)) return;
            RunAction(async () =>
            {
                _demandAdministrator();
                var wasFixed = _fixed;
                _fixed = false;
                try
                {
                    await _module.StartCurveControlAsync(preset,
                        message => Dispatcher.BeginInvoke(new Action(() => { ActionStatus.Text = message; UpdateControlState(); })),
                        snapshot => { });
                    if (!_module.IsCurveControlRunning)
                        throw new InvalidOperationException("温控曲线未能保持运行，请检查温度/RPM 读回与硬件状态。");
                    ActionStatus.Text = "已请求使用“" + EcFanPresets.Get(preset).Name + "”风扇曲线，转速将逐步调整；请观察 RPM。";
                }
                catch { _fixed = wasFixed && _module.IsManualControlRequested && !_module.IsCurveControlRunning; throw; }
            });
        }

        private void ApplyFixed(object sender, RoutedEventArgs args) => RunAction(async () =>
        {
            _demandAdministrator();
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
