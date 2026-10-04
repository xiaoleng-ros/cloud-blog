import { CoverField as CoverField_b015e341ee5dfbb7005249419be75cfd } from '../../../../src/admin/components/CoverField.tsx'
import { PostCategoryField as PostCategoryField_665e39a0443bb5ed393749b801571ddc } from '../../../../src/admin/components/PostCategoryField.tsx'
import { MarkdownEditorField as MarkdownEditorField_39f26ae0489753f9c48c7dcf90ee0578 } from '../../../../src/editor/MarkdownEditor.tsx'
import { ManageListView as ManageListView_73e62e78b473461b8f71e9dc8c2a32e4 } from '../../../../src/admin/views/manage/ManageListView.tsx'
import { CategoriesListView as CategoriesListView_04455d182a2a787ecb77abe09ca9dee3 } from '../../../../src/admin/views/categories/CategoriesListView.tsx'
import { TagsListView as TagsListView_3d89435d3501d2d917eb5ad710f3d99f } from '../../../../src/admin/views/tags/TagsListView.tsx'
import { SocialLinksField as SocialLinksField_1abbff97fa1db6a0b8127a2e95003282 } from '../../../../src/admin/components/SocialLinksField.tsx'
import { SettingsEditView as SettingsEditView_a0483073a84181b706dc6515a5f5484a } from '../../../../src/admin/views/settings/SettingsEditView.tsx'
import { NavigationEditView as NavigationEditView_1a7ae34319671bedacdee41f2e6db9aa } from '../../../../src/admin/views/navigation/NavigationEditView.tsx'
import { CustomNav as CustomNav_c3cf622793693287a4c5a05434793407 } from '../../../../src/admin/components/CustomNav.tsx'
import { CloudLogo as CloudLogo_d06fa95a4848ce56f762457715ce74a8 } from '../../../../src/admin/components/CloudGraphics.tsx'
import { FeishuLoginLink as FeishuLoginLink_0f328b3dd0359a00a9fa353533b9b593 } from '../../../../src/admin/components/FeishuLoginLink.tsx'
import { LoginBrand as LoginBrand_6a9d4450ccefb77d748f6fa2e00f2590 } from '../../../../src/admin/components/LoginBrand.tsx'
import { AdminShell as AdminShell_f209b93b646b4cabbc227d16b216c7fb } from '../../../../src/admin/shell/AdminShell.tsx'
import { S3ClientUploadHandler as S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24 } from '@payloadcms/storage-s3/client'
import { DashboardView as DashboardView_1b3552f3c55b03dbdd4b9732a8e74d1d } from '../../../../src/admin/views/DashboardView.tsx'
import { AccountView as AccountView_b1e2354f00c039951dd0009e54fea135 } from '../../../../src/admin/views/AccountView.tsx'
import { PostComposeView as PostComposeView_c48bc1412d48efbcf260795811a628d2 } from '../../../../src/admin/views/write/PostComposeView.tsx'
import { NoteComposeView as NoteComposeView_af4b37b184560c1455536f139ac92696 } from '../../../../src/admin/views/write/NoteComposeView.tsx'
import { DraftsView as DraftsView_e8ffb8e11909aedb00bac5188e12dcc7 } from '../../../../src/admin/views/drafts/DraftsView.tsx'
import { TrashView as TrashView_dfd0e9988da2b44465fe388ce4eeaedf } from '../../../../src/admin/views/trash/TrashView.tsx'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'

/** @type import('payload').ImportMap */
export const importMap = {
  "/src/admin/components/CoverField.tsx#CoverField": CoverField_b015e341ee5dfbb7005249419be75cfd,
  "/src/admin/components/PostCategoryField.tsx#PostCategoryField": PostCategoryField_665e39a0443bb5ed393749b801571ddc,
  "/src/editor/MarkdownEditor.tsx#MarkdownEditorField": MarkdownEditorField_39f26ae0489753f9c48c7dcf90ee0578,
  "/src/admin/views/manage/ManageListView.tsx#ManageListView": ManageListView_73e62e78b473461b8f71e9dc8c2a32e4,
  "/src/admin/views/categories/CategoriesListView.tsx#CategoriesListView": CategoriesListView_04455d182a2a787ecb77abe09ca9dee3,
  "/src/admin/views/tags/TagsListView.tsx#TagsListView": TagsListView_3d89435d3501d2d917eb5ad710f3d99f,
  "/src/admin/components/SocialLinksField.tsx#SocialLinksField": SocialLinksField_1abbff97fa1db6a0b8127a2e95003282,
  "/src/admin/views/settings/SettingsEditView.tsx#SettingsEditView": SettingsEditView_a0483073a84181b706dc6515a5f5484a,
  "/src/admin/views/navigation/NavigationEditView.tsx#NavigationEditView": NavigationEditView_1a7ae34319671bedacdee41f2e6db9aa,
  "/src/admin/components/CustomNav.tsx#CustomNav": CustomNav_c3cf622793693287a4c5a05434793407,
  "/src/admin/components/CloudGraphics.tsx#CloudLogo": CloudLogo_d06fa95a4848ce56f762457715ce74a8,
  "/src/admin/components/FeishuLoginLink.tsx#FeishuLoginLink": FeishuLoginLink_0f328b3dd0359a00a9fa353533b9b593,
  "/src/admin/components/LoginBrand.tsx#LoginBrand": LoginBrand_6a9d4450ccefb77d748f6fa2e00f2590,
  "/src/admin/shell/AdminShell.tsx#AdminShell": AdminShell_f209b93b646b4cabbc227d16b216c7fb,
  "@payloadcms/storage-s3/client#S3ClientUploadHandler": S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24,
  "/src/admin/views/DashboardView.tsx#DashboardView": DashboardView_1b3552f3c55b03dbdd4b9732a8e74d1d,
  "/src/admin/views/AccountView.tsx#AccountView": AccountView_b1e2354f00c039951dd0009e54fea135,
  "/src/admin/views/write/PostComposeView.tsx#PostComposeView": PostComposeView_c48bc1412d48efbcf260795811a628d2,
  "/src/admin/views/write/NoteComposeView.tsx#NoteComposeView": NoteComposeView_af4b37b184560c1455536f139ac92696,
  "/src/admin/views/drafts/DraftsView.tsx#DraftsView": DraftsView_e8ffb8e11909aedb00bac5188e12dcc7,
  "/src/admin/views/trash/TrashView.tsx#TrashView": TrashView_dfd0e9988da2b44465fe388ce4eeaedf,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1
}
