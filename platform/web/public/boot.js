// Runs before the app bundle (external file so the CSP needs no 'unsafe-inline'): applies the saved theme
// and decides whether the cinematic intro should play.
(function () {
  var d = document.documentElement;
  try {
    var t = localStorage.getItem('gpev-theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    d.setAttribute('data-theme', t);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && !sessionStorage.getItem('gpev-app-intro') && !/[?&]nointro/.test(location.search)) d.classList.add('intro-pending');
  } catch (e) {}
})();
