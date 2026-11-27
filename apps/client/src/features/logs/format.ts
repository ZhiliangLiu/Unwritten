export const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
export const durationFormat = new Intl.NumberFormat('zh-CN', {
  style: 'unit',
  unit: 'millisecond',
  maximumFractionDigits: 0,
});
export const numberFormat = new Intl.NumberFormat('zh-CN');
