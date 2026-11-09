<script setup lang="ts">
/** /lager/:campId/feedback: feedback composer. Reads ?item=<id> to focus an item. */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import FeedbackItemCard from '@/components/feedback/FeedbackItemCard.vue'
import FeedbackPreview from '@/components/feedback/FeedbackPreview.vue'
import GeneralPointsPanel from '@/components/feedback/GeneralPointsPanel.vue'
import RefineFindingsDialog from '@/components/feedback/RefineFindingsDialog.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useFeedback, type NewFeedback } from '@/composables/useFeedback'
import { KIND_ORDER } from '@/domain/feedback'
import { newReplies } from '@/domain/feedback/commentSync'
import { generalPointById } from '@/domain/feedback/defaults'
import { getHiddenGeneralPoints, hideGeneralPoint, restoreAllGeneralPoints } from '@/domain/feedback/generalPointsStore'
import { groupFeedback } from '@/domain/feedback/structure'
import { listDocuments } from '@/domain/documents/store'
import { lastMcpChange } from '@/composables/mcpChanges'
import { activityBlockNumbers, activityShortUrlMap, activityUrlMap } from '@/domain/ecampLinks'
import type { DocumentRecord, FeedbackKind, FeedbackScope } from '@/domain/types'

const { t } = useI18n()
const route = useRoute()
const { campIri } = useCampRoute()
const { facts, load: loadFacts } = useCampFacts(campIri)
const fb = useFeedback(campIri)

const hiddenPoints = ref<string[]>([])
async function loadHiddenPoints() {
  hiddenPoints.value = await getHiddenGeneralPoints(campIri.value).catch(() => [])
}
watch(campIri, () => void loadHiddenPoints(), { immediate: true })
async function hidePoint(id: string) {
  hiddenPoints.value = await hideGeneralPoint(campIri.value, id)
}
async function restorePoints() {
  hiddenPoints.value = await restoreAllGeneralPoints(campIri.value)
}

const activityTitles = computed<Record<string, string>>(() =>
  Object.fromEntries((facts.value?.activities ?? []).map((a) => [a.iri, a.title])),
)
const activityOptions = computed(() =>
  (facts.value?.activities ?? []).map((a) => ({ title: a.title, value: a.iri })).sort((a, b) => a.title.localeCompare(b.title, 'de')),
)
const activityUrls = computed(() => activityUrlMap(facts.value))
const activityShortUrls = computed(() => activityShortUrlMap(facts.value))
const coachName = computed(() => facts.value?.collaborators.find((c) => c.isCurrentUser)?.displayName ?? null)

// Documents (names and first linked activity for document items). Read-only; no watcher/ingest here.
type DocLike = Pick<DocumentRecord, 'id' | 'name' | 'activityIris'>
const documents = ref<DocLike[]>([])
async function loadDocs() {
  try {
    documents.value = (await listDocuments(campIri.value)).map((d) => ({ id: d.id, name: d.name, activityIris: d.activityIris }))
  } catch {
    documents.value = []
  }
}
watch(campIri, () => void loadDocs(), { immediate: true })
watch(lastMcpChange, (c) => {
  if (c?.campIri === campIri.value) void loadDocs()
})

const renderContext = computed(() => ({
  facts: facts.value,
  documents: documents.value,
  campTitle: facts.value?.camp.title ?? '',
  activityTitles: activityTitles.value,
  activityUrls: activityUrls.value,
  activityShortUrls: activityShortUrls.value,
  activityNumbers: activityBlockNumbers(facts.value),
  coachName: coachName.value,
}))

const focusId = computed(() => (typeof route.query.item === 'string' ? route.query.item : null))
watch(
  [focusId, () => fb.items.value.length],
  async ([id]) => {
    if (!id) return
    await nextTick()
    document.querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center' })
  },
  { immediate: true },
)

// Add form
const adding = ref<FeedbackScope | null>(null)
const newKind = ref<FeedbackKind>('suggestion')
const newText = ref('')
const newActivity = ref<string | null>(null)
const canAdd = computed(() => newText.value.trim() !== '' && (adding.value === 'camp' || !!newActivity.value))

function openAdd(scope: FeedbackScope, activityIri: string | null = null) {
  adding.value = scope
  newText.value = ''
  newActivity.value = activityIri
}
async function submitAdd() {
  if (!adding.value || !canAdd.value) return
  await fb.add({
    scope: adding.value,
    kind: newKind.value,
    text: newText.value.trim(),
    activityIri: adding.value === 'activity' ? (newActivity.value ?? undefined) : undefined,
  })
  adding.value = null
}

