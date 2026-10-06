export const ui = {
  select: {
    placeholder: "Выберите…",
    search: "Поиск…",
    clearAria: "Очистить выбор",
    noResults: "Нет результатов",
  },
  confirm: {
    default: "Подтвердить",
  },
  delete: {
    title: "Удалить {entity}?",
    description: "Это нельзя отменить.",
  },
  dateRange: {
    select: "Выберите дату начала и окончания",
    range: "Период: {from} - {to}",
    rangePartial: "Период: {from} - …",
    prevMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    weekdays: "MO,TU,WE,TH,FR,SA,SU",
  },
  sheet: {
    closeAria: "Закрыть",
    dismissAria: "Закрыть",
  },
  statusAria: "Статус: {label}",
} as const;
