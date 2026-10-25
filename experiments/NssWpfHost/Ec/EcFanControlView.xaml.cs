using System;
using System.Windows;
using System.Windows.Controls;

namespace NssWpfHost.Ec
{
    public partial class EcFanControlView : UserControl
    {
        private readonly EcFanModule _module = new EcFanModule();

        public EcFanControlView()
        {
            InitializeComponent();
            Unloaded += OnViewUnloaded;
        }

        private async void OnViewUnloaded(object sender, RoutedEventArgs e)
        {
            try { await _module.ReleaseManualControlOnExitAsync(); }
            catch (Exception error) { ActionStatus.Text = "交还 EC 自动控制失败：" + error.Message; }
            finally { _module.Dispose(); }
        }

        private void FanValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
        {
            if (LeftValue != null) LeftValue.Text = Math.Round(LeftFan.Value) + "%";
            if (RightValue != null) RightValue.Text = Math.Round(RightFan.Value) + "%";
        }

        private async void ReadStatus(object sender, RoutedEventArgs e)
        {
            try
            {
                var state = await _module.ReadSnapshotAsync();
                Readback.Text = string.Format("{0} · CPU {1}°C / GPU {2}°C · 左风扇 {3} RPM / 右风扇 {4} RPM · EC 模式原始值 {5}",
                    state.Model, state.CpuTemperatureC, state.GpuTemperatureC, state.LeftFanRpm, state.RightFanRpm, state.RawMode);
            }
            catch (Exception error) { Readback.Text = "硬件读回失败：" + error.Message; }
        }

        private async void RequestManual(object sender, RoutedEventArgs e)
        {
            try
            {
                await _module.SetManualControlAsync();
                ActionStatus.Text = "已向 EC 发送手动接管请求；硬件状态尚未确认。";
            }
            catch (Exception error) { ActionStatus.Text = "EC 接管失败：" + error.Message; }
        }

        private async void ApplySpeed(object sender, RoutedEventArgs e)
        {
            try
            {
                var temperatureLimited = await _module.SetFanPercentAsync((int)Math.Round(LeftFan.Value), (int)Math.Round(RightFan.Value));
                ActionStatus.Text = temperatureLimited
                    ? "温度保护已提高风扇请求值（紧急温度下请求双风扇满速）；请读取 RPM 观察变化，EC 不提供设定值确认读回。"
                    : "风扇速度请求已发送；请读取当前状态观察 RPM 变化，EC 不提供设定值确认读回。";
            }
            catch (Exception error) { ActionStatus.Text = "风扇调速失败：" + error.Message; }
        }

        private async void ReturnToAuto(object sender, RoutedEventArgs e)
        {
            try
            {
                await _module.ReturnToEcAutoAsync();
                ActionStatus.Text = "已向 EC 发送恢复自动风扇请求；硬件状态尚未确认。";
            }
            catch (Exception error) { ActionStatus.Text = "恢复 EC 自动模式失败：" + error.Message; }
        }
    }
}
