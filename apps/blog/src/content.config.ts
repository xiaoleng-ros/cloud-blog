import { defineCollection } from 'astro:content';
// `z` 从 astro:content 导入已废弃（Astro 7 移除），改为直连 astro/zod（同源 zod v4）
import { z } from 'astro/zod';
import { DEFAULT_PROJECT_ICON } from 'cloud-blog/shared/post-utils';
import { payloadNotesLoader, payloadPostsLoader, payloadProjectsLoader } from './lib/payload-loader';

const stringList = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  return [String(value)];
}, z.array(z.string()).optional());

const posts = defineCollection({
  loader: payloadPostsLoader,
  schema: z
    .object({
      title: z.string(),
      description: z.string().optional(),
      date: z.coerce.date().optional(),
      updated: z.coerce.date().optional(),
      cover: z.string().optional(),
      coverAlt: z.string().optional(),
      categories: stringList,
      tags: stringList,
      keywords: stringList,
      ai: stringList,
      sticky: z.coerce.number().optional(),
      main_color: z.string().optional(),
      author: z.string().optional(),
    })
    .loose(),
});

const notes = defineCollection({
  loader: payloadNotesLoader,
  schema: z
    .object({
      date: z.coerce.date(),
      title: z.string().optional(),
      mood: z.string().optional(),
      tags: stringList,
    })
    .loose(),
});

const projects = defineCollection({
  loader: payloadProjectsLoader,
  schema: z
    .object({
      group: z.string(),
      groupDescription: z.string().optional(),
      title: z.string(),
      owner: z.string().optional(),
      description: z.string().optional(),
      icon: z.string().default(DEFAULT_PROJECT_ICON),
      href: z.string().optional(),
      articleHref: z.string().optional(),
      stars: z.coerce.number().default(0),
      tags: stringList,
      sortOrder: z.coerce.number().default(0),
    })
    .loose(),
});

export const collections = { posts, notes, projects };
