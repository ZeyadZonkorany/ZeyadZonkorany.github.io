import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.error('Usage: npm run new-post -- "Your article title"');
  process.exit(1);
}
const slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!slug) {
  console.error('Please include at least one letter or number in the title.');
  process.exit(1);
}
const directory = path.join(root, 'src/content/posts');
const target = path.join(directory, `${slug}.md`);
let template = await readFile(path.join(root, 'templates/post.md'), 'utf8');
template = template.replace('"Your article title"', JSON.stringify(title)).replace('2026-09-29', new Date().toISOString().slice(0, 10));
await mkdir(directory, { recursive: true });
try {
  await writeFile(target, template, { flag: 'wx' });
  console.log(`Created src/content/posts/${slug}.md\nWrite your article, then set draft: false to publish it.`);
} catch (error) {
  if (error.code === 'EEXIST') console.error(`A post named ${slug}.md already exists.`);
  else throw error;
  process.exit(1);
}
