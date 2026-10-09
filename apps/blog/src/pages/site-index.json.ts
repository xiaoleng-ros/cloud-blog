import { buildSiteIndex } from '../lib/site-index';

/** 构建期产出静态 JSON（与改造前的 /search.json 同一条路），运行时零依赖后台 */
export async function GET() {
  const items = await buildSiteIndex();

  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
