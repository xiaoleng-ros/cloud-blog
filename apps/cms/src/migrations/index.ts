import * as migration_20260910_061332_init from './20260910_061332_init';
import * as migration_20260910_062703_footer_about_fields from './20260910_062703_footer_about_fields';

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
];
