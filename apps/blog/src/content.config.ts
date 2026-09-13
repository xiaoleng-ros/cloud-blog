import { defineCollection, z } from 'astro:content';
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
      categories: stringList,
      tags: stringList,
      keywords: stringList,
      ai: stringList,
      sticky: z.coerce.number().optional(),
      main_color: z.string().optional(),
      author: z.string().optional(),
    })
    .passthrough(),
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
    .passthrough(),
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
      icon: z.string().default('github'),
      href: z.string().optional(),
      articleHref: z.string().optional(),
      stars: z.coerce.number().default(0),
      tags: stringList,
      sortOrder: z.coerce.number().default(0),
    })
    .passthrough(),
});

export const collections = { posts, notes, projects };
