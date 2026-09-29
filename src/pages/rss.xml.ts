import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedPosts } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = await publishedPosts();
  return rss({
    title: 'Zonkor — Security research & field notes',
    description: 'Web security, CTF writeups, and notes from looking a little closer.',
    site: context.site!,
    items: posts.map((post) => ({ title: post.data.title, description: post.data.description, pubDate: post.data.date, link: `/writing/${post.id}/`, categories: post.data.tags })),
    customData: '<language>en</language>',
  });
}
