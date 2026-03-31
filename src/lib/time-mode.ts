export type TimeMode = 'morning' | 'work' | 'evening' | 'weekend';

export function getTimeMode(date?: Date): TimeMode {
  const now = date || new Date();
  // Convert to Eastern Time
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const etDate = new Date(etStr);
  const hour = etDate.getHours();
  const day = etDate.getDay(); // 0 = Sunday, 6 = Saturday

  if (day === 0 || day === 6) return 'weekend';
  if (hour < 9) return 'morning';
  if (hour >= 17) return 'evening';
  return 'work';
}
