import { getDatabaseURL } from "./database"
import { initDb } from "./medusa-test-runner-utils/use-db"
import { startBootstrapApp } from "./medusa-test-runner-utils/bootstrap-app"
import { createDatabase, dropDatabase } from "pg-god"
import { ContainerLike } from "@medusajs/types"
import { createMedusaContainer } from "@medusajs/utils"

const axios = require("axios").default

const DB_HOST = process.env.DB_HOST
const DB_USERNAME = process.env.DB_USERNAME
const DB_PASSWORD = process.env.DB_PASSWORD

const pgGodCredentials = {
  user: DB_USERNAME,
  password: DB_PASSWORD,
  host: DB_HOST,
}

const dbTestUtilFactory = (): any => ({
  db_: null,
  pgConnection_: null,

  clear: async function () {
    this.db_?.synchronize(true)
  },

  create: async function (dbName: string) {
    await createDatabase({ databaseName: dbName }, pgGodCredentials)
  },

  teardown: async function ({
    forceDelete,
    schema,
  }: { forceDelete?: string[]; schema?: string } = {}) {
    forceDelete ??= []
    const manager = this.db_.manager

    schema ??= "public"

    await manager.query(`SET session_replication_role = 'replica';`)
    const tableNames = await manager.query(`SELECT table_name
                                            FROM information_schema.tables
                                            WHERE table_schema = '${schema}';`)

    for (const { table_name } of tableNames) {
      await manager.query(`DELETE
                           FROM ${schema}."${table_name}";`)
    }

    await manager.query(`SET session_replication_role = 'origin';`)
  },

  shutdown: async function (dbName: string) {
    await this.db_?.destroy()
    await this.pgConnection_?.context?.destroy()

    return await dropDatabase(
      { databaseName: dbName, errorIfNonExist: false },
      pgGodCredentials
    )
  },
})

export interface MedusaSuiteOptions<TService = unknown> {
  dbUtils: any
  dbConnection: any // Legacy typeorm connection
  getContainer: () => ContainerLike
  api: any
  dbConfig: {
    dbName: string
    schema: string
    clientUrl: string
  }
}

export function medusaIntegrationTestRunner({
  moduleName,
  dbName,
  schema = "public",
  env = {},
  force_modules_migration = false,
  debug = false,
  testSuite,
}: {
  moduleName?: string
  env?: Record<string, string>
  dbName?: string
  schema?: string
  debug?: boolean
  force_modules_migration?: boolean
  testSuite: <TService = unknown>(
    options: MedusaSuiteOptions<TService>
  ) => () => void
}) {
  const tempName = parseInt(process.env.JEST_WORKER_ID || "1")
  moduleName = moduleName ?? Math.random().toString(36).substring(7)
  dbName ??= `medusa-${moduleName.toLowerCase()}-integration-${tempName}`

  let dbConfig = {
    dbName,
    clientUrl: getDatabaseURL(dbName),
    schema,
    debug,
  }

  const originalConfigLoader =
    require("@medusajs/medusa/dist/loaders/config").default
  require("@medusajs/medusa/dist/loaders/config").default = (
    rootDirectory: string
  ) => {
    const config = originalConfigLoader(rootDirectory)
    config.projectConfig.database_url = dbConfig.clientUrl
    return config
  }

  const cwd = process.cwd()

  let shutdown = async () => void 0
  let afterEachShutdown = async () => void 0
  let dbUtils = dbTestUtilFactory()
  let container: ContainerLike
  let apiUtils: any

  let options = {
    dbUtils,
    api: new Proxy(
      {},
      {
        get: (target, prop) => {
          return apiUtils[prop]
        },
      }
    ),
    dbConnection: new Proxy(
      {},
      {
        get: (target, prop) => {
          return dbUtils.db_[prop]
        },
      }
    ),
    getContainer: () => container,
  } as MedusaSuiteOptions

  let isFirstTime = true

  const beforeAll_ = async () => {
    await dbUtils.create(dbName)
    const { dbDataSource, pgConnection } = await initDb({
      cwd,
      env,
      force_modules_migration,
      database_extra: {},
      dbUrl: dbConfig.clientUrl,
      dbSchema: dbConfig.schema,
    })
    dbUtils.db_ = dbDataSource
    dbUtils.pgConnection_ = pgConnection

    const {
      shutdown: serverShutdown,
      container: container_,
      port,
    } = await startBootstrapApp({
      cwd,
      env,
    })

    const cancelTokenSource = axios.CancelToken.source()
    apiUtils = axios.create({
      baseURL: `http://localhost:${port}`,
      cancelToken: cancelTokenSource.token,
    })

    container = container_
    shutdown = async () => {
      await serverShutdown()
      cancelTokenSource.cancel("Request canceled by shutdown")
    }
  }

  const beforeEach_ = async () => {
    // The beforeAll already run everything, so lets not re run the loaders for the first iteration
    if (isFirstTime) {
      isFirstTime = false
      return
    }

    const container = options.getContainer()
    const copiedContainer = createMedusaContainer({}, container)

    if (process.env.MEDUSA_FF_MEDUSA_V2 != "true") {
      const defaultLoader =
        require("@medusajs/medusa/dist/loaders/defaults").default
      await defaultLoader({
        container: copiedContainer,
      })
    }

    const medusaAppLoaderRunner =
      require("@medusajs/medusa/dist/loaders/medusa-app").runModulesLoader
    const { onApplicationShutdown } = await medusaAppLoaderRunner({
      container: copiedContainer,
      configModule: container.resolve("configModule"),
    })

    afterEachShutdown = onApplicationShutdown
  }

  const afterEach_ = async () => {
    try {
      await dbUtils.teardown({ schema })
      await afterEachShutdown()
    } catch (error) {
      console.error("Error tearing down database:", error)
    }
  }

  return describe("", () => {
    beforeAll(beforeAll_)
    beforeEach(beforeEach_)
    afterEach(afterEach_)
    afterAll(async () => {
      await dbUtils.shutdown(dbName)
      await shutdown()
    })

    testSuite(options!)
  })
}
