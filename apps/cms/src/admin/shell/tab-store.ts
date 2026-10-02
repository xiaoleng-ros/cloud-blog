/**
 * 顶栏多标签状态（浏览器式 Tab 条）。
 *
 * 用模块级 store + useSyncExternalStore，而不是 context：
 * 标签状态要被 PageTab 和命令面板同时读，且必须跨路由切换保持（两者都是 Payload 的独立挂载点）。
 * 持久化到 localStorage，刷新后标签不丢（与 ThriveX-Admin 的 tabs_storage 同思路）。
 */

export type ShellTab = {
  /** 完整后台路径，如 /admin/collections/posts */
  path: string
  title: string
}

type State = {
  tabs: ShellTab[]
  active: string
}

const STORAGE_KEY = 'yx-admin-tabs'

/** 持久化超过 7 天整体作废：导航结构可能已变，旧标签不应无限期复活 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const EMPTY: State = { tabs: [], active: '' }

let state: State = EMPTY
// 已知合法 path 集合（由 PageTab 依 nav-config 注入）；为空时不做 path 过滤
let allowedPaths: Set<string> | null = null
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

const persist = () => {
  if (typeof window === 'undefined') return
  try {
    const tabs = allowedPaths ? state.tabs.filter((tab) => allowedPaths!.has(tab.path)) : state.tabs
    const active = allowedPaths && tabs.length > 0 && tabs.some((tab) => tab.path === state.active)
      ? state.active
      : tabs[0]?.path ?? ''
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs, active, savedAt: Date.now() }),
    )
  } catch {
    // 隐私模式/配额写不进去不影响功能，只是刷新会丢标签
  }
}

const commit = (next: State) => {
  state = next
  persist()
  emit()
}

export const subscribeTabs = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getTabsSnapshot = (): State => state

export const getServerSnapshot = (): State => EMPTY

/** 挂载时读回本地标签；空则用初始页兜底 */
export const hydrateTabs = (fallback: ShellTab, allowed?: Set<string>) => {
  if (typeof window === 'undefined') return
  allowedPaths = allowed ?? null
  let parsed: State | null = null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as Partial<State> & { savedAt?: number }
      const fresh = typeof data.savedAt === 'number' && Date.now() - data.savedAt <= MAX_AGE_MS
      if (fresh && Array.isArray(data.tabs) && data.tabs.length > 0) {
        parsed = {
          tabs: data.tabs
            .filter(
              (tab): tab is ShellTab =>
                typeof tab?.path === 'string' &&
                typeof tab?.title === 'string' &&
                (!allowedPaths || allowedPaths.has(tab.path)),
            )
            .slice(0, 20),
          active: typeof data.active === 'string' ? data.active : '',
        }
        if (parsed.tabs.length === 0) parsed = null
      }
    }
  } catch {
    parsed = null
  }

  if (parsed) {
    // 存过的 active 可能已不在 tabs 里（旧版本数据结构 / 被 path 白名单过滤掉），落到第一个标签
    if (!parsed.tabs.some((tab) => tab.path === parsed!.active)) parsed.active = parsed.tabs[0].path
    commit(parsed)
  } else {
    commit({ tabs: [fallback], active: fallback.path })
  }
}

/** 打开（或激活）一个标签 */
export const openTab = (tab: ShellTab) => {
  const exists = state.tabs.some((item) => item.path === tab.path)
  commit({
    tabs: exists ? state.tabs : [...state.tabs, tab],
    active: tab.path,
  })
}

export const activateTab = (path: string) => {
  if (state.active === path) return
  commit({ tabs: state.tabs, active: path })
}

/**
 * 关闭标签：始终至少保留一个；关掉当前激活项时返回应当跳转的邻居路径，
 * 由调用方决定怎么导航（PageTab 里走 Payload 的 Link/router）。
 */
export const closeTab = (path: string): { nextActive: string; navigateTo?: string } => {
  const index = state.tabs.findIndex((tab) => tab.path === path)
  if (index < 0) return { nextActive: state.active }

  const tabs = state.tabs.filter((tab) => tab.path !== path)
  if (tabs.length === 0) return { nextActive: state.active }

  if (state.active !== path) {
    commit({ tabs, active: state.active })
    return { nextActive: state.active }
  }

  // 关的是当前页：优先左邻，没有左邻取下一个
  const neighbour = tabs[index - 1] ?? tabs[index] ?? tabs[0]
  commit({ tabs, active: neighbour.path })
  return { nextActive: neighbour.path, navigateTo: neighbour.path }
}

export const closeOthers = (path: string): { navigateTo?: string } => {
  const keep = state.tabs.find((tab) => tab.path === path)
  if (!keep) return {}
  const navigatingAway = state.active !== path
  commit({ tabs: [keep], active: keep.path })
  return navigatingAway ? { navigateTo: keep.path } : {}
}

/** 关闭全部：回到第一个标签（与 ThriveX「至少留一个」一致） */
export const closeAllTabs = (): { navigateTo?: string } => {
  if (state.tabs.length <= 1) return {}
  const first = state.tabs[0]
  const navigatingAway = state.active !== first.path
  commit({ tabs: [first], active: first.path })
  return navigatingAway ? { navigateTo: first.path } : {}
}
