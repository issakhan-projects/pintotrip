export const ui = {
  select: {
    placeholder: "Select…",
    search: "Search…",
    clearAria: "Clear selection",
    noResults: "No results",
  },
  confirm: {
    default: "Confirm",
  },
  delete: {
    title: "Delete this {entity}?",
    description: "This can’t be undone.",
  },
  dateRange: {
    select: "Select a start and end date",
    range: "Range: {from} - {to}",
    rangePartial: "Range: {from} - …",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    weekdays: "MO,TU,WE,TH,FR,SA,SU",
  },
  sheet: {
    closeAria: "Close",
    dismissAria: "Dismiss",
  },
  statusAria: "Status: {label}",
} as const;
