import { createI18n } from 'vue-i18n'
import de from '@/locales/de.json'

export type MessageSchema = typeof de

export const i18n = createI18n({
  legacy: false,
  locale: 'de',
  fallbackLocale: 'de',
  messages: { de },
  datetimeFormats: {
    de: {
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
      dateTime: { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    },
  },
})

export default i18n