// Guard against double clicks: one item per default point.
const takingPoints = new Set<string>()
async function takeGeneralPoint(pointId: string) {
  const p = generalPointById(pointId)
  if (!p || takingPoints.has(p.id) || fb.items.value.some((i) => i.generalPointId === p.id)) return
  takingPoints.add(p.id)
  try {
    await fb.add({ scope: 'camp', kind: 'question', text: t(p.promptKey), generalPointId: p.id })
  } catch (e) {
    snack.value = { text: `${t('feedback.refine.failed')}: ${e instanceof Error ? e.message : String(e)}`, color: 'error' }
  } finally {
    takingPoints.delete(p.id)
  }
}

// Refine findings into feedback
const refineOpen = ref(false)
async function onRefine(inputs: NewFeedback[]) {
  try {
    for (const input of inputs) await fb.add(input)
    snack.value = { text: t('feedback.refine.created', { n: inputs.length }), color: 'success' }
  } catch (e) {
    snack.value = { text: `${t('feedback.refine.failed')}: ${e instanceof Error ? e.message : String(e)}`, color: 'error' }
  }
}

// Posting
const postingId = ref<string | null>(null)
const snack = ref<{ text: string; color: string } | null>(null)
async function post(id: string) {
  postingId.value = id
  try {
    await fb.postAsComment(id)
    snack.value = { text: t('feedback.postedOk'), color: 'success' }
  } catch (e) {
    snack.value = { text: `${t('feedback.postFailed')}: ${e instanceof Error ? e.message : String(e)}`, color: 'error' }
  } finally {
    postingId.value = null
  }
}

// Comment sync: runs whenever facts are (re)loaded and once the feedback items are available.
const syncing = ref(false)
const onlyNewReplies = ref(false)
const hasPosted = computed(() => fb.items.value.some((i) => i.status === 'posted'))
const visibleItems = computed(() =>
  onlyNewReplies.value ? fb.ordered.value.filter((i) => newReplies(i.commentSync).length > 0) : fb.ordered.value,
)
// Structure: Allgemein, then days -> activities
const structure = computed(() => groupFeedback(visibleItems.value, facts.value, documents.value))
const openDays = ref<string[]>([])
const seenDays = new Set<string>()
// Panel key: day IRI (day numbers repeat across periods); test id keeps the day number.
const dayKey = (d: { dayIri: string | null }) => d.dayIri ?? 'none'
const dayTestId = (d: { dayNumber: number | null }) => `feedback-day-${d.dayNumber ?? 'none'}`
watch(
  structure,
  (st) => {
    for (const d of st.days) {
      const k = dayKey(d)
      if (!seenDays.has(k)) {
        seenDays.add(k)
        openDays.value.push(k)
      }
    }
  },
  { immediate: true },
)

async function runSync(announce: boolean) {
  if (!facts.value || syncing.value) return
  try {
    const s = await fb.syncComments(facts.value)
    if (announce) {
      snack.value = {
        text: s.resolved + s.withNewReplies + s.missing === 0
          ? t('feedback.sync.nothing')
          : t('feedback.sync.summary', { resolved: s.resolved, replies: s.withNewReplies, missing: s.missing }),
        color: 'success',
      }
    }
  } catch (e) {
    snack.value = { text: `${t('feedback.sync.failed')}: ${e instanceof Error ? e.message : String(e)}`, color: 'error' }
  }
}
async function syncNow() {
  syncing.value = true
  try {
    await loadFacts(true)
  } finally {
    syncing.value = false
  }
  await runSync(true)
}
watch(
  [() => facts.value, () => fb.loading.value],
  () => {
    if (!fb.loading.value) void runSync(false)
  },
  { immediate: true },
)

