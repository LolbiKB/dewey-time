/**
 * Finger slugs as English words, for the register's tooltip and CSV.
 *
 * The server (`finger_slots.FINGER_SLUGS`) decides what a device index means;
 * this decides what the words are — the same split the Mini App's FINGER_TEXT
 * makes, with plain words instead of StringKeys because the register is not
 * localised. `fingerLabels.test.ts` reads that Python and keeps the two in
 * step, because a comment asking the next editor to do it is not a guard.
 */
export const FINGER_LABELS: Record<string, string> = {
  left_little: "Left little",
  left_ring: "Left ring",
  left_middle: "Left middle",
  left_index: "Left index",
  left_thumb: "Left thumb",
  right_thumb: "Right thumb",
  right_index: "Right index",
  right_middle: "Right middle",
  right_ring: "Right ring",
  right_little: "Right little",
  other_finger: "Other finger",
};

export const KNOWN_FINGER_SLUGS = Object.keys(FINGER_LABELS);

/** One slug as words. A slug this app has no word for is a finger, not a crash. */
export function fingerLabel(slug: string): string {
  return FINGER_LABELS[slug] ?? FINGER_LABELS.other_finger!;
}
