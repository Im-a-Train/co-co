import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import { de } from 'vuetify/locale'

export default createVuetify({
  locale: { locale: 'de', fallback: 'de', messages: { de } },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#1f5f8b',
          secondary: '#4f6d7a',
          background: '#f3f5f7',
          surface: '#ffffff',
          success: '#2e7d32',
          warning: '#b26a00',
          error: '#c62828',
          info: '#0277bd',
          // Coach findings (origin 'manual') are violet everywhere.
          coach: '#7b1fa2',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#6fb3e0',
          secondary: '#9bb7c4',
          background: '#121619',
          surface: '#1b2126',
          success: '#66bb6a',
          warning: '#ffb74d',
          error: '#ef5350',
          info: '#4fc3f7',
          coach: '#ce93d8',
        },
      },
    },
  },
  defaults: {
    VCard: { rounded: 'lg', elevation: 1 },
    VBtn: { rounded: 'lg' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
  },
})
