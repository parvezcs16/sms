// Runs `worker` over `items` with at most `limit` in flight at once. Used for
// fan-out sends (notifications to many recipients across email/SMS/WhatsApp)
// where awaiting each one sequentially would make a notice to a few hundred
// parents take minutes — but unbounded Promise.all could overwhelm a single
// SMTP connection or WhatsApp socket, or trip a provider's rate limit.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

module.exports = { mapWithConcurrency };