const snackOpen = computed({ get: () => snack.value !== null, set: (v) => { if (!v) snack.value = null } })
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">{{ t('feedback.title') }}</h1>
    <v-alert v-if="fb.error.value" type="error" variant="tonal" density="compact" class="mb-3" :text="`${t('feedback.loadFailed')}: ${fb.error.value}`" />
    <v-alert v-if="!facts" type="info" variant="tonal" density="compact" class="mb-3" :text="t('feedback.noFacts')" />

    <v-row>
      <v-col cols="12" md="7">
        <div class="d-flex flex-wrap ga-2 mb-3">
          <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" @click="openAdd('camp')">{{ t('feedback.addCamp') }}</v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-plus" :disabled="!facts" @click="openAdd('activity')">{{ t('feedback.addActivity') }}</v-btn>
          <v-btn size="small" variant="tonal" color="primary" prepend-icon="mdi-playlist-check" data-testid="feedback-refine"
            @click="refineOpen = true">{{ t('feedback.refine.button') }}</v-btn>
          <v-spacer />
          <v-switch v-if="hasPosted" v-model="onlyNewReplies" density="compact" hide-details color="primary" data-testid="filter-new-replies"
            :label="t('feedback.sync.filterNew')" />
          <v-btn size="small" variant="tonal" prepend-icon="mdi-sync" :loading="syncing" :disabled="!hasPosted" data-testid="sync-comments"
            @click="syncNow">{{ t('feedback.sync.button') }}</v-btn>
        </div>

        <v-card v-if="adding" variant="outlined" class="mb-3">
          <v-card-text>
            <v-btn-toggle v-model="newKind" mandatory density="compact" divided class="mb-3">
              <v-btn v-for="k in KIND_ORDER" :key="k" :value="k" size="small">{{ t(`feedback.kind.${k}`) }}</v-btn>
            </v-btn-toggle>
            <v-select v-if="adding === 'activity'" v-model="newActivity" :items="activityOptions" :label="t('feedback.selectActivity')"
              density="compact" variant="outlined" hide-details class="mb-3" />
            <v-textarea v-model="newText" :label="t('feedback.text')" auto-grow rows="2" density="compact" variant="outlined" hide-details />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn size="small" variant="text" @click="adding = null">{{ t('feedback.cancel') }}</v-btn>
            <v-btn size="small" variant="flat" color="primary" :disabled="!canAdd" @click="submitAdd">{{ t('feedback.save') }}</v-btn>
          </v-card-actions>
        </v-card>

        <v-progress-linear v-if="fb.loading.value" indeterminate class="mb-3" />
        <section data-testid="feedback-general-section" class="mb-4">
          <h2 class="text-h6 mb-2">{{ t('feedback.structure.general') }}</h2>
          <GeneralPointsPanel :items="fb.items.value" :hidden-ids="hiddenPoints" class="mb-3" @take="takeGeneralPoint" @hide="hidePoint" @restore-all="restorePoints" />
          <div class="d-flex flex-column ga-3">
            <FeedbackItemCard
              v-for="item in structure.general"
              :key="item.id"
              :item="item"
              :activity-title="undefined"
              :activity-url="undefined"
              :lint="fb.lint.value.filter((l) => l.itemId === item.id)"
              :facts="facts"
              :posting="postingId === item.id"
              :focused="focusId === item.id"
              @save="(patch) => fb.update(item.id, patch)"
              @remove="fb.remove(item.id)"
              @post="post(item.id)"
              @mark-sent="(sent) => fb.markSent(item.id, sent)"
              @replies-seen="fb.markRepliesSeen(item.id)"
            />
          </div>
        </section>

        <div v-if="fb.ordered.value.length === 0 && !fb.loading.value" class="text-medium-emphasis mb-3">{{ t('feedback.empty') }}</div>
        <v-expansion-panels v-if="structure.days.length > 0" v-model="openDays" multiple variant="accordion">
          <v-expansion-panel v-for="day in structure.days" :key="dayKey(day)" :value="dayKey(day)" :data-testid="dayTestId(day)">
            <v-expansion-panel-title>
              {{ day.label }}
              <span class="text-caption text-medium-emphasis ms-2">
                {{ t('feedback.structure.itemCount', day.activities.reduce((n, a) => n + a.items.length, 0)) }}
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <section v-for="a in day.activities" :key="a.activityIri" class="mb-4" :data-testid="`feedback-activity-${a.activityIri}`">
                <div class="d-flex align-center mb-2">
                  <h3 class="text-subtitle-1">{{ a.number ? `${a.number} ` : '' }}{{ a.title }}</h3>
                  <v-spacer />
                  <v-btn size="x-small" variant="text" prepend-icon="mdi-plus" @click="openAdd('activity', a.activityIri)">
                    {{ t('feedback.structure.addForActivity') }}
                  </v-btn>
                </div>
                <div class="d-flex flex-column ga-3">
                  <FeedbackItemCard
                    v-for="item in a.items"
                    :key="item.id"
                    :item="item"
                    :activity-title="item.activityIri ? activityTitles[item.activityIri] : undefined"
                    :activity-url="item.scope === 'activity' && item.activityIri ? activityUrls[item.activityIri] : undefined"
                    :lint="fb.lint.value.filter((l) => l.itemId === item.id)"
                    :facts="facts"
                    :posting="postingId === item.id"
                    :focused="focusId === item.id"
                    @save="(patch) => fb.update(item.id, patch)"
                    @remove="fb.remove(item.id)"
                    @post="post(item.id)"
                    @mark-sent="(sent) => fb.markSent(item.id, sent)"
                    @replies-seen="fb.markRepliesSeen(item.id)"
                  />
                </div>
              </section>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-col>
      <v-col cols="12" md="5">
        <FeedbackPreview :items="fb.items.value" :context="renderContext" />
      </v-col>
    </v-row>

    <!-- Mounted only while open: useFindings evaluates all rules, and the selection starts fresh each time. -->
    <RefineFindingsDialog v-if="refineOpen" v-model="refineOpen" :camp-iri="campIri" :facts="facts" :feedback-items="fb.items.value" :documents="documents"
      @submit="onRefine" />

    <v-snackbar v-model="snackOpen" :color="snack?.color" timeout="5000">{{ snack?.text }}</v-snackbar>
  </div>
</template>
