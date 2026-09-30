import * as migration_20260910_061332_init from './20260910_061332_init';
import * as migration_20260910_062703_footer_about_fields from './20260910_062703_footer_about_fields';
import * as migration_20260913_000000_projects_collection from './20260913_000000_projects_collection';
import * as migration_20260926_000000_remove_posts_slug_add_categories from './20260926_000000_remove_posts_slug_add_categories';
import * as migration_20260929_000000_add_users_feishu_binding from './20260929_000000_add_users_feishu_binding';
import * as migration_20260930_000000_add_posts_notes_trash from './20260930_000000_add_posts_notes_trash';
import * as migration_20261001_000000_add_categories_tree_fields from './20261001_000000_add_categories_tree_fields';

export const migrations = [
  {
    up: migration_20260910_061332_init.up,
    down: migration_20260910_061332_init.down,
    name: '20260910_061332_init',
  },
  {
    up: migration_20260910_062703_footer_about_fields.up,
    down: migration_20260910_062703_footer_about_fields.down,
    name: '20260910_062703_footer_about_fields'
  },
  {
    up: migration_20260913_000000_projects_collection.up,
    down: migration_20260913_000000_projects_collection.down,
    name: '20260913_000000_projects_collection'
  },
  {
    up: migration_20260926_000000_remove_posts_slug_add_categories.up,
    down: migration_20260926_000000_remove_posts_slug_add_categories.down,
    name: '20260926_000000_remove_posts_slug_add_categories'
  },
  {
    up: migration_20260929_000000_add_users_feishu_binding.up,
    down: migration_20260929_000000_add_users_feishu_binding.down,
    name: '20260929_000000_add_users_feishu_binding'
  },
  {
    up: migration_20260930_000000_add_posts_notes_trash.up,
    down: migration_20260930_000000_add_posts_notes_trash.down,
    name: '20260930_000000_add_posts_notes_trash'
  },
  {
    up: migration_20261001_000000_add_categories_tree_fields.up,
    down: migration_20261001_000000_add_categories_tree_fields.down,
    name: '20261001_000000_add_categories_tree_fields'
  },
];
