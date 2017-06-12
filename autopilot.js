const util = require('util')
const { EventEmitter } = require('events')
const co = require('co').wrap
const clone = require('xtend')
const debug = require('./debug')
const createCursor = require('./cursor')
const wrapTable = require('./dynamodb-helper')
const defaults = require('./defaults')

module.exports = function createAutopilot (opts) {
  return new Autopilot(opts)
}

function Autopilot (opts) {
  EventEmitter.call(this)
  this.opts = clone(defaults, opts)
  this.cursor = createCursor(this.opts)
  this.cursor.on('change', this.emit.bind(this, 'change'))
}

util.inherits(Autopilot, EventEmitter)
const proto = Autopilot.prototype

proto.put = co(function* (item) {
  yield this.cursor.items.put({
    Key: {
      [this.opts.queueProp]: item[this.opts.queueProp],
      [this.opts.seqProp]: item[this.opts.seqProp]
    },
    Item: item
  })

  const result = yield this.cursor.tryIncrement(item)
  if (result.new === result.old) {
    return result
  }

  const more = yield this._scanAhead(item)
  return {
    old: result.old,
    new: more.new
  }
})

proto._scanAhead = co(function* (item) {
  let { queue, seq } = this.cursor.importProps(item)
  const old = seq
  const { batchSize } = this.cursor
  try {
    // update cursor in batches
    while (true) {
      let item = this.cursor.exportProps({
        queue,
        seq
      })

      let result = yield this.cursor.scan(item)
      if (!result || result.new !== seq + batchSize) {
        // we're out of stuff ahead of the cursor
        break
      }

      // keep going
      seq = result.new
    }
  } catch (err) {
    debug('failed to seek farther', err.stack)
  }

  return {
    old,
    new: seq
  }
})
