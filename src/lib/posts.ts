import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export async function publishedPosts() {
  const posts = await getCollection('posts', ({ data }) => !data.draft && data.date.getTime() <= Date.now());
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function readingTime(post: Post) {
  return Math.max(1, Math.ceil((post.body ?? '').trim().split(/\s+/).length / 200));
}

export function formatDate(date: Date) {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
