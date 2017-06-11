# aws-stream-sort

cursor / priority queue using DynamoDB Streams and Lambda (no SQS). To enable the following:

out-of-order messages -> [lambda using this library] -> in-order event stream from DynamoDB

## Usage

```js
const co = require('co').wrap
const { createAutpilot } = require('aws-cursor')
const docClient = new AWS.DynamoDB.DocumentClient()
const autopilot = createAutopilot({
  docClient,
  cursorTable: 'MyStateTableName',
  itemsTable: 'MyItemsTableName',
  queueProp: 'author',
  seqProp: 'seq'
})

// lambda - incoming message processor

exports.enqueue = co(function* (event, context, callback) {
  try {
    yield autopilot.put(event)
    callback()
  } catch (err) {
    console.error(err)
    callback(err)
  }
})

// lambda - cursor table stream processor

exports.process = co(function* (event, context, callback) {
  // inspect OldImage and NewImage
  // to get change in cursor position
  // process batch indicated by the change in position
})
```

## The algorithm

Given two tables:
  `items`: table for your events
  `cursor`: table for storing cursor position

For incoming message M, with sequence number S, which falls into queue Q

1. Store M in `items`
2. If S is not the next sequence number in Q, continue to step 3 (else, exit)
3. increment the cursor value for Q
4. scan ahead `batchSize` items in `items` to see if we have future messages that arrived out-of-order, and update the cursor for Q again
5. repeat step 4 as long as there are more in-order items ahead

The DynamoDB stream from the Cursor table will be in-order per queue.

## Setup
1. `queueProp` + `seq` should be your partition + sort keys in the `items` table
2. The cursor table should have `queueProp` as its partition key (no sort key)

See [./test/inbox-table-schema.json](./test/inbox-table-schema.json) and [./test/cursor-table-schema.json](./test/cursor-table-schema.json) for an example of a compatible schema.

## Testing

To run the tests, first run [localstack](https://github.com/atlassian/localstack)
