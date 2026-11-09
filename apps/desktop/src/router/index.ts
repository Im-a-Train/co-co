/**
 * App routes (hash history). Shared by all modules; change with care.
 * Views are lazy-loaded so heavy deps (pdfjs, mammoth) stay split.
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { useDataStore } from '@/composables/useDataStore'
import { useSession } from '@/composables/useSession'
import { isTauri } from '@/lib/tauri'

declare module 'vue-router' {
  interface RouteMeta {
    /** Requires an eCamp session and the unlocked encrypted data store; otherwise redirect to /verbindung. */
    requiresAuth?: boolean
    /** i18n key of the page title. */
    titleKey?: string
  }
}

export const CAMP_TABS = [
  { path: 'uebersicht', name: 'camp-overview', titleKey: 'campTabs.overview', icon: 'mdi-view-dashboard-outline' },
  { path: 'raster', name: 'camp-grid', titleKey: 'campTabs.grid', titleLongKey: 'campTabs.gridLong', icon: 'mdi-calendar-week' },
  { path: 'aktivitaeten', name: 'camp-activities', titleKey: 'campTabs.activities', titleLongKey: 'campTabs.activitiesLong', icon: 'mdi-format-list-bulleted' },
  { path: 'befunde', name: 'camp-findings', titleKey: 'campTabs.findings', icon: 'mdi-alert-circle-check-outline' },
  { path: 'selbstcheck', name: 'camp-selfcheck', titleKey: 'campTabs.selfCheck', icon: 'mdi-clipboard-check-outline' },
  { path: 'angaben', name: 'camp-inputs', titleKey: 'campTabs.inputs', icon: 'mdi-form-select' },
  { path: 'checkliste', name: 'camp-checklist', titleKey: 'campTabs.checklist', icon: 'mdi-format-list-checks' },
  { path: 'personen', name: 'camp-persons', titleKey: 'campTabs.persons', icon: 'mdi-account-group-outline' },
  { path: 'feedback', name: 'camp-feedback', titleKey: 'campTabs.feedback', icon: 'mdi-message-draw' },
  { path: 'dokumente', name: 'camp-documents', titleKey: 'campTabs.documents', icon: 'mdi-file-document-multiple-outline' },
  { path: 'runden', name: 'camp-rounds', titleKey: 'campTabs.rounds', icon: 'mdi-history' },
] as const

export type CampTabName = (typeof CAMP_TABS)[number]['name']

const campViews: Record<CampTabName, () => Promise<unknown>> = {
  'camp-overview': () => import('@/views/cockpit/OverviewView.vue'),
  'camp-grid': () => import('@/views/cockpit/GridView.vue'),
  'camp-activities': () => import('@/views/cockpit/ActivitiesView.vue'),
  'camp-findings': () => import('@/views/cockpit/FindingsView.vue'),
  'camp-selfcheck': () => import('@/views/selfCheck/SelfCheckView.vue'),
  'camp-inputs': () => import('@/views/camps/CoachInputsView.vue'),
  'camp-checklist': () => import('@/views/checklist/ChecklistView.vue'),
  'camp-persons': () => import('@/views/persons/PersonsView.vue'),
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
      // The mapping lives in a collapsible section of the GP view; the old URL redirects there.
      {
        path: 'zuordnung',
        name: 'camp-mapping',
        redirect: (to) => ({ name: 'camp-grid', params: to.params, query: { zuordnung: '1' } }),
      },
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
    meta: { requiresAuth: true, titleKey: 'nav.deadlines' },
  },
  {
    path: '/regeln',
    name: 'rules',
    component: () => import('@/views/rules/RulesCatalogView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.rules' },
  },
  {
    // ADR 0013: Hilfsmittel (reference documents and links the rules cite). `?key=<SOURCE-KEY>` opens one.
    path: '/hilfsmittel',
    name: 'resources',
    component: () => import('@/views/resources/ResourcesView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.resources' },
  },
  {
    path: '/einstellungen',
    name: 'settings',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: { requiresAuth: true, titleKey: 'nav.settings' },
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
  if (to.matched.some((r) => r.meta.requiresAuth)) {
    // Co-co data is encrypted: wait for a running unlock; a locked/failed store keeps the coach on /verbindung.
    const store = useDataStore()
    if ((await store.settled()) !== 'ready') return { name: 'connection', query: { redirect: to.fullPath } }
  }
  return true
})

export default router
