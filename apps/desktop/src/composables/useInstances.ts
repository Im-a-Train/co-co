import { computed, reactive, ref } from 'vue'
import {
  BUILT_IN_INSTANCES,
  loadCustomInstances,
  loadSelectedId,
  normalizeBaseUrl,
  saveCustomInstances,
  saveSelectedId,
  type EcampInstance,
  type UrlCheck,
} from '@/lib/instances'
import { commands, errorMessage, type InstanceInfo } from '@/lib/tauri'
import { useSpikeProtocol } from './useSpikeProtocol'

const custom = ref<EcampInstance[]>(loadCustomInstances())
const instances = computed<EcampInstance[]>(() => [...BUILT_IN_INSTANCES, ...custom.value])
const initialId = loadSelectedId()
const selectedId = ref<string>(
  instances.value.some((i) => i.id === initialId) ? (initialId as string) : BUILT_IN_INSTANCES[0].id,
)
const selected = computed<EcampInstance>(
  () => instances.value.find((i) => i.id === selectedId.value) ?? BUILT_IN_INSTANCES[0],
)

/** discover_instance results keyed by baseUrl. */
const infos = reactive<Record<string, InstanceInfo>>({})
const discovering = ref(false)
const discoverError = ref<string | null>(null)

function select(id: string): void {
  selectedId.value = id
  discoverError.value = null
  saveSelectedId(id)
}

function addCustom(input: string, label?: string): UrlCheck {
  const check = normalizeBaseUrl(input)
  if (!check.ok) return check
  const existing = instances.value.find((i) => i.baseUrl === check.baseUrl)
  if (existing) {
    select(existing.id)
    return check
  }
  const entry: EcampInstance = {
    id: `custom:${check.baseUrl}`,
    label: label?.trim() || new URL(check.baseUrl).host,
    baseUrl: check.baseUrl,
    builtIn: false,
  }
  custom.value = [...custom.value, entry]
  saveCustomInstances(custom.value)
  select(entry.id)
  return check
}

function removeCustom(id: string): void {
  custom.value = custom.value.filter((i) => i.id !== id)
  saveCustomInstances(custom.value)
  if (selectedId.value === id) select(BUILT_IN_INSTANCES[0].id)
}

async function discover(baseUrl: string = selected.value.baseUrl): Promise<InstanceInfo | null> {
  const spike = useSpikeProtocol()
  discovering.value = true
  discoverError.value = null
  try {
    const info = await commands.discoverInstance(baseUrl)
    infos[baseUrl] = info
    spike.addLog('ui', 'discover-instance', true, `${info.apiRoot} (prefix ${info.cookiePrefix})`)
    return info
  } catch (err) {
    discoverError.value = errorMessage(err)
    spike.addLog('ui', 'discover-instance', false, discoverError.value)
    return null
  } finally {
    discovering.value = false
  }
}

const selectedInfo = computed<InstanceInfo | null>(() => infos[selected.value.baseUrl] ?? null)

export function useInstances() {
  return {
    instances,
    selected,
    selectedId,
    selectedInfo,
    infos,
    discovering,
    discoverError,
    select,
    addCustom,
    removeCustom,
    discover,
  }
}
