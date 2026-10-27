using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace IntelNucStudio.Ec
{
    // Own a row in the real ProfilesView; never position home actions in shell coordinates.
    internal sealed class HomeActionLayout
    {
        private readonly Button _entry;
        private readonly AutoStartControl _startup;
        private Grid _footer;
        private ItemsControl _nativeButtons;
        private readonly System.Collections.Generic.HashSet<Button> _adapted = new System.Collections.Generic.HashSet<Button>();
        internal HomeActionLayout(Button entry, AutoStartControl startup) { _entry = entry; _startup = startup; }

        internal bool Attach(FrameworkElement home)
        {
            var buttons = FindButtons(home);
            if (buttons == null || !(buttons.Parent is Grid footer)) return false;
            if (ReferenceEquals(footer, _footer)) return true;
            if (_footer != null) _footer.SizeChanged -= OnSizeChanged;
            if (_nativeButtons != null) _nativeButtons.LayoutUpdated -= OnNativeLayout;
            Detach(_entry); Detach(_startup);
            _footer = footer; _nativeButtons = buttons;
            // Keep the official controls, Prism regions, parents and bindings.
            foreach (UIElement child in footer.Children)
                if (!ReferenceEquals(child, buttons)) Grid.SetColumn(child, 4);
            footer.ColumnDefinitions.Clear();
            foreach (var width in new[] { GridLength.Auto, GridLength.Auto, GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto })
                footer.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
            footer.RowDefinitions.Clear();
            footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            footer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            if (footer.Parent is Grid data && Grid.GetRow(footer) < data.RowDefinitions.Count)
            {
                var row = data.RowDefinitions[Grid.GetRow(footer)];
                row.SetCurrentValue(RowDefinition.HeightProperty, GridLength.Auto);
                row.MinHeight = 64;
            }
            buttons.SetCurrentValue(FrameworkElement.HeightProperty, 48d);
            buttons.VerticalAlignment = VerticalAlignment.Center;
            _entry.Width = _entry.Height = 48;
            _entry.Margin = new Thickness(12, 0, 0, 0);
            _entry.VerticalAlignment = VerticalAlignment.Center;
            _startup.Margin = new Thickness(12, 0, 0, 0);
            _startup.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(_entry, 1); footer.Children.Add(_entry);
            Grid.SetColumn(_startup, 2); footer.Children.Add(_startup);
            footer.SizeChanged += OnSizeChanged;
            buttons.LayoutUpdated += OnNativeLayout;
            Arrange();
            return true;
        }

        private void Arrange()
        {
            if (_footer == null) return;
            _nativeButtons.Width = Math.Max(1, _nativeButtons.Items.Count) * 48d;
            _startup.Width = _startup.Height = 48;
            _startup.HorizontalAlignment = HorizontalAlignment.Left;
            foreach (var button in FindNativeButtons(_nativeButtons))
            {
                if (!_adapted.Add(button)) continue;
                var source = FindImage(button)?.Source ?? HomeActionStyle.Icon(false);
                button.SetCurrentValue(ContentControl.ContentProperty, new Image { Source = source, Width = 32, Height = 32 });
                button.Width = button.Height = 48;
                button.Padding = new Thickness(0);
                button.Template = HomeActionStyle.Template();
                button.Cursor = System.Windows.Input.Cursors.Hand;
                button.ToolTip = "系统监视器";
                System.Windows.Automation.AutomationProperties.SetName(button, "系统监视器");
            }
        }

        private static System.Collections.Generic.IEnumerable<Button> FindNativeButtons(DependencyObject node)
        {
            if (node is Button button) { yield return button; yield break; }
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                foreach (var child in FindNativeButtons(VisualTreeHelper.GetChild(node, i))) yield return child;
        }
        private static Image FindImage(DependencyObject node)
        {
            if (node is Image image) return image;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            { var found = FindImage(VisualTreeHelper.GetChild(node, i)); if (found != null) return found; }
            return null;
        }

        private void OnSizeChanged(object sender, SizeChangedEventArgs args) => Arrange();
        private void OnNativeLayout(object sender, EventArgs args) => Arrange();

        private static void Detach(FrameworkElement element) { if (element.Parent is Panel panel) panel.Children.Remove(element); }
        private static ItemsControl FindButtons(DependencyObject node)
        {
            if (node == null) return null;
            if (node is ItemsControl items && items.Name == "ButtonContent") return items;
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
            { var found = FindButtons(VisualTreeHelper.GetChild(node, i)); if (found != null) return found; }
            return null;
        }
    }
}
