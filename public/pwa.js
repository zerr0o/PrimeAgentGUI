const button = document.getElementById('pwa-install');
let invitation;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const update = () => {
  if (button) button.hidden = standalone();
};
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  invitation = event;
  update();
});
window.addEventListener('appinstalled', () => {
  invitation = null;
  if (button) button.hidden = true;
});
matchMedia('(display-mode: standalone)').addEventListener('change', update);
update();

function help() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dialog = document.createElement('dialog');
  dialog.className = 'pwa-dialog';
  dialog.setAttribute('aria-labelledby', 'pwa-help-title');
  const title = document.createElement('h2');
  title.id = 'pwa-help-title';
  title.textContent = 'Installer Prime Agent Studio';
  const text = document.createElement('p');
  text.textContent = !window.isSecureContext
    ? 'Sur le téléphone, ouvrez l’adresse HTTPS du Studio avec Tailscale connecté. L’adresse HTTP du réseau local ne permet pas l’installation complète.'
    : ios
      ? 'Ouvrez cette page dans Safari, puis utilisez Partager → Sur l’écran d’accueil. Activez « Ouvrir comme app web » si cette option est proposée.'
      : 'Dans le menu de votre navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ». Si cette option manque, utilisez Chrome ou Edge et rechargez la page.';
  const note = document.createElement('p');
  note.className = 'pwa-note';
  note.textContent = 'Le PC doit rester allumé. Fermer l’application laisse les agents travailler.';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pwa-primary';
  close.textContent = 'Compris';
  close.onclick = () => dialog.close();
  dialog.append(title, text, note, close);
  document.body.append(dialog);
  dialog.onclick = (event) => {
    if (event.target === dialog) dialog.close();
  };
  dialog.onclose = () => {
    dialog.remove();
    button?.focus();
  };
  dialog.showModal();
}
if (button)
  button.onclick = async () => {
    if (!invitation) return help();
    const event = invitation;
    invitation = null;
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      help();
    }
  };
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
    // Installation guidance remains usable if the server has not been updated yet.
  });
}
