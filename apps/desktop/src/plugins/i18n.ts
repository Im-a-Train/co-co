import { createI18n } from 'vue-i18n'
import { messages } from '@/locales/messages'

/** FROZEN (architect). Locale area files are merged in src/locales/messages.ts. */
export const i18n = createI18n({
  legacy: false,
  locale: 'de',
  fallbackLocale: 'de',
  messages,
  datetimeFormats: {
    de: {
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
      dateTime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
      date: { year: 'numeric', month: '2-digit', day: '2-digit' },
      weekday: { weekday: 'short', day: '2-digit', month: '2-digit' },
      hourMinute: { hour: '2-digit', minute: '2-digit' },
    },
  },
  numberFormats: {
    de: {
      decimal: { style: 'decimal', maximumFractionDigits: 1 },
      integer: { style: 'decimal', maximumFractionDigits: 0 },
    },
  },
})

export default i18n
