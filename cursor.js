const util = require('util')
const { EventEmitter } = require('events')
const clone = require('xtend')
const co = require('co').wrap
const debug = require('./debug')
const wrapTable = require('./dynamodb-helper')
const defaults = require('./defaults')

module.exports = function createCursor (opts) {
  return new Cursor(opts)
}

function Cursor ({
  docClient,
  cursorTable,
  itemsTable,
  queueProp,
  seqProp,
  batchSize
}) {
  EventEmitter.call(this)
  const opts = clone(defaults, arguments[0])

  this.cursor = wrapTable({ docClient, TableName: opts.cursorTable })
  this.items = wrapTable({ docClient, TableName: opts.itemsTable })
  this.queueProp = queueProp
  this.seqProp = seqProp
  this.batchSize = batchSize
}

util.inherits(Cursor, EventEmitter)

const proto = Cursor.prototype

proto.importProps = function (props) {
  const queue = props[this.queueProp]
  const seq = props[this.seqProp]
  return { queue, seq }
}

proto.exportProps = function ({ queue, seq }) {
  return {
    [this.queueProp]: queue,
    [this.seqProp]: seq
  }
}

proto.set = co(function* (props) {
  const parsed = this.importProps(props)
  const { queue, seq } = parsed
  const { queueProp, seqProp } = this
  debug(`setting cursor ${queue} to ${seq}`)
  yield this.cursor.put({
    Key: props,
    Item: props
  })

  this.emit('change', {
    [queueProp]: queue,
    [seqProp]: seq
  })
})

proto.tryIncrement = co(function* (props) {
  props = this.importProps(props)
  const { queue, seq } = props

  let last
  try {
    last = yield this.cursor.queryOne({
      KeyConditionExpression: `${this.queueProp} = :${this.queueProp}`,
      ExpressionAttributeValues: {
        [`:${this.queueProp}`]: queue
      },
      Limit: true,
      ScanIndexForward: false
    })
  } catch (err) {
    last = { [this.seqProp]: -1 }
  }

  last = this.importProps(last)
  if (seq <= last.seq) {
    debug(`skipping ${seq} in ${queue}, already did ${last.seq}`)
    return
  }

  if (seq !== last.seq + 1) {
    debug(`out of order: expected ${last.seq + 1}, got ${seq}`)
    return
  }

  yield this.set(this.exportProps({ queue, seq }))
  return true
})

/**
 * Scan from a given position to see if we have future items (that arrived out of order)
 * @param {Object} props
 * @param {String} props[queueProp]
 * @param {Number} props[seqProp]
 * @param {Number} [props.batchSize] - how many records to query at a time
 */
proto.scan = co(function* (props) {
  const { batchSize=this.batchSize } = props
  const { queue, seq } = this.importProps(props)
  const { queueProp, seqProp } = this
  let results = yield this.items.query({
    KeyConditionExpression: `${queueProp} = :queue AND ${seqProp} between :gte and :lte`,
    ExpressionAttributeValues: {
      ':queue': queue,
      ':gte': seq + 1,
      ':lte': seq + batchSize
    },
    Limit: batchSize
  })

  results = results
    .map(result => this.importProps(result))
    .sort((a, b) => a.seq - b.seq)

  let curSeq = seq
  while (results.length) {
    let result = results.shift()
    if (result.seq !== curSeq + 1) break

    curSeq++
  }

  if (curSeq === seq) return

  debug(`jumping cursor ${queue} to ${curSeq}`)
  yield this.set(this.exportProps({ queue, seq: curSeq }))
  return curSeq
})

// proto.tryIncrementAtomic = co(function* (props) {
//   const { queue, seq } = this.importProps(props)
//   // if (seq === 0) return this.tryIncrement(props)

//   const { queueProp, seqProp } = this
//   const ExpressionAttributeValues = {
//     ':seq': seq
//   }

//   let ConditionExpression
//   if (seq === 0) {
//     ConditionExpression = `attribute_not_exists(${queueProp})`
//   } else {
//     ConditionExpression = `${queueProp} = :queue AND ${seqProp} = :prevseq`
//     ExpressionAttributeValues[':prevseq'] = seq - 1
//     ExpressionAttributeValues[':queue'] = queue
//   }

//   try {
//     yield this.cursor.update({
//       Key: {
//         [queueProp]: queue,
//         [seqProp]: seq
//       },
//       ConditionExpression,
//       UpdateExpression: `SET ${seqProp} = :seq`,
//       ExpressionAttributeValues
//     })

//     debug(`updated ${queue} to ${seq}`)
//     return true
//   } catch (err) {
//     debug(`out of order`, seq, ConditionExpression, err.message)
//   }
// })
