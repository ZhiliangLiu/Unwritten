(function () {
  var root = document.documentElement;
  var preference = root.getAttribute('data-uw-appearance');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = preference === 'dark' || (preference !== 'light' && prefersDark) ? 'dark' : 'light';
  root.setAttribute('data-uw-theme', theme);
})();
