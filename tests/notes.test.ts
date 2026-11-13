import assert from 'node:assert';
import test from 'node:test';
import {
  ELSEWHERE_PREFIX,
  buildNotesWorkspace,
  findOwningRoot,
  isElsewhereId,
  newNoteFileName,
  relativeInside,
  samePath,
} from '../src/services/notesWorkspace.ts';
import type { ProjectWorkspace } from '../src/types/document.ts';

test('relativeInside: matches Windows paths case- and slash-insensitively', () => {
  assert.strictEqual(relativeInside('C:\\Prj\\app\\docs\\a.md', 'c:/prj/app'), 'docs/a.md');
  assert.strictEqual(relativeInside('C:/Prj/app/a.md', 'C:\\Prj\\app\\'), 'a.md');
  assert.strictEqual(relativeInside('C:/Prj/application/a.md', 'C:/Prj/app'), null, 'sibling with shared prefix');
  assert.strictEqual(relativeInside('C:/Prj/app', 'C:/Prj/app'), null, 'the folder itself');
  assert.strictEqual(relativeInside('D:/notes/a.md', 'C:/Prj'), null);
});

test('findOwningRoot: picks the deepest containing root', () => {
  const roots = ['C:\\Prj\\mono', 'C:\\Prj\\mono\\apps\\mobile', 'C:\\Prj\\other'];
  assert.strictEqual(findOwningRoot('C:\\Prj\\mono\\apps\\mobile\\README.md', roots), 'C:\\Prj\\mono\\apps\\mobile');
  assert.strictEqual(findOwningRoot('C:\\Prj\\mono\\README.md', roots), 'C:\\Prj\\mono');
  assert.strictEqual(findOwningRoot('C:\\Users\\me\\Downloads\\x.md', roots), null);
});

test('samePath ignores case, slash style and trailing slash', () => {
  assert.ok(samePath('C:\\Users\\Me\\Documents\\DocAtlas Notes\\', 'c:/users/me/documents/docatlas notes'));
});

test('newNoteFileName: dated name, de-duplicated', () => {
  const now = new Date(2026, 10, 13, 9, 5);
  assert.strictEqual(newNoteFileName(now, []), 'Note 2026-11-13 0905.md');
  assert.strictEqual(newNoteFileName(now, ['note 2026-11-13 0905.md']), 'Note 2026-11-13 0905 2.md');
  assert.strictEqual(
    newNoteFileName(now, ['Note 2026-11-13 0905.md', 'Note 2026-11-13 0905 2.md']),
    'Note 2026-11-13 0905 3.md'
  );
});

function notesBase(): ProjectWorkspace {
  return {
    name: 'DocAtlas Notes',
    rootPath: 'C:/Users/me/Documents/DocAtlas Notes',
    isLocalFolder: true,
    files: [
      {
        id: 'Groceries.md',
        path: 'Groceries.md',
        fullPath: 'C:/Users/me/Documents/DocAtlas Notes/Groceries.md',
        name: 'Groceries.md',
        content: '# Groceries\n- [ ] milk\n',
        frontmatter: {},
        body: '# Groceries\n- [ ] milk\n',
        wordCount: 3,
        tasks: [],
      },
    ],
    tree: {
      id: 'DocAtlas Notes',
      name: 'DocAtlas Notes',
      path: '',
      isFolder: true,
      itemCount: 1,
      children: [{ id: 'Groceries.md', name: 'Groceries.md', path: 'Groceries.md', isFolder: false }],
    },
  };
}

test('buildNotesWorkspace: outside files go under a virtual folder with stable, unique ids', () => {
  const ws = buildNotesWorkspace(notesBase(), [
    { fullPath: 'C:\\Users\\me\\Downloads\\README.md', content: '# Downloaded\n- [ ] read it\n' },
    { fullPath: 'D:\\work\\README.md', content: 'Second readme' },
  ]);
  assert.strictEqual(ws.kind, 'notes');
  assert.strictEqual(ws.name, 'Notes');
  assert.deepStrictEqual(
    ws.files.map((f) => f.id),
    ['Groceries.md', `${ELSEWHERE_PREFIX}/README.md`, `${ELSEWHERE_PREFIX}/README (2).md`]
  );
  const outside = ws.files[1];
  assert.strictEqual(outside.fullPath, 'C:/Users/me/Downloads/README.md', 'saves go back to the real file');
  assert.strictEqual(outside.tasks.length, 1, 'parsed like any other doc');
  const virtualFolder = ws.tree.children!.find((c) => c.id === ELSEWHERE_PREFIX)!;
  assert.strictEqual(virtualFolder.children!.length, 2);
  assert.strictEqual(virtualFolder.fullPath, undefined, 'the virtual folder has no place on disk');
  assert.strictEqual(ws.tree.itemCount, 3);
});

test('buildNotesWorkspace: rebuilding does not duplicate the outside files', () => {
  const once = buildNotesWorkspace(notesBase(), [{ fullPath: 'D:/a.md', content: 'a' }]);
  const twice = buildNotesWorkspace(once, [{ fullPath: 'D:/a.md', content: 'a' }]);
  assert.strictEqual(twice.files.length, 2);
  assert.strictEqual(twice.tree.children!.filter((c) => isElsewhereId(c.id)).length, 1);
});

test('buildNotesWorkspace: no virtual folder when nothing was opened from elsewhere', () => {
  const ws = buildNotesWorkspace(notesBase(), []);
  assert.ok(!ws.tree.children!.some((c) => isElsewhereId(c.id)));
});

test('MarkdownService.rebuild: editing a plain file never adds frontmatter it did not have', async () => {
  const { MarkdownService } = await import('../src/services/markdown.ts');
  const plain = '# Shopping\n\n- [ ] milk\n';
  const parsed = MarkdownService.parse(plain);
  assert.ok(parsed.frontmatter.title, 'parse fills in a default title');
  const original = { content: plain, frontmatter: parsed.frontmatter };
  assert.strictEqual(MarkdownService.rebuild(original, parsed.frontmatter, '# Shopping\n\n- [x] milk\n'), '# Shopping\n\n- [x] milk\n');

  // Changing a property is an explicit choice: then frontmatter is written.
  const withStatus = MarkdownService.rebuild(original, { ...parsed.frontmatter, status: 'Done' }, parsed.body);
  assert.ok(withStatus.startsWith('---\n') && withStatus.includes('status: Done'));

  // Files that already had frontmatter keep it.
  const fm = '---\ntitle: Plan\n---\n\nBody\n';
  const p2 = MarkdownService.parse(fm);
  assert.ok(MarkdownService.rebuild({ content: fm, frontmatter: p2.frontmatter }, p2.frontmatter, 'New body\n').startsWith('---\n'));
});

test('newNoteContent: plain heading named after the file', async () => {
  const { newNoteContent } = await import('../src/services/notesWorkspace.ts');
  assert.strictEqual(newNoteContent('Note 2026-11-13 0905.md'), '# Note 2026-11-13 0905\n\n');
});
