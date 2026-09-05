// The textarea edits ordinary arguments. The selected command is a separate,
// removable token; serialization remains plain text for drafts and Prime Agent.
let command = null;
let chip, label, remove;
let selectedAll = false;
const input = () => document.getElementById('composer');
const prefix = () => (command ? `/${command.name} ` : '');

export const composerCommand = () => command;
export const composerText = () => prefix() + input().value;

function render() {
  if (!chip) return;
  chip.hidden = !command;
  input().closest('.composer-input-row').classList.toggle('has-command-chip', !!command);
  if (command) {
    chip.dataset.kind =
      command.source === 'skill' ? 'skill' : command.source === 'prompt' ? 'prompt' : 'command';
    label.textContent = `/${command.name}`;
    chip.title = `${label.textContent} · ${command.description || ''}`;
    remove.setAttribute('aria-label', `Retirer la commande /${command.name}`);
    input().setAttribute('aria-describedby', 'composer-command-label');
  } else input().removeAttribute('aria-describedby');
  chip.classList.toggle('is-selected', selectedAll);
}

export function setComposerText(text, { retainCommand = true } = {}) {
  text = String(text || '');
  if (command && retainCommand && text.startsWith(prefix())) input().value = text.slice(prefix().length);
  else {
    command = null;
    input().value = text;
  }
  selectedAll = false;
  render();
}

export function selectComposerCommand(value, args = '') {
  command = { name: value.name, source: value.source, description: value.description };
  input().value = args;
  selectedAll = false;
  render();
}

export function createCommandChip() {
  const textarea = input();
  chip = document.createElement('span');
  chip.id = 'composer-command';
  chip.className = 'composer-command';
  chip.hidden = true;
  label = document.createElement('span');
  label.id = 'composer-command-label';
  label.className = 'composer-command-label';
  remove = document.createElement('button');
  remove.id = 'remove-command';
  remove.type = 'button';
  remove.textContent = '×';
  chip.append(label, remove);
  textarea.before(chip);
  const changed = () => textarea.dispatchEvent(new Event('input', { bubbles: true }));
  function clear() {
    if (!command || textarea.disabled) return;
    command = null;
    selectedAll = false;
    render();
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, 0);
    changed();
  }
  remove.onclick = clear;
  remove.onkeydown = (event) => {
    if (['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault();
      clear();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    }
  };
  function atStart() {
    return command && !textarea.selectionStart && !textarea.selectionEnd;
  }
  textarea.addEventListener(
    'keydown',
    (event) => {
      if (!command || event.isComposing || textarea.disabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectedAll = true;
        textarea.select();
        render();
      } else if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && atStart()) {
        event.preventDefault();
        clear();
      } else if (event.key === 'ArrowLeft' && !event.shiftKey && atStart()) {
        event.preventDefault();
        remove.focus();
      } else if (
        !['Control', 'Meta', 'Shift', 'c', 'x'].includes(event.key) &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        // beforeinput performs replacement of a select-all, including the chip.
        if (event.key.startsWith('Arrow') || event.key === 'Escape') {
          selectedAll = false;
          render();
        }
      }
    },
    true,
  );
  textarea.addEventListener('beforeinput', (event) => {
    if (!command || textarea.disabled) return;
    if (selectedAll && textarea.selectionStart === 0 && textarea.selectionEnd === textarea.value.length) {
      command = null;
      selectedAll = false;
      render();
    } else if (event.inputType === 'deleteContentBackward' && atStart()) {
      event.preventDefault();
      clear();
    }
  });
  for (const type of ['copy', 'cut'])
    textarea.addEventListener(type, (event) => {
      if (
        !command ||
        !selectedAll ||
        textarea.selectionStart !== 0 ||
        textarea.selectionEnd !== textarea.value.length ||
        !event.clipboardData
      )
        return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', composerText());
      if (type === 'cut' && !textarea.disabled) {
        setComposerText('');
        changed();
      }
    });
  textarea.addEventListener('pointerdown', () => {
    selectedAll = false;
    render();
  });
  textarea.addEventListener('input', () => {
    selectedAll = false;
    render();
  });
  return {
    update() {
      remove.disabled = textarea.disabled;
    },
  };
}
