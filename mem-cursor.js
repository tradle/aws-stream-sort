module.exports = function getExpectedEvents (seqs, batchSize) {
  seqs = seqs.slice()
  const last = Math.max(...seqs)
  const cursor = new Array(seqs.length).fill(false)
  const events = []
  while (events[events.length - 1] !== last) {
    if (seqs.length) {
      let next = seqs.shift()
      cursor[next] = true

      if (cursor.slice(0, next).every(seen => seen)) {
        events.push(next)
        scan(next)
      }
    } else {
      scan(events[events.length - 1])
    }
  }

  return events

  function scan (from) {
    let jump = from
    while (cursor[jump + 1] && jump - from < batchSize) {
      jump++
    }

    if (jump > from) {
      events.push(jump)
      // read more
      scan(jump)
    }
  }
}
