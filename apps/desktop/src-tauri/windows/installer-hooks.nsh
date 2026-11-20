; co-co NSIS installer hooks (bundle.windows.nsis.installerHooks, ADR 0017).
;
; The Tauri NSIS template shows a "create desktop shortcut" checkbox on the finish page (the SHOWREADME
; button) and checks it by default. co-co is started from the Start menu; the desktop icon is optional, so
; leave it unchecked.
; This file is !include'd near the top of installer.nsi, before the finish page is declared, so a plain
; top-level !define is read by MUI_PAGE_FINISH. (The bundler version in use has no NSIS_HOOK_PREFINISHPAGE
; macro, so a hook macro would never run.)
; Updates started by the in-app updater run with /UPDATE and never create shortcuts.
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
