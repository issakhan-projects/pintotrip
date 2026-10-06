export const ui = {
  select: {
    placeholder: "Таңдау…",
    search: "Іздеу…",
    clearAria: "Таңдауды тазалау",
    noResults: "Нәтиже жоқ",
  },
  confirm: {
    default: "Растау",
  },
  delete: {
    title: "Бұл {entity} жойылсын ба?",
    description: "Бұл әрекетті қайтару мүмкін емес.",
  },
  dateRange: {
    select: "Басталу және аяқталу күнін таңдаңыз",
    range: "Аралық: {from} - {to}",
    rangePartial: "Аралық: {from} - …",
    prevMonth: "Алдыңғы ай",
    nextMonth: "Келесі ай",
    weekdays: "MO,TU,WE,TH,FR,SA,SU",
  },
  sheet: {
    closeAria: "Жабу",
    dismissAria: "Жабу",
  },
  statusAria: "Күйі: {label}",
} as const;
