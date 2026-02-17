import { describe, expect, it } from 'vitest'
import { parseCaptureRecordToOperation } from '../capture/parser.js'

const capture = {
  method: 'GET',
  url: 'https://web.np.playstation.com/api/graphql/v1/op?variables=%7B%22id%22%3A%22abc%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22sha256Hash%22%3A%22757de84ff8efb4aeaa78f4faf51bd610bce94a3fcb248ba158916cb88c5cdb7c%22%7D%7D',
  headers: {
    'x-apollo-operation-name': 'categoryGridRetrieve',
    authorization: 'secret',
  },
  status: 200,
  responseJson: {
    data: {
      categoryGridRetrieve: {
        products: [],
      },
    },
  },
}

describe('parseCaptureRecordToOperation', () => {
  it('extracts operation fields and redacts secret headers', () => {
    const operation = parseCaptureRecordToOperation(capture, 'new')

    expect(operation.operation_name).toBe('categoryGridRetrieve')
    expect(operation.persisted_query_hash).toBe('757de84ff8efb4aeaa78f4faf51bd610bce94a3fcb248ba158916cb88c5cdb7c')
    expect(operation.required_headers).toEqual(['x-apollo-operation-name'])
    expect(operation.variables_schema).toEqual({ id: 'string' })
    expect(operation.response_path).toBe('data.categoryGridRetrieve.products')
  })
})
