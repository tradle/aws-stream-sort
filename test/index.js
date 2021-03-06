process.env.IS_LOCAL = true
const test = require('tape')
const AWS = require('aws-sdk')
AWS.config.update({ region: 'us-east-1' })

const co = require('co').wrap
const timestamp = require('monotonic-timestamp')
// const getTable = require('../dynamodb-helper')
const schema = {
  cursor: require('./cursor-table-schema'),
  inbox: require('./inbox-table-schema'),
}

const LOCALSTACK = require('./localstack')
const memCursor = require('../mem-cursor')
const createAutopilot = require('../autopilot')
// const dynamodb = new AWS.DynamoDB({ endpoint: LOCALSTACK.DynamoDB })
// const docClient = new AWS.DynamoDB.DocumentClient({ endpoint: LOCALSTACK.DynamoDB })
const dynamodb = process.env.IS_LOCAL
  ? new AWS.DynamoDB({ endpoint: LOCALSTACK.DynamoDB })
  : new AWS.DynamoDB()

const docClient = process.env.IS_LOCAL
  ? new AWS.DynamoDB.DocumentClient({ endpoint: LOCALSTACK.DynamoDB })
  : new AWS.DynamoDB.DocumentClient()

// 0-99 shuffled
const scrambled100 = [9, 49, 13, 34, 66, 19, 32, 89, 6, 62, 56, 53, 36, 58, 54, 55, 47, 82, 35, 0, 76, 94, 60, 98, 12, 5, 20, 4, 96, 1, 39, 16, 7, 33, 22, 2, 11, 90, 81, 99, 57, 42, 27, 59, 80, 69, 3, 86, 21, 26, 38, 77, 24, 78, 51, 87, 18, 23, 91, 68, 70, 79, 72, 85, 15, 92, 84, 41, 65, 61, 63, 8, 64, 14, 83, 10, 52, 29, 43, 74, 44, 31, 28, 75, 48, 97, 46, 93, 50, 95, 17, 73, 88, 45, 25, 67, 71, 30, 40, 37]
// 0-9 shuffled
const scrambled10 = [2, 5, 1, 0, 4, 3, 9, 7, 8, 6]
const recreateTables = co(function* () {
  // try {
  //   yield [
  //     deleteTable(schema.cursor.TableName),
  //     deleteTable(schema.inbox.TableName)
  //   ]
  // } catch (err) {}

  yield [
    create(schema.inbox),
    create(schema.cursor)
  ]
})

const BATCH_SIZES = [1, 2, 5, 10, 50]

BATCH_SIZES.forEach(batchSize => {
  const author = 'bob' + timestamp() // separate test
  const input = scrambled10
  const expected = memCursor(input, batchSize)

  test(`put in series, batchSize = ${batchSize}`, loudCo(function* (t) {
    yield recreateTables()
    const output = []
    const autopilot = createAutopilot({
      docClient,
      batchSize,
      cursorTable: schema.cursor.TableName,
      itemsTable: schema.inbox.TableName,
      queueProp: 'author',
      seqProp: 'seq'
    })

    let i = 0
    autopilot.on('change', function ({ seq }) {
      output.push(seq.new)
      if (seq.new === input.length - 1) {
        t.same(output, expected)
        t.end()
      }
    })

    for (const seq of input) {
      yield autopilot.put({
        author,
        seq,
        message: `message ${seq}`
      })
    }
  }))
})

BATCH_SIZES.forEach(batchSize => {
  // TODO: a better test would be to use child_process
  // to simulate actual parallelism
  test(`put in parallel`, loudCo(function* (t) {
    const author = 'bob' + timestamp() // separate test
    const input = scrambled100
    const expected = memCursor(input, batchSize)

    yield recreateTables()
    const output = []
    const autopilot = createAutopilot({
      docClient,
      batchSize,
      cursorTable: schema.cursor.TableName,
      itemsTable: schema.inbox.TableName,
      queueProp: 'author',
      seqProp: 'seq'
    })

    let i = -1
    let prev = -1
    autopilot.on('change', function ({ seq }) {
      t.equal(seq.old, prev)
      t.ok(seq.new > prev, `previous: ${prev}, current: ${seq.new}`)
      prev = seq.new
      if (seq.new === input.length - 1) {
        t.end()
      }
    })

    for (const seq of input) {
      autopilot.put({
        author,
        seq,
        message: `message ${seq}`
      })
    }
  }))
})

function deleteTable (TableName) {
  return dynamodb.deleteTable({ TableName }).promise()
}

const create = co(function* (schema) {
  try {
    yield dynamodb.createTable(schema).promise()
  } catch (err) {
    // already exists
    if (err.code !== 'ResourceInUseException') {
      throw err
    }
  }
})

function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}
