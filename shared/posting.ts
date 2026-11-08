// How far ahead 次の空き looks: 10 slots at two a day is 5 days. That stays
// inside what the post needs to survive: Buffer's free plan holds 10 posts per
// channel, QStash's free plan delays 7 days, and the R2 bucket keeps a video 7 days.
export const FREE_SLOT_COUNT = 10

// 今すぐ goes out this many minutes later, as a reservation: until then a
// network that failed can still take the others back with it (all or nothing).
export const NOW_DELAY_MINUTES = 2
