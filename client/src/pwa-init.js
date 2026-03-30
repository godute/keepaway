// Orientation lock
try {
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(() => {});
  }
} catch(e) {}

// Scroll input into view when mobile keyboard opens
document.querySelectorAll('.lobby-input').forEach(input => {
  input.addEventListener('focus', () => {
    setTimeout(() => {
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  });
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// PWA install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const installBtn = document.getElementById('rotate-install-btn');
  if (installBtn) installBtn.style.display = 'block';
});
document.getElementById('rotate-install-btn')?.addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  }
});

// Show rotate overlay only during game (when lobby is hidden)
const rotateOverlay = document.getElementById('rotate-overlay');
function checkRotate() {
  const lobbyHidden = document.getElementById('lobby-overlay')?.classList.contains('hidden');
  const isPortrait = window.innerHeight > window.innerWidth;
  const isMobile = window.innerWidth < 900 || window.innerHeight < 900;
  if (lobbyHidden && isPortrait && isMobile) {
    rotateOverlay.style.display = 'flex';
  } else {
    rotateOverlay.style.display = 'none';
  }
}
window.addEventListener('resize', checkRotate);
window.addEventListener('orientationchange', () => setTimeout(checkRotate, 200));
setInterval(checkRotate, 1000);
