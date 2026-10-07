// Mobile navigation drawer — loaded on every page from base.html.
// Below MOBILE_QUERY the left nav is an off-canvas drawer (see app.css);
// on desktop none of these controls are visible, so this is a no-op there.

const MOBILE_QUERY = '(max-width: 640px)';

(function () {
  const menuBtn  = document.getElementById('mobile-menu-btn');
  const closeBtn = document.getElementById('nav-close-btn');
  const backdrop = document.getElementById('nav-backdrop');
  const nav      = document.getElementById('nav-sidebar');

  function setOpen(open) {
    document.body.classList.toggle('nav-open', open);
    backdrop.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  }

  menuBtn.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setOpen(false);
  });

  // Close on nav click so the drawer isn't left covering the next page
  // (also covers back/forward cache restores via pageshow).
  nav.addEventListener('click', e => {
    if (e.target.closest('a')) setOpen(false);
  });
  window.addEventListener('pageshow', () => setOpen(false));

  // Rotating or resizing past the breakpoint must not leave a stale drawer open.
  window.matchMedia(MOBILE_QUERY).addEventListener('change', e => {
    if (!e.matches) setOpen(false);
  });
})();
