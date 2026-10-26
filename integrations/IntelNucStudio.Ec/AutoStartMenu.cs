using System;
using System.Threading.Tasks;
using Forms = System.Windows.Forms;

namespace IntelNucStudio.Ec
{
    internal sealed class AutoStartMenu : IDisposable
    {
        private readonly IAutoStartSettings _settings;
        private readonly Action<Exception> _reportError;
        private Forms.ToolStripMenuItem _item;
        private bool _busy;
        private bool _disposed;

        internal AutoStartMenu(IAutoStartSettings settings, Action<Exception> reportError)
        { _settings = settings; _reportError = reportError; }

        internal void Attach(Forms.ContextMenuStrip menu)
        {
            if (_disposed) return;
            if (_item == null || _item.IsDisposed)
            {
                _item = new Forms.ToolStripMenuItem("开机自启动") { Name = "NssEcAutoStart", CheckOnClick = false };
                _item.Click += async (sender, args) => await ToggleAsync();
            }
            if (menu != null && !menu.Items.Contains(_item))
            {
                _item.Owner?.Items.Remove(_item);
                menu.Items.Insert(Math.Max(0, menu.Items.Count - 1), _item);
            }
        }

        internal async Task RefreshAsync()
        {
            if (_disposed || _busy || _item == null || _item.IsDisposed) return;
            _busy = true;
            _item.Enabled = false;
            try { Apply(await _settings.ReadAsync()); }
            catch (Exception error) { ShowUnknown(error); }
            finally { _busy = false; if (!_disposed && !_item.IsDisposed) _item.Enabled = true; }
        }

        internal async Task ToggleAsync()
        {
            if (_disposed || _busy || _item == null || _item.IsDisposed) return;
            _busy = true;
            _item.Enabled = false;
            try
            {
                var enable = !_item.Checked;
                await _settings.SetEnabledAsync(enable);
                var actual = await _settings.ReadAsync();
                Apply(actual);
                if (actual.Enabled != enable) throw new InvalidOperationException("自启动更改后未能确认，请检查任务计划程序后重试。");
            }
            catch (Exception error)
            {
                try { Apply(await _settings.ReadAsync()); } catch { ShowUnknown(error); }
                if (!_disposed) _reportError(error);
            }
            finally { _busy = false; if (!_disposed && !_item.IsDisposed) _item.Enabled = true; }
        }

        private void Apply(AutoStartStatus state)
        {
            if (_disposed || _item.IsDisposed) return;
            _item.Text = "开机自启动";
            _item.Checked = state.Enabled;
            _item.ToolTipText = state.Description;
        }

        private void ShowUnknown(Exception error)
        {
            if (_disposed || _item.IsDisposed) return;
            _item.Text = "开机自启动（状态未读取）";
            _item.Checked = false;
            _item.ToolTipText = error.Message;
        }

        public void Dispose()
        {
            _disposed = true;
            _item?.Owner?.Items.Remove(_item);
            _item?.Dispose();
        }
    }
}
