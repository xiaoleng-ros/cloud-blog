/**
 * html-inject 新版（parse5 实现）行为验证脚本
 *
 * 运行方式：
 *   node scripts/verify-html-inject.mjs
 *
 * 覆盖用例：
 *   1.  单个 div 锚点、简单内容
 *   2.  多锚点顺序混合
 *   3.  带 title 替换
 *   4.  空 blocks
 *   5.  NON_ELEMENT_BLOCKS 跳过
 *   6.  空 blockHtml 跳过
 *   7.  锚点不存在
 *   8.  同名嵌套 article（parse5 关键优势）
 *   9.  属性带单引号 / 无引号
 *   10. html 完全不是 HTML
 *   11. 未闭合标签
 */
import { injectSyncBlocks } from '../src/lib/html-inject.ts'

// 用例状态
let passed = 0
let failed = 0
const failures = []

function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✅ ${name}`)
    passed += 1
  } else {
    console.log(`  ❌ ${name}\n     ${detail}`)
    failed += 1
    failures.push(name)
  }
}

// ========== 用例 1：单个 div 锚点 ==========
console.log('\n[用例 1] 单个 div 锚点、简单内容')
{
  const html = `<!doctype html><html><head><title>T</title></head><body><div data-sync-block="hero">旧</div></body></html>`
  const r = injectSyncBlocks(html, { hero: '<p>新</p>' }, 'v1')
  check('注入成功', r.injected.length === 1 && r.injected[0] === 'hero')
  check('跳过为空', r.skipped.length === 0)
  check('innerHTML 被替换', r.html.includes('<p>新</p>'))
  check('data-sync-version 已写入', r.html.includes('data-sync-version="v1"'))
  check('开标签保留原属性', r.html.includes('data-sync-block="hero"'))
}

// ========== 用例 2：多锚点顺序混合 ==========
console.log('\n[用例 2] 多锚点顺序混合')
{
  const html = `<!doctype html><html><body><div data-sync-block="a">A</div><div data-sync-block="b">B</div><div data-sync-block="c">C</div></body></html>`
  // version 用不含数字的字符串，避免与 block 内容里的 '1' '2' '3' 混淆
  const r = injectSyncBlocks(html, { a: '1', b: '2', c: '3' }, 'v')
  check('3 个全部注入', r.injected.length === 3)
  check(
    '顺序在文档中保持',
    r.html.indexOf('>1<') < r.html.indexOf('>2<') && r.html.indexOf('>2<') < r.html.indexOf('>3<'),
  )
}

// ========== 用例 3：带 title 替换 ==========
console.log('\n[用例 3] 带 title 替换')
{
  const html = `<!doctype html><html><head><title>旧标题</title></head><body><div data-sync-block="x">X</div></body></html>`
  const r = injectSyncBlocks(html, { x: '1' }, 'v', '新标题 < >')
  check('title 被替换', r.html.includes('<title>新标题 &lt; &gt;</title>'))
  check('旧标题已消失', !r.html.includes('旧标题'))
}

// ========== 用例 4：空 blocks ==========
console.log('\n[用例 4] 空 blocks')
{
  const html = '<!doctype html><html><body><div data-sync-block="a">X</div></body></html>'
  const r = injectSyncBlocks(html, {}, 'v')
  check('html 不变', r.html === html)
  check('injected 为空', r.injected.length === 0)
  check('skipped 为空', r.skipped.length === 0)
}

// ========== 用例 5：NON_ELEMENT_BLOCKS ==========
console.log('\n[用例 5] NON_ELEMENT_BLOCKS 跳过（不进 injected 也不进 skipped）')
{
  const html = '<!doctype html><html><head><title>原</title></head><body></body></html>'
  const r = injectSyncBlocks(html, { pageTitle: '忽略' }, 'v')
  check('不注入', !r.injected.includes('pageTitle'))
  check('也不计入 skipped', !r.skipped.includes('pageTitle'))
  check('html 完全不变', r.html === html)
}

// ========== 用例 6：空 blockHtml ==========
console.log('\n[用例 6] 空 blockHtml 进 skipped')
{
  const html = '<!doctype html><html><body><div data-sync-block="a">X</div></body></html>'
  const r = injectSyncBlocks(html, { a: '' }, 'v')
  check('injected 为空', r.injected.length === 0)
  check('a 在 skipped', r.skipped.includes('a'))
  check('原内容保持', r.html.includes('>X<'))
}

// ========== 用例 7：锚点不存在 ==========
console.log('\n[用例 7] 锚点不存在进 skipped')
{
  const html = '<!doctype html><html><body><div id="other">X</div></body></html>'
  const r = injectSyncBlocks(html, { a: '1' }, 'v')
  check('injected 为空', r.injected.length === 0)
  check('a 在 skipped', r.skipped.includes('a'))
  check('html 不变', r.html === html)
}

// ========== 用例 8：同名嵌套 article（parse5 关键优势）==========
console.log('\n[用例 8] 同名嵌套 <article>，只替换外层 innerHTML')
{
  const html = `<html><body><article data-sync-block="outer"><article>嵌套</article></article></body></html>`
  const r = injectSyncBlocks(html, { outer: '<p>新</p>' }, 'v')
  check('注入成功', r.injected.includes('outer'))
  check('新内容出现在输出', r.html.includes('<p>新</p>'))
  check('内层 <article>嵌套</article> 已被替换（不再出现）', !r.html.includes('嵌套'))
  check('外层闭合标签仍在', r.html.includes('</article></body>'))
}

// ========== 用例 9：属性带单引号 / 无引号 ==========
console.log('\n[用例 9] 属性带单引号 / 无引号')
{
  // 单引号
  const html1 = `<html><body><div data-sync-block='quoteA'>X</div></body></html>`
  const r1 = injectSyncBlocks(html1, { quoteA: 'Y' }, 'v')
  check('单引号锚点命中', r1.injected.includes('quoteA'))
  check('单引号属性原样保留', r1.html.includes("data-sync-block='quoteA'"))

  // 无引号（HTML5 允许）
  const html2 = `<html><body><div data-sync-block=unquoted>X</div></body></html>`
  const r2 = injectSyncBlocks(html2, { unquoted: 'Y' }, 'v')
  check('无引号锚点命中', r2.injected.includes('unquoted'))
}

// ========== 用例 10：html 完全不是 HTML ==========
console.log('\n[用例 10] html 完全不是 HTML（乱码 / 纯文本）')
{
  const html = '这不是 HTML，就是一些普通字符。'
  const r = injectSyncBlocks(html, { a: '1' }, 'v')
  check('html 保持原样', r.html === html)
  check('injected 为空', r.injected.length === 0)
  check('a 在 skipped', r.skipped.includes('a'))
}

// ========== 用例 11：未闭合标签 ==========
console.log('\n[用例 11] 未闭合标签（parse5 容错）')
{
  const html = '<html><body><div data-sync-block="unclosed">X'
  const r = injectSyncBlocks(html, { unclosed: 'Y' }, 'v')
  check('至少不抛异常', typeof r.html === 'string')
  check('输出包含新内容', r.html.includes('Y'))
}

// ========== 用例 12（回归）：注释里的假标签 ==========
console.log('\n[用例 12] 注释里的假标签不应被识别为锚点（旧版可能误配）')
{
  const html = `<html><body><!-- <div data-sync-block="fake"></div> --><div data-sync-block="real">X</div></body></html>`
  const r = injectSyncBlocks(html, { real: 'Y' }, 'v')
  check('只注入 real', r.injected.length === 1 && r.injected[0] === 'real')
  check('fake 未注入', !r.injected.includes('fake'))
  check('注释保持不变', r.html.includes('<!-- <div data-sync-block="fake"></div> -->'))
}

// ========== 用例 13（回归）：script 里的 <div 内容 ==========
console.log('\n[用例 13] script 里的 <div 文本不应被解析为标签')
{
  const html = `<html><body><script>var x = '<div data-sync-block="evil">';</script><div data-sync-block="real">X</div></body></html>`
  const r = injectSyncBlocks(html, { real: 'Y' }, 'v')
  check('只注入 real', r.injected.length === 1 && r.injected[0] === 'real')
  check('evil 未注入', !r.injected.includes('evil'))
  check('script 内容保持不变', r.html.includes('data-sync-block="evil"'))
}

// ========== 用例 14：自闭合锚点应跳过 ==========
console.log('\n[用例 14] 自闭合锚点 <br data-sync-block> 应跳过（VOID）')
{
  const html = '<html><body><br data-sync-block="voidA"><div data-sync-block="ok">X</div></body></html>'
  const r = injectSyncBlocks(html, { voidA: '1', ok: '2' }, 'v')
  check('voidA 不注入', !r.injected.includes('voidA'))
  check('voidA 进 skipped', r.skipped.includes('voidA'))
  check('ok 正常注入', r.injected.includes('ok'))
}

// ========== 用例 15：更新已存在的 data-sync-version ==========
console.log('\n[用例 15] 已有 data-sync-version 应被覆盖')
{
  const html = '<html><body><div data-sync-block="a" data-sync-version="old">X</div></body></html>'
  const r = injectSyncBlocks(html, { a: 'Y' }, 'new')
  check('新 version 写入', r.html.includes('data-sync-version="new"'))
  check('旧 version 消失', !r.html.includes('data-sync-version="old"'))
  check('只出现一次 data-sync-version', (r.html.match(/data-sync-version/g) || []).length === 1)
}

// ========== 汇总 ==========
console.log('\n=========================================')
console.log(`通过: ${passed}  失败: ${failed}`)
if (failed > 0) {
  console.log(`失败用例: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('全部通过 🎉')
