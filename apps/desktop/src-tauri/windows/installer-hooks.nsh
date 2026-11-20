; co-co NSIS installer hooks (bundle.windows.nsis.installerHooks, ADR 0017).
;
; The Tauri NSIS template shows a "create desktop shortcut" checkbox on the finish page and checks it by
; default. co-co is started from the Start menu; the desktop icon is optional, so leave it unchecked.
; NSIS_HOOK_PREFINISHPAGE is inserted right before MUI_PAGE_FINISH, so the define still takes effect.
; Updates started by the in-app updater run with /UPDATE and never create shortcuts.
!macro NSIS_HOOK_PREFINISHPAGE
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
!macroend
