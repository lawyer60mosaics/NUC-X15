using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using System.Threading.Tasks;
using IntelNucStudio.Ec;

namespace IntelNucStudio.Ec.Tests
{
    internal static class LicenseConsentScenarios
    {
        internal static async Task Run(Action<string> pass)
        {
            var accepted = false;
            var model = new LicenseModel();
            var button = new ConsentButton { Command = model.AcceptEula };
            var window = new Window { Content = button };
            Exception failure = null;
            LicenseConsent.Attach(window, model, () => accepted, () => accepted = true, error => failure = error);
            Assert(model.ShowEula && !accepted, "A new installation must still require explicit consent");
            button.ClickNow();
            await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
            Assert(!model.ShowEula && accepted && failure == null, "Only the actual accept command should persist consent");
            window.Close();
            var next = new LicenseModel();
            window = new Window();
            LicenseConsent.Attach(window, next, () => accepted, () => throw new Exception("Unexpected write"), error => failure = error);
            Assert(!next.ShowEula, "Accepted unchanged license should not reappear after restart");
            window.Close();
            pass("License dialog requires explicit consent once and restores it without MSIX storage");
            model = new LicenseModel();
            button = new ConsentButton { Command = model.AcceptEula };
            window = new Window { Content = button };
            LicenseConsent.Attach(window, model, () => false, () => throw new System.IO.IOException("TEST"), error => failure = error);
            button.ClickNow();
            await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
            Assert(failure is System.IO.IOException, "Consent write failures must be reported instead of crashing or falsely claiming persistence");
            window.Close();
            pass("License persistence failures remain visible and cannot crash the dispatcher");
        }
        private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
        private sealed class ConsentButton : Button { internal void ClickNow() => OnClick(); }
        public sealed class LicenseModel
        {
            public bool ShowEula { get; set; } = true;
            public ICommand AcceptEula { get; }
            public LicenseModel() { AcceptEula = new ConsentCommand(() => ShowEula = false); }
        }
        private sealed class ConsentCommand : ICommand
        {
            private readonly Action _execute;
            internal ConsentCommand(Action execute) { _execute = execute; }
            public bool CanExecute(object parameter) => true;
            public void Execute(object parameter) => _execute();
            public event EventHandler CanExecuteChanged { add { } remove { } }
        }
    }
}
