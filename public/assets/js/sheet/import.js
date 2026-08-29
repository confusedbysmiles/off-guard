/**
 * The Pathbuilder import dialog.
 *
 * Nothing is written until the player has seen the diff and accepted it, and
 * every row can be unchecked individually -- a level-up import should be able
 * to bring the new proficiency across while leaving the AC the player fixed by
 * hand alone.
 */
import { $, el, titleCase } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

export async function openImportDialog({ store, endpoint }) {
  const dialog = $('#import-dialog');
  const body = $('#import-body');
  const confirm = $('#import-confirm');
  confirm.disabled = true;

  let capabilities = { fileUpload: true, buildId: false, buildIdNote: '' };
  try {
    const res = await fetch(`${endpoint}/import/capabilities`);
    if (res.ok) capabilities = await res.json();
  } catch { /* offline: the file path still works */ }

  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'input', id: 'pb-file' });
  const buildId = el('input', {
    type: 'text', inputmode: 'numeric', class: 'input', id: 'pb-id',
    placeholder: 'e.g. 145200', disabled: !capabilities.buildId,
  });
  const message = el('p', { class: 'muted' });
  const diff = el('div', { class: 'diff' });

  const preview = async (payload) => {
    message.textContent = 'Reading…';
    diff.replaceChildren();
    confirm.disabled = true;
    try {
      const res = await fetch(`${endpoint}/import/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) {
        message.textContent = result.error ?? 'That did not work.';
        return;
      }
      renderDiff(result);
    } catch (error) {
      message.textContent = `Could not reach the server: ${error.message}`;
    }
  };

  function renderDiff(result) {
    const { changes, warnings } = result;
    if (!changes.length) {
      message.textContent = 'Nothing to change — this sheet already matches that build.';
      return;
    }
    message.textContent = `${changes.length} field${changes.length === 1 ? '' : 's'} would change. `
      + 'Uncheck anything you want to keep as it is.';

    diff.replaceChildren(...changes.map((change, index) => {
      const box = el('input', {
        type: 'checkbox', checked: true, id: `diff-${index}`,
        'aria-label': `Apply ${prettyPath(change.path)}`,
      });
      box.dataset.index = String(index);
      return el('div', { class: 'diff__row' },
        box,
        el('label', { for: `diff-${index}` },
          el('div', { class: 'diff__path' }, prettyPath(change.path)),
          el('div', { class: 'diff__values' },
            change.isNew ? null : el('span', { class: 'diff__from' }, preview_(change.from)),
            change.isNew ? null : ' → ',
            el('span', { class: 'diff__to' }, preview_(change.to)))));
    }));

    if (warnings.length) {
      diff.append(el('div', { class: 'notice' },
        el('div', { class: 'notice__body' },
          el('strong', {}, 'Not imported'),
          ...warnings.map((w) => el('p', { class: 'muted' }, w)))));
    }

    confirm.disabled = false;
    confirm.onclick = async (event) => {
      event.preventDefault();
      const accepted = [...diff.querySelectorAll('input[type=checkbox]')]
        .filter((box) => box.checked)
        .map((box) => changes[Number(box.dataset.index)]);
      await fetch(`${endpoint}/import/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes: accepted }),
      });
      dialog.close();
      // The server is now ahead of the local copy, so reload rather than guess.
      await store.load();
    };
  }

  file.addEventListener('change', async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      preview({ json: JSON.parse(await chosen.text()) });
    } catch (error) {
      message.textContent = `That file is not readable JSON (${error.message}).`;
    }
  });

  const fetchById = el('button', {
    class: 'btn', type: 'button', disabled: !capabilities.buildId,
    html: `${icon('cloud')}<span>Fetch</span>`,
    onclick: () => preview({ buildId: buildId.value.trim() }),
  });

  body.replaceChildren(
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'pb-file' },
        'Pathbuilder JSON export (works offline)'),
      file),
    el('div', { class: 'field stack-lg' },
      el('label', { class: 'field__label', for: 'pb-id' }, 'or a build id'),
      el('div', { class: 'row-inline' }, buildId, fetchById),
      el('small', { class: 'faint' }, capabilities.buildIdNote ?? '')),
    message,
    diff,
  );

  dialog.showModal();
}

const prettyPath = (path) => String(path).split('.').map(
  (part) => (/^\d+$/.test(part) ? `#${Number(part) + 1}` : titleCase(part.replace(/([a-z])([A-Z])/g, '$1 $2'))),
).join(' → ');

function preview_(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}
