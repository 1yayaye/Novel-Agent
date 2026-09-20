import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { NativeProbeResultSchema, type NativeProbeResult } from '../shared/native-probe'
import { pingWorker } from './worker'

function loadableSqliteVecPath(isPackaged: boolean): string {
  const loadablePath = sqliteVec.getLoadablePath()
  return isPackaged
    ? loadablePath.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    : loadablePath
}

export async function runNativeProbe(isPackaged: boolean): Promise<NativeProbeResult> {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'Novel-Agent-探针-'))
  const projectPath = join(projectDirectory, '中文临时项目.novelproj')
  const database = new Database(projectPath)
  const sqliteVecPath = loadableSqliteVecPath(isPackaged)

  try {
    const sqliteVersion = database.prepare('select sqlite_version() as version').get() as { version: string }
    database.exec("create virtual table probe_fts using fts5(content, tokenize='trigram')")
    database.prepare('insert into probe_fts(content) values (?)').run('春风又绿江南岸')
    const ftsMatch = database.prepare("select count(*) as count from probe_fts where probe_fts match '江南岸'").get() as { count: number }
    if (ftsMatch.count !== 1) throw new Error('Chinese FTS5 trigram probe failed')

    database.loadExtension(sqliteVecPath)
    const vecVersion = database.prepare('select vec_version() as version').get() as { version: string }
    database.exec('create virtual table probe_vec using vec0(embedding float[3])')
    database.exec("insert into probe_vec(rowid, embedding) values (1, '[0.1, 0.2, 0.3]')")
    const vecMatch = database.prepare("select rowid from probe_vec where embedding match '[0.1, 0.2, 0.3]' order by distance limit 1").get() as { rowid: number }
    if (vecMatch.rowid !== 1) throw new Error('sqlite-vec KNN probe failed')

    await pingWorker()
    return NativeProbeResultSchema.parse({
      betterSqlite3: true,
      sqliteVersion: sqliteVersion.version,
      fts5Trigram: true,
      sqliteVec: true,
      vecVersion: vecVersion.version,
      vecKnn: true,
      worker: true,
      projectPath,
      sqliteVecPath
    })
  } finally {
    database.close()
  }
}

export function writeProbeResult(outputPath: string, result: NativeProbeResult): void {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}
