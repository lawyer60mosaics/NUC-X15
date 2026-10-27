using System;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;

namespace IntelNucStudio.Ec
{
    internal sealed class AutoStartControl : Border
    {
        private readonly IAutoStartSettings _settings;
        private readonly ToggleButton _toggle;
        private readonly TextBlock _status;
        private bool? _enabled;
        private bool _busy;

        internal AutoStartControl(IAutoStartSettings settings)
        {
            _settings = settings;
            Name = "NssAutoStartControl";
            Width = Height = 48;
            System.Windows.Documents.TextElement.SetFontFamily(this, IndustrialTheme.BodyFont);
            Padding = new Thickness(0);
            Background = Brushes.Transparent;
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var title = new TextBlock { Text = "开机自启动", FontSize = 16, FontWeight = FontWeights.SemiBold,
                VerticalAlignment = VerticalAlignment.Center };
            title.SetResourceReference(TextBlock.ForegroundProperty, "MainTextBrush");
            title.Visibility = Visibility.Collapsed;
            grid.Children.Add(title);
            _toggle = new ToggleButton { Name = "AutoStartToggle", Width = 68, Height = 30,
                Margin = new Thickness(12, 0, 0, 0), IsChecked = null, Cursor = Cursors.Hand };
            _toggle.Width = _toggle.Height = 48;
            _toggle.Margin = new Thickness(0);
            _toggle.Template = HomeActionStyle.Template();
            _toggle.Content = new Image { Source = HomeActionStyle.Icon(true), Width = 32, Height = 32 };
            _toggle.SetResourceReference(Control.FocusVisualStyleProperty, "IndustrialFocus");
            AutomationProperties.SetName(_toggle, "开机自启动");
            _toggle.Click += async (sender, args) => await ToggleAsync();
            Grid.SetColumn(_toggle, 1); grid.Children.Add(_toggle);
            _status = new TextBlock { Name = "AutoStartStatus", Text = "正在读取设置…", FontSize = 13,
                Margin = new Thickness(0, 4, 0, 0), TextWrapping = TextWrapping.Wrap, MaxHeight = 38,
                TextTrimming = TextTrimming.CharacterEllipsis };
            _status.SetResourceReference(TextBlock.ForegroundProperty, "IndustrialMutedBrush");
            _status.Visibility = Visibility.Collapsed;
            AutomationProperties.SetLiveSetting(_status, AutomationLiveSetting.Polite);
            Grid.SetRow(_status, 1); Grid.SetColumnSpan(_status, 2); grid.Children.Add(_status);
            Child = grid;
            Loaded += async (sender, args) => await RefreshAsync();
            IsVisibleChanged += async (sender, args) => { if (IsVisible) await RefreshAsync(); };
        }

        internal async Task RefreshAsync()
        {
            if (_busy) return;
            _busy = true; _toggle.IsEnabled = false;
            try { Apply(await _settings.ReadAsync()); }
            catch (Exception error) { Failure(error); }
            finally { _busy = false; _toggle.IsEnabled = true; }
        }

        internal async Task ToggleAsync()
        {
            if (_busy) return;
            _busy = true; _toggle.IsEnabled = false;
            _toggle.IsChecked = _enabled;
            try
            {
                if (!_enabled.HasValue) Apply(await _settings.ReadAsync());
                var desired = !_enabled.Value;
                _status.Text = desired ? "正在开启…" : "正在关闭…";
                await _settings.SetEnabledAsync(desired);
                var actual = await _settings.ReadAsync();
                Apply(actual);
                if (actual.Enabled != desired) throw new InvalidOperationException("未能确认更改，请重试。");
            }
            catch (Exception error)
            {
                try { Apply(await _settings.ReadAsync()); } catch { _enabled = null; }
                Failure(error);
            }
            finally { _busy = false; _toggle.IsEnabled = true; }
        }

        private void Apply(AutoStartStatus actual)
        {
            _enabled = actual.Enabled;
            _toggle.IsChecked = actual.Enabled;
            _status.Text = actual.Enabled ? "已开启 · 登录后在托盘运行" : "未开启 · 点击右侧开关启用";
            _status.SetResourceReference(TextBlock.ForegroundProperty, "IndustrialMutedBrush");
            ToolTip = "开机自启动：" + (actual.Enabled ? "已开启，点击关闭" : "未开启，点击开启") + "\n" + actual.Description;
            _toggle.ToolTip = ToolTip;
            ((Image)_toggle.Content).Source = HomeActionStyle.Icon(true, actual.Enabled);
            AutomationProperties.SetHelpText(_toggle, ToolTip.ToString());
        }

        private void Failure(Exception error)
        {
            _toggle.IsChecked = _enabled;
            _status.Text = "操作未完成：" + error.Message;
            _status.SetResourceReference(TextBlock.ForegroundProperty, "IndustrialDangerBrush");
            ToolTip = _status.Text;
            _toggle.ToolTip = "开机自启动：" + _status.Text;
            AutomationProperties.SetHelpText(_toggle, _status.Text);
        }
    }
}
