<script setup lang="ts">
/** /lager/:campId/feedback: feedback composer. OWNER: feedback builder. Reads ?item=<id> to focus an item. */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import FeedbackItemCard from '@/components/feedback/FeedbackItemCard.vue'
import FeedbackPreview from '@/components/feedback/FeedbackPreview.vue'
import { useCampFacts } from '@/composables/useCampFacts'
import { useCampRoute } from '@/composables/useCampRoute'
import { useFeedback } from '@/composables/useFeedback'
import { KIND_ORDER } from '@/domain/feedback'
import type { FeedbackKind, FeedbackScope } from '@/domain/types'

const { t } = useI18n()
const route = useRoute()
const { campIri } = useCampRoute()
const { facts } = useCampFacts(campIri)
const fb = useFeedback(campIri)

const activityTitles = computed<Record<string, string>>(() =>
  Object.fromEntries((facts.value?.activities ?? []).map((a) => [a.iri, a.title])),
)
const activityOptions = computed(() =>
  (facts.value?.activities ?? []).map((a) => ({ title: a.title, value: a.iri })).sort((a, b) => a.title.localeCompare(b.title, 'de')),
)
const coachName = computed(() => facts.value?.collaborators.find((c) => c.isCurrentUser)?.displayName ?? null)
const renderContext = computed(() => ({
  campTitle: facts.value?.camp.title ?? '',
  activityTitles: activityTitles.value,
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

function openAdd(scope: FeedbackScope) {
  adding.value = scope
  newText.value = ''
  newActivity.value = null
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
        <div v-if="fb.ordered.value.length === 0 && !fb.loading.value" class="text-medium-emphasis">{{ t('feedback.empty') }}</div>
        <div class="d-flex flex-column ga-3">
          <FeedbackItemCard
            v-for="item in fb.ordered.value"
            :key="item.id"
            :item="item"
            :activity-title="item.activityIri ? activityTitles[item.activityIri] : undefined"
            :lint="fb.lint.value.filter((l) => l.itemId === item.id)"
            :facts="facts"
            :posting="postingId === item.id"
            :focused="focusId === item.id"
            @save="(patch) => fb.update(item.id, patch)"
            @remove="fb.remove(item.id)"
            @post="post(item.id)"
            @mark-sent="(sent) => fb.markSent(item.id, sent)"
          />
        </div>
      </v-col>
      <v-col cols="12" md="5">
        <FeedbackPreview :items="fb.items.value" :context="renderContext" />
      </v-col>
    </v-row>

    <v-snackbar v-model="snackOpen" :color="snack?.color" timeout="5000">{{ snack?.text }}</v-snackbar>
  </div>
</template>
