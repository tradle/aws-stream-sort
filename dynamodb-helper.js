const { NotFound } = require('./errors')

module.exports = function wrapTable ({ docClient, TableName }) {
  if (!(docClient && TableName)) {
    throw new Error('expected "docClient" and "TableName"')
  }

  const wrapper = {
    toString,
    query,
    queryOne
  }

  ;['get', 'put', 'del', 'update'].forEach(method => {
    wrapper[method] = (params={}) => {
      params.TableName = TableName
      return docClient[method](params).promise()
    }
  })

  function toString () {
    return TableName
  }

  function query (params) {
    params.TableName = TableName
    return docClient.query(params).promise()
      .then(data => data.Items)
  }

  function queryOne (params) {
    params.Limit = 1
    return query(params)
      .then(results => {
        if (!results.length) throw new NotFound(`"${params.TableName}" query returned 0 items`)
        return results[0]
      })
  }

  return wrapper
}

