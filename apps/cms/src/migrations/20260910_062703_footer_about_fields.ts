import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ADD COLUMN "footer_subtitle" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "footer_channels" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "footer_groups" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "about_lead" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "about_paragraphs" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "about_notes" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "skills" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN "footer_subtitle";
  ALTER TABLE "site_settings" DROP COLUMN "footer_channels";
  ALTER TABLE "site_settings" DROP COLUMN "footer_groups";
  ALTER TABLE "site_settings" DROP COLUMN "about_lead";
  ALTER TABLE "site_settings" DROP COLUMN "about_paragraphs";
  ALTER TABLE "site_settings" DROP COLUMN "about_notes";
  ALTER TABLE "site_settings" DROP COLUMN "skills";`)
}
