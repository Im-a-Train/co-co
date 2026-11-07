<script setup lang="ts">
defineProps<{
  title: string
  value: string | number
  subtitle?: string
  icon?: string
  color?: string
  to?: { name: string; params?: Record<string, string> }
}>()
</script>

<template>
  <v-card variant="tonal" :color="color" :to="to" density="compact" class="h-100">
    <v-card-text>
      <div class="d-flex align-center ga-2 text-body-2 text-medium-emphasis">
        <v-icon v-if="icon" :icon="icon" size="small" />
        <span>{{ title }}</span>
      </div>
      <div class="text-h4 my-1">{{ value }}</div>
      <div v-if="subtitle" class="text-caption">{{ subtitle }}</div>
      <slot />
    </v-card-text>
  </v-card>
</template>
