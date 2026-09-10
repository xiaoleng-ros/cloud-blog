import config from '@payload-config'
import { GRAPHQL_POST, REST_OPTIONS } from '@payloadcms/next/routes'

// GraphQL API：POST 请求走 GraphQL，OPTIONS 处理跨域预检
export const POST = GRAPHQL_POST(config)
export const OPTIONS = REST_OPTIONS(config)