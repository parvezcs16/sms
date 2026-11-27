// Dashboard heading for the school name. Up to 4 words are shown as they are;
// a longer name keeps its first two words and shortens the rest to initials:
//   "Bright Beginning Grammar Public School" -> "Bright Beginning GPS"
// Small joining words (of, the, and, &) are left out of the initials.
const SMALL_WORDS = new Set(['of', 'the', 'and', '&', 'for', 'in', 'at', '-']);

export function shortSchoolName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) return words.join(' ');
  const initials = words.slice(2)
    .filter((w) => !SMALL_WORDS.has(w.toLowerCase()))
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase())
    .join('');
  return `${words[0]} ${words[1]}${initials ? ` ${initials}` : ''}`;
}
