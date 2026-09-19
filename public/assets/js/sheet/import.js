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
  const builderBox = el('div', { class: 'import-builder' });
  const diff = el('div', { class: 'diff' });

  const preview = async (payload) => {
    message.textContent = 'Reading…';
    diff.replaceChildren();
    confirm.disabled = true;
    try {
      const res = await fetch(`${endpoint}/import/preview`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      /**
       * Not every answer is ours.
       *
       * The server always replies in JSON, including when it refuses -- but a
       * tunnel or a proxy in front of it answers with an HTML error page when
       * the service is restarting, and `res.json()` then throws a parser error
       * that the catch below reported verbatim: "JSON.parse: unexpected
       * character at line 1 column 1". That is a true sentence and it tells a
       * player nothing. What they need to know is that the server was not
       * there, and that trying again shortly is the answer.
       */
      const body = await res.text();
      let result = null;
      try { result = JSON.parse(body); } catch { /* not ours; handled next */ }

      if (!result) {
        message.textContent = res.ok
          ? 'The server sent something this page could not read. Try again in a moment.'
          : `The server is not answering just now (${res.status}). Try again in a moment.`;
        return;
      }

      if (!res.ok) {
        message.textContent = result.error ?? 'That did not work.';
        return;
      }
      renderDiff(result);
    } catch (error) {
      message.textContent = `Could not reach the server: ${error.message}`;
    }
  };

  /**
   * What the import would do, and the one choice inside it.
   *
   * The file is read two ways: as a set of sheet values, and as the choices
   * that would have produced them. Keeping the second is what makes the
   * character editable in the builder afterwards, and it is the default --
   * but it is a real choice, because where the reconstruction and the file
   * disagree the reconstruction wins, and only the player can say whether
   * that is what they want. So the disagreements are listed, not buried.
   */
  function renderDiff(result) {
    let useBuild = Boolean(result.builder?.build);

    const keep = el('input', {
      type: 'checkbox', id: 'import-build', checked: useBuild,
      onchange: (event) => { useBuild = event.target.checked; paint(); },
    });

    function builderCard() {
      const { summary, notes = [], differences = [] } = result.builder ?? {};
      if (!summary) return null;

      const named = [summary.ancestry, summary.heritage, summary.background, summary.class]
        .filter(Boolean).join(' · ');

      return el('div', { class: 'notice' },
        el('div', { class: 'notice__body' },
          el('label', { class: 'import-builder__keep', for: 'import-build' },
            keep, el('strong', {}, 'Also fill in the character builder')),
          el('p', { class: 'muted' },
            named ? `Level ${summary.level} — ${named}.` : `Level ${summary.level}.`,
            summary.outstanding
              ? ` ${summary.outstanding} choices the file does not record, mostly feats, will be waiting for you there.`
              : ''),
          ...notes.map((note) => el('p', { class: 'faint' }, note)),
          differences.length
            ? el('p', { class: 'muted' },
              el('strong', {}, `${differences.length} number${differences.length === 1 ? '' : 's'} would differ from the file: `),
              differences.map((d) => `${d.label} ${JSON.stringify(d.imported)} → ${JSON.stringify(d.derived)}`).join(', '),
              '. Untick the box above to keep the file’s values and leave the builder empty.')
            : null));
    }

    function paint() {
      const changes = useBuild ? (result.changes ?? []) : (result.withoutBuild ?? []);
      builderBox.replaceChildren(builderCard() ?? '');

      if (!changes.length) {
        message.textContent = 'Nothing to change — this sheet already matches that build.';
        diff.replaceChildren();
        confirm.disabled = true;
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

      if (result.warnings?.length) {
        diff.append(el('div', { class: 'notice' },
          el('div', { class: 'notice__body' },
            el('strong', {}, 'Not imported'),
            ...result.warnings.map((w) => el('p', { class: 'muted' }, w)))));
      }

      confirm.disabled = false;
      confirm.onclick = async (event) => {
        event.preventDefault();
        const accepted = [...diff.querySelectorAll('input[type=checkbox]')]
          .filter((box) => box.checked)
          .map((box) => changes[Number(box.dataset.index)]);
        const applied = await fetch(`${endpoint}/import/apply`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            changes: accepted,
            build: useBuild ? result.builder?.build ?? null : null,
          }),
        });
        // It used to close the dialog whatever came back, so a refused write
        // looked exactly like a successful one.
        if (!applied.ok) {
          message.textContent = `Those changes were not saved (${applied.status}). Nothing has changed.`;
          return;
        }
        dialog.close();
        // The server is now ahead of the local copy, so reload rather than guess.
        await store.load();
      };
    }

    paint();
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
    builderBox,
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
