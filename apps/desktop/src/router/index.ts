/**
 * App routes (hash history). Shared by all modules; change with care.
 * Views are lazy-loaded so heavy deps (pdfjs, mammoth) stay split.
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { isTauri } from '@/lib/tauri'

declare module 'vue-router' {
  interface RouteMeta {
    /** Requires an eCamp session; otherwise redirect to /verbindung. */
    requiresAuth?: boolean
    /** i18n key of the page title. */
    titleKey?: string
  }
}

export const CAMP_TABS = [
  { path: 'uebersicht', name: 'camp-overview', titleKey: 'campTabs.overview', icon: 'mdi-view-dashboard-outline' },
  { path: 'raster', name: 'camp-grid', titleKey: 'campTabs.grid', icon: 'mdi-calendar-week' },
  { path: 'befunde', name: 'camp-findings', titleKey: 'campTabs.findings', icon: 'mdi-alert-circle-check-outline' },
  { path: 'angaben', name: 'camp-inputs', titleKey: 'campTabs.inputs', icon: 'mdi-form-select' },
  { path: 'zuordnung', name: 'camp-mapping', titleKey: 'campTabs.mapping', icon: 'mdi-shape-outline' },
  { path: 'feedback', name: 'camp-feedback', titleKey: 'campTabs.feedback', icon: 'mdi-message-draw' },
  { path: 'dokumente', name: 'camp-documents', titleKey: 'campTabs.documents', icon: 'mdi-file-document-multiple-outline' },
  { path: 'runden', name: 'camp-rounds', titleKey: 'campTabs.rounds', icon: 'mdi-history' },
] as const

export type CampTabName = (typeof CAMP_TABS)[number]['name']

const campViews: Record<CampTabName, () => Promise<unknown>> = {
  'camp-overview': () => import('@/views/cockpit/OverviewView.vue'),
  'camp-grid': () => import('@/views/cockpit/GridView.vue'),
  'camp-findings': () => import('@/views/cockpit/FindingsView.vue'),
  'camp-inputs': () => import('@/views/camps/CoachInputsView.vue'),
  'camp-mapping': () => import('@/views/camps/MappingView.vue'),
  'camp-feedback': () => import('@/views/feedback/FeedbackView.vue'),
  'camp-documents': () => import('@/views/documents/DocumentsView.vue'),
  'camp-rounds': () => import('@/views/rounds/RoundsView.vue'),
}

export const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', redirect: () => (useSession().isLoggedIn.value ? '/lager' : '/verbindung') },
  {
    path: '/verbindung',
    name: 'connection',
    component: () => import('@/views/connection/ConnectionView.vue'),
    meta: { titleKey: 'nav.connection' },
  },
  {
    path: '/lager',
    name: 'camps',
    component: () => import('@/views/camps/CampsView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.camps' },
  },
  {
    path: '/lager/:campId',
    component: () => import('@/layouts/CampLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'camp', redirect: (to) => ({ name: 'camp-overview', params: to.params }) },
      ...CAMP_TABS.map((tab) => ({
        path: tab.path,
        name: tab.name,
        component: campViews[tab.name],
        meta: { requiresAuth: true, titleKey: tab.titleKey },
      })),
    ],
  },
  {
    path: '/fristen',
    name: 'deadlines',
    component: () => import('@/views/rules/DeadlinesView.vue'),
    meta: { titleKey: 'nav.deadlines' },
  },
  {
    path: '/regeln',
    name: 'rules',
    component: () => import('@/views/rules/RulesCatalogView.vue'),
    meta: { titleKey: 'nav.rules' },
  },
  {
    path: '/einstellungen',
    name: 'settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { titleKey: 'nav.settings' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const session = useSession()
  // Restore an existing Rust-side session before deciding (idempotent).
  if (isTauri()) await session.init()
  if (to.matched.some((r) => r.meta.requiresAuth) && !session.isLoggedIn.value) {
    return { name: 'connection', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
